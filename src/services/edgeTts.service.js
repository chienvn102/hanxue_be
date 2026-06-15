/**
 * Microsoft Edge TTS via Python `edge_tts` CLI.
 *
 * Spawns `python3 -m edge_tts --text "..." --voice "..." --write-media <file>`.
 * Used for admin vocab audio gen as a free/local alternative to Google Cloud TTS.
 *
 * Voices match the convention used by hanxue_db/audio_gen/*.py:
 *   - zh-CN-XiaoxiaoNeural (female, default)
 *   - zh-CN-YunxiNeural    (male)
 *
 * Requirements on the host:
 *   - python3 in PATH (override via PYTHON_BIN env)
 *   - `pip install edge-tts` (the existing scripts already require this)
 */

const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

const VOICES = {
    female: process.env.EDGE_TTS_VOICE_FEMALE || 'zh-CN-XiaoxiaoNeural',
    male: process.env.EDGE_TTS_VOICE_MALE || 'zh-CN-YunxiNeural',
};

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const TIMEOUT_MS = parseInt(process.env.EDGE_TTS_TIMEOUT_MS || '30000', 10);

/**
 * Render `text` to an MP3 file at `outputFile` via edge-tts.
 * Parent directory is created if missing. Resolves on success, rejects with a
 * user-safe Error on failure.
 *
 * @param {string} text
 * @param {string} outputFile absolute path
 * @param {{voice?: 'female'|'male'|string, rate?: string}} [opts]
 *   voice: alias (female/male) or full Azure voice name.
 *   rate:  edge-tts rate like '-10%' or '+0%' (optional).
 * @returns {Promise<string>} outputFile path
 */
async function synthesizeToFile(text, outputFile, { voice = 'female', rate } = {}) {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) {
        const err = new Error('edge-tts: empty text');
        err.publicMessage = 'Thieu noi dung de tao audio.';
        err.status = 400;
        throw err;
    }

    const selectedVoice = VOICES[voice] || voice || VOICES.female;
    await fs.mkdir(path.dirname(outputFile), { recursive: true });

    const args = [
        '-m', 'edge_tts',
        '--text', cleanText,
        '--voice', selectedVoice,
        '--write-media', outputFile,
    ];
    if (rate) args.push('--rate', rate);

    return new Promise((resolve, reject) => {
        execFile(PYTHON_BIN, args, { timeout: TIMEOUT_MS }, async (err, _stdout, stderr) => {
            if (err) {
                const stderrText = String(stderr || '');
                let msg;
                if (err.code === 'ENOENT') {
                    msg = `Khong tim thay python (PYTHON_BIN=${PYTHON_BIN}). Cai venv: python3 -m venv .venv && .venv/bin/pip install edge-tts, roi set PYTHON_BIN.`;
                } else if (err.killed) {
                    msg = 'Edge TTS qua thoi gian, vui long thu lai.';
                } else if (/No module named ['"]?edge_tts['"]?/i.test(stderrText)) {
                    msg = `edge-tts chua duoc cai cho ${PYTHON_BIN}. Chay: ${PYTHON_BIN} -m pip install edge-tts (hoac dung venv).`;
                } else {
                    msg = stderrText.slice(0, 200) || err.message || 'Edge TTS that bai.';
                }
                const e = new Error(`edge-tts failed: ${msg}`);
                e.publicMessage = msg;
                e.status = err.code === 'ENOENT' ? 500 : 502;
                return reject(e);
            }
            // Verify file was written (edge-tts can exit 0 but write 0 bytes on bad voice).
            try {
                const stat = await fs.stat(outputFile);
                if (stat.size <= 0) throw new Error('empty output');
            } catch {
                const e = new Error('edge-tts: output file missing or empty');
                e.publicMessage = 'Edge TTS khong tao duoc file audio.';
                e.status = 502;
                return reject(e);
            }
            resolve(outputFile);
        });
    });
}

// ===========================================================================
// MULTI-SPEAKER DIALOGUE (port từ audio_gen/generate_question_audio.py)
// Hội thoại có nhãn người nói (男：/女：/老师：…) → mỗi lượt đọc bằng giọng
// nam/nữ tương ứng rồi ffmpeg concat. Nhãn người nói KHÔNG được đọc thành tiếng.
// ===========================================================================

const FIXED_SPEAKERS = new Set([
    '老师', '学生', '医生', '护士', '服务员', '客人', '顾客',
    '售货员', '司机', '警察', '记者', '主持人',
    '爸爸', '妈妈', '哥哥', '姐姐', '弟弟', '妹妹',
    '阿姨', '叔叔', '爷爷', '奶奶', '外婆', '外公',
    '男', '女',
]);
const SPEAKER_PATTERNS = [
    /^学生[A-Z甲乙丙丁]?$/u,
    /^客人[A-Z甲乙丙丁]?$/u,
    /^[A-Z]$/,
    /^[甲乙丙丁戊]$/u,
    /^小[一-鿿]$/u,
    /^[一-鿿](老师|医生|先生|女士|小姐|护士|阿姨|叔叔)$/u,
    /^男[A-Z]?$/u,
    /^女[A-Z]?$/u,
];
const FEMALE_HINTS = new Set(['女', '妈妈', '姐姐', '妹妹', '阿姨', '奶奶', '外婆']);
const MALE_HINTS = new Set(['男', '爸爸', '哥哥', '弟弟', '叔叔', '爷爷', '外公']);

function isSpeaker(prefix) {
    if (FIXED_SPEAKERS.has(prefix)) return true;
    return SPEAKER_PATTERNS.some(p => p.test(prefix));
}

/** 'male' | 'female' | 'alt' (người nói rõ tên nhưng không rõ giới) | 'default'. */
function voiceHint(speaker) {
    if (speaker.startsWith('男')) return 'male';
    if (speaker.startsWith('女')) return 'female';
    if (FEMALE_HINTS.has(speaker)) return 'female';
    if (MALE_HINTS.has(speaker)) return 'male';
    if (/(女士|小姐|阿姨|护士)$/u.test(speaker)) return 'female';
    if (/(先生|叔叔)$/u.test(speaker)) return 'male';
    if (isSpeaker(speaker)) return 'alt';
    return 'default';
}

// Nhãn người nói: đầu dòng HOẶC sau dấu câu/space, theo sau là dấu hai chấm
// (full-width ：hoặc ASCII :). Tránh nuốt tên trong câu (vd "他对我说：").
const INLINE_SPEAKER_RE = /(?:^|(?<=[。？！?!；;\s,，]))([^：:、，。！？\s]{1,5})[：:]/gu;

/** Tách 1 dòng nhiều người nói: '男：你好。女：你好。' → [{男,...},{女,...}]. */
function splitInlineSpeakers(line) {
    const matches = [...line.matchAll(INLINE_SPEAKER_RE)];
    const valid = matches.filter(m => isSpeaker(m[1]));
    if (!valid.length) return [{ speaker: null, text: line.trim() }];

    const segs = [];
    const head = line.slice(0, valid[0].index).trim();
    if (head) segs.push({ speaker: null, text: head });
    for (let i = 0; i < valid.length; i += 1) {
        const m = valid[i];
        const textStart = m.index + m[0].length;
        const textEnd = i + 1 < valid.length ? valid[i + 1].index : line.length;
        const text = line.slice(textStart, textEnd).trim();
        if (text) segs.push({ speaker: m[1], text });
    }
    return segs;
}

/** transcript → [{ hint, speaker, text }]. Người nói lạ → đọc cả "tên：lời". */
function splitSpeakerSegments(transcript) {
    const out = [];
    for (const rawLine of String(transcript || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        for (const { speaker, text } of splitInlineSpeakers(line)) {
            if (speaker === null) { out.push({ hint: 'default', speaker: null, text }); continue; }
            const hint = voiceHint(speaker);
            if (hint === 'default') out.push({ hint: 'default', speaker: null, text: `${speaker}：${text}` });
            else out.push({ hint, speaker, text });
        }
    }
    return out;
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(FFMPEG_BIN, args, { timeout: TIMEOUT_MS * 3 }, (err, _stdout, stderr) => {
            if (err) {
                const e = new Error(`ffmpeg failed: ${String(stderr || '').slice(0, 200) || err.message}`);
                e.code = err.code;
                return reject(e);
            }
            resolve();
        });
    });
}

/**
 * Render `text` (có thể là hội thoại nhiều người nói) ra 1 file mp3.
 * - Không có nhãn người nói → 1 lần edge-tts như synthesizeToFile.
 * - Nhiều lượt → synthesize từng lượt bằng giọng tương ứng + ffmpeg concat.
 *   Người nói 'alt' (老师/学生… không rõ giới) được gán giọng nhất quán theo tên.
 *   Nếu ffmpeg thiếu/lỗi → fallback đọc toàn bộ bằng 1 giọng (best-effort).
 *
 * @param {string} text
 * @param {string} outputFile absolute path
 * @param {{defaultVoice?: 'female'|'male'}} [opts]
 * @returns {Promise<string>} outputFile
 */
async function synthesizeDialogueToFile(text, outputFile, { defaultVoice = 'female' } = {}) {
    const segments = splitSpeakerSegments(text);

    const altVoiceBySpeaker = new Map();
    let altCount = 0;
    const resolved = segments
        .map((s) => {
            let voice;
            if (s.hint === 'male') voice = 'male';
            else if (s.hint === 'female') voice = 'female';
            else if (s.hint === 'alt') {
                const key = s.speaker || `#${altCount}`;
                if (!altVoiceBySpeaker.has(key)) {
                    altVoiceBySpeaker.set(key, altCount % 2 === 0 ? 'female' : 'male');
                    altCount += 1;
                }
                voice = altVoiceBySpeaker.get(key);
            } else voice = defaultVoice;
            return { voice, text: String(s.text || '').trim() };
        })
        .filter((s) => s.text);

    if (!resolved.length) {
        const err = new Error('edge-tts: empty text');
        err.publicMessage = 'Thieu noi dung de tao audio.';
        err.status = 400;
        throw err;
    }

    // 1 lượt (không có người nói khác nhau) → đường cũ, không cần ffmpeg.
    if (resolved.length === 1) {
        return synthesizeToFile(resolved[0].text, outputFile, { voice: resolved[0].voice });
    }

    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hanxue-tts-'));
    try {
        const parts = [];
        for (let i = 0; i < resolved.length; i += 1) {
            const partFile = path.join(tmpDir, `part_${String(i).padStart(3, '0')}.mp3`);
            await synthesizeToFile(resolved[i].text, partFile, { voice: resolved[i].voice });
            parts.push(partFile);
        }

        const listFile = path.join(tmpDir, 'concat.txt');
        const listContent = parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        await fs.writeFile(listFile, listContent, 'utf8');

        try {
            await runFfmpeg([
                '-y', '-loglevel', 'error',
                '-f', 'concat', '-safe', '0',
                '-i', listFile,
                '-c', 'copy',
                outputFile,
            ]);
            const stat = await fs.stat(outputFile).catch(() => null);
            if (!stat || stat.size <= 0) throw new Error('empty concat output');
            return outputFile;
        } catch (ffErr) {
            // ffmpeg thiếu/lỗi → đọc toàn bộ bằng 1 giọng để không chặn admin.
            console.warn('[edgeTts] concat fallback (single voice):', ffErr.message);
            const joined = resolved.map((s) => s.text).join(' ');
            return synthesizeToFile(joined, outputFile, { voice: defaultVoice });
        }
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { synthesizeToFile, synthesizeDialogueToFile, splitSpeakerSegments, VOICES };
