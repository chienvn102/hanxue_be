/**
 * Per-syllable audio cache for Pronunciation Lab.
 *
 * Audio key format: `<base><tone>` (e.g. "ma3", "shi4", "zhi1"; "5" = neutral).
 * Cached on disk at `public/audio/syllables/<key>.mp3` and served via the
 * existing `/audio/...` static mount in index.js.
 *
 * Source order:
 *   1. Disk cache (fastest, no network)
 *   2. Forvo API (if FORVO_API_KEY set + opt-in)
 *   3. Edge TTS via Python (already configured for admin vocab gen)
 *
 * Forvo is best-effort and silently falls back to Edge TTS on any error so the
 * Pronunciation Lab keeps working even when the Forvo quota is exhausted.
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const edgeTts = require('./edgeTts.service');

const CACHE_DIR = path.join(__dirname, '../../public/audio/syllables');
const PUBLIC_BASE = '/audio/syllables';

// Hard cap on concurrent Edge TTS subprocesses. Each spawned python process
// uses ~30-50MB RAM; on a 1GB droplet spawning ~20 in parallel can OOM-kill
// MariaDB. 2 is a safe ceiling that still serves user-triggered playback
// reasonably (worst case: queue waits ~1-2s per syllable).
const MAX_CONCURRENT_TTS = parseInt(process.env.SYLLABLE_TTS_MAX_CONCURRENT || '2', 10);
let ttsInFlight = 0;
const ttsWaiters = [];

function acquireTtsSlot() {
    if (ttsInFlight < MAX_CONCURRENT_TTS) {
        ttsInFlight++;
        return Promise.resolve();
    }
    return new Promise((resolve) => ttsWaiters.push(resolve));
}

function releaseTtsSlot() {
    if (ttsWaiters.length > 0) {
        const next = ttsWaiters.shift();
        next();    // slot count stays the same — handed off
    } else {
        ttsInFlight = Math.max(0, ttsInFlight - 1);
    }
}

// Dedupe concurrent requests for the same syllable so two simultaneous calls
// don't spawn two python subprocesses for the same file.
const inflightBySyllable = new Map();

// Map pinyin base (no tone) → Vietnamese hint character to feed TTS. The TTS
// prompt is just the syllable spoken; tone is encoded as the tone digit which
// edge-tts cannot understand directly, so we synthesise the pinyin with tone
// marks instead.
const TONE_MARKS = {
    a: ['ā', 'á', 'ǎ', 'à', 'a'],
    e: ['ē', 'é', 'ě', 'è', 'e'],
    i: ['ī', 'í', 'ǐ', 'ì', 'i'],
    o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
    u: ['ū', 'ú', 'ǔ', 'ù', 'u'],
    ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
};

/**
 * Convert "ma3" → "mǎ". The mark goes on the main vowel per pinyin rules:
 *   a > o > e > iu→u  (rule of thumb good enough for HSK 1-3).
 * Returns the input as-is on parse errors.
 */
function applyToneMark(syllableWithTone) {
    const m = String(syllableWithTone || '').match(/^([a-zü]+?)([1-5])?$/i);
    if (!m) return syllableWithTone;
    const base = m[1].toLowerCase().replace(/v/g, 'ü');
    const tone = Number(m[2] || 5);
    if (tone < 1 || tone > 5) return base;

    // Find the vowel index to mark
    let vowelIdx = -1;
    const priority = ['a', 'o', 'e'];
    for (const p of priority) {
        const idx = base.indexOf(p);
        if (idx !== -1) { vowelIdx = idx; break; }
    }
    if (vowelIdx === -1) {
        // No a/o/e — look for last i/u/ü
        for (let i = base.length - 1; i >= 0; i--) {
            if ('iuü'.includes(base[i])) { vowelIdx = i; break; }
        }
    }
    if (vowelIdx === -1) return base;

    const marks = TONE_MARKS[base[vowelIdx]];
    if (!marks) return base;
    return base.slice(0, vowelIdx) + marks[tone - 1] + base.slice(vowelIdx + 1);
}

async function ensureCacheDir() {
    await fs.mkdir(CACHE_DIR, { recursive: true });
}

function publicUrl(key) {
    return `${PUBLIC_BASE}/${key}.mp3`;
}

function diskPath(key) {
    return path.join(CACHE_DIR, `${key}.mp3`);
}

async function existsOnDisk(key) {
    try {
        const stat = await fs.stat(diskPath(key));
        return stat.size > 0;
    } catch {
        return false;
    }
}

/**
 * Fetch from Forvo. Returns audio Buffer on success, or null on miss/error.
 * Best-effort: any failure returns null so caller can fall back.
 */
async function tryForvo(syllableWithToneMark) {
    const key = process.env.FORVO_API_KEY;
    if (!key) return null;

    const word = encodeURIComponent(syllableWithToneMark);
    const url = `https://apifree.forvo.com/key/${key}/format/json/action/word-pronunciations/word/${word}/language/zh/order/rate-desc/limit/1`;

    let metaJson;
    try {
        metaJson = await httpGetJson(url, 5000);
    } catch {
        return null;
    }
    const item = metaJson?.items?.[0];
    if (!item?.pathmp3) return null;

    try {
        return await httpGetBuffer(item.pathmp3, 8000);
    } catch {
        return null;
    }
}

function httpGetJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`Forvo HTTP ${res.statusCode}`));
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error('Forvo timeout')));
    });
}

function httpGetBuffer(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`Forvo audio HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error('Forvo audio timeout')));
    });
}

/**
 * Cache-only lookup: returns `{audio_url, provider:'cache'}` if the file is
 * already on disk, otherwise `null`. NEVER spawns Edge TTS or hits Forvo, so
 * it's safe to call in bulk from list endpoints.
 */
async function getSyllableAudioIfCached(syllableWithTone) {
    const key = String(syllableWithTone || '').trim().toLowerCase();
    if (!/^[a-zü]+[1-5]$/.test(key)) return null;
    if (await existsOnDisk(key)) {
        return { audio_url: publicUrl(key), provider: 'cache' };
    }
    return null;
}

/**
 * Get a playable URL for `<syllable+tone>` (e.g. "ma3", "shi4", "wo5").
 * Spawns Edge TTS subprocess on cache miss — protected by a concurrency cap
 * and per-syllable dedupe to keep RAM bounded on small VMs.
 */
async function getSyllableAudio(syllableWithTone) {
    const key = String(syllableWithTone || '').trim().toLowerCase();
    if (!key) throw new Error('Missing syllable');
    if (!/^[a-zü]+[1-5]$/.test(key)) {
        const e = new Error(`Invalid syllable format: "${key}"`);
        e.status = 400;
        e.publicMessage = `Âm tiết không hợp lệ: "${key}". Định dạng: pinyin + tone (vd "ma3").`;
        throw e;
    }

    await ensureCacheDir();

    // 1) disk cache (always check first — no subprocess needed)
    if (await existsOnDisk(key)) {
        return { audio_url: publicUrl(key), provider: 'cache' };
    }

    // Dedupe: if another request for the same syllable is in flight, await it.
    if (inflightBySyllable.has(key)) {
        return inflightBySyllable.get(key);
    }

    const promise = (async () => {
        const marked = applyToneMark(key);

        // 2) Forvo (optional, network only — no subprocess)
        const forvoBuf = await tryForvo(marked);
        if (forvoBuf) {
            try {
                await fs.writeFile(diskPath(key), forvoBuf);
                return { audio_url: publicUrl(key), provider: 'forvo' };
            } catch (e) {
                console.warn('[syllableAudio] Forvo write failed:', e.message);
            }
        }

        // 3) Edge TTS fallback — gated by concurrency limiter to protect RAM
        await acquireTtsSlot();
        try {
            await edgeTts.synthesizeToFile(marked, diskPath(key), { voice: 'female' });
            return { audio_url: publicUrl(key), provider: 'edge_tts' };
        } catch (e) {
            const err = new Error(`Cannot synthesise syllable "${key}": ${e.message}`);
            err.publicMessage = e.publicMessage || 'Không tạo được audio cho âm tiết này.';
            err.status = e.status || 502;
            throw err;
        } finally {
            releaseTtsSlot();
        }
    })();

    inflightBySyllable.set(key, promise);
    try {
        return await promise;
    } finally {
        inflightBySyllable.delete(key);
    }
}

module.exports = {
    getSyllableAudio,
    getSyllableAudioIfCached,
    applyToneMark,
};
