/**
 * Audio URL resolver — convert "gs://bucket/object" → time-limited signed URL.
 * Legacy paths ("/audio/...", "/uploads/...", "https://...") trả về nguyên.
 *
 * Dùng ở mọi controller serve audio cho FE (vocab, hsk, lesson, audioGen job).
 */

const gcs = require('./gcs.service');

const GS_RE = /^gs:\/\/([^/]+)\/(.+)$/;

async function resolveAudioUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl || null;
    const m = rawUrl.match(GS_RE);
    if (!m) return rawUrl;
    try {
        return await gcs.getSignedReadUrl(m[1], m[2]);
    } catch (error) {
        console.error('[audioUrl] signed URL failed for', rawUrl, error.message);
        return null;
    }
}

/**
 * Resolve nhiều fields audio trong 1 object cùng lúc.
 *   await resolveFields(question, ['question_audio', 'option_audios.0', ...])
 * Field name dùng dot-notation đơn giản — chỉ hỗ trợ 1 level array index.
 */
async function resolveFields(obj, fields = []) {
    if (!obj) return obj;
    const out = { ...obj };
    for (const field of fields) {
        const value = out[field];
        if (Array.isArray(value)) {
            out[field] = await Promise.all(value.map(v => resolveAudioUrl(v)));
        } else {
            out[field] = await resolveAudioUrl(value);
        }
    }
    return out;
}

/**
 * Resolve same field cho mỗi item trong array.
 */
async function resolveAudioUrls(items, field = 'audio_url') {
    if (!Array.isArray(items)) return items;
    return Promise.all(items.map(async (it) => ({
        ...it,
        [field]: await resolveAudioUrl(it && it[field]),
    })));
}

module.exports = {
    resolveAudioUrl,
    resolveAudioUrls,
    resolveFields,
};
