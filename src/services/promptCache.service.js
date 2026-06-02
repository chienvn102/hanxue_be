/**
 * Prompt Cache Registry — quan ly explicit Gemini context cache cho phan STATIC
 * cua chat prompt (persona + rules + app catalog), key theo `${mode}:${hskLevel}`.
 *
 * Static gan nhu co dinh theo (mode, level) nen da so request se tai dung 1 cache
 * → giam token tinh phi + TTFT. Lazy-create khi miss/sap het han; fallback null
 * (caller dung systemInstruction inline) khi tao that bai — vd prefix duoi nguong
 * token toi thieu (~1024 cho gemini-2.5-flash/flash-lite).
 *
 * Registry in-memory: du cho single-process droplet hien tai; reset khi pm2
 * restart (deploy moi → cache tao lai voi static prompt moi). Khi scale nhieu
 * worker, moi worker tu giu cache rieng — van dung, chi la khong share.
 */

const gemini = require('./gemini.service');

const TTL_SECONDS = 3600;                 // cache song 1 gio
const REFRESH_BEFORE_MS = 5 * 60 * 1000;  // refresh khi con < 5 phut
const NEGATIVE_TTL_MS = 10 * 60 * 1000;   // tranh goi caches.create that bai moi request

// key `${mode}:${hskLevel}` → { name: string|null, expiresAt: number }
const cacheRegistry = new Map();
// chong tao trung khi nhieu request den dong thoi luc cache miss
const inflight = new Map();

/**
 * Lay (hoac tao) cache name cho phan static. Tra ve string (cache name) hoac
 * null. Caller: neu null → truyen systemInstruction inline nhu cu.
 *
 * @param {string} mode - 'chat' | 'conversation'
 * @param {number|string} hskLevel
 * @param {string} staticSystemInstruction - phan STATIC deterministic theo (mode, level)
 * @returns {Promise<string|null>}
 */
async function getOrCreateStaticCache(mode, hskLevel, staticSystemInstruction) {
    const key = `${mode}:${hskLevel}`;
    const now = Date.now();

    const existing = cacheRegistry.get(key);
    if (existing && existing.expiresAt - now > REFRESH_BEFORE_MS) {
        return existing.name; // co the la null (negative-cached) → caller fallback inline
    }

    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
        const name = await gemini.createContextCache({
            systemInstruction: staticSystemInstruction,
            ttlSeconds: TTL_SECONDS,
        });
        cacheRegistry.set(key, {
            name,
            expiresAt: now + (name ? TTL_SECONDS * 1000 : NEGATIVE_TTL_MS),
        });
        return name;
    })().finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
}

module.exports = { getOrCreateStaticCache };
