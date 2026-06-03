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
const fs = require('fs').promises;

const VOICES = {
    female: process.env.EDGE_TTS_VOICE_FEMALE || 'zh-CN-XiaoxiaoNeural',
    male: process.env.EDGE_TTS_VOICE_MALE || 'zh-CN-YunxiNeural',
};

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
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

module.exports = { synthesizeToFile, VOICES };
