/**
 * Audio URL resolver — convert "gs://bucket/object" → time-limited signed URL.
 * Legacy paths ("/audio/...", "/uploads/...", "https://...") trả về nguyên.
 *
 * Dùng ở mọi controller serve audio cho FE (vocab, hsk, lesson, audioGen job).
 */

const gcs = require('./gcs.service');

const GS_RE = /^gs:\/\/([^/]+)\/(.+)$/;
// Match GCS public URL hoặc signed URL: https://storage.googleapis.com/<bucket>/<object>?<signed-params>
// hoặc https://<bucket>.storage.googleapis.com/<object>?...
const GCS_HTTPS_RE = /^https?:\/\/(?:storage\.googleapis\.com\/([^/?#]+)\/([^?#]+)|([^.]+)\.storage\.googleapis\.com\/([^?#]+))/i;

/**
 * Normalize URL về dạng `gs://bucket/object` để lưu DB.
 * - Nếu là signed URL hoặc public URL của GCS → strip query, convert về gs://.
 * - Nếu đã là gs://, /audio/, /uploads/, hoặc URL external (không phải GCS) → giữ nguyên.
 * - Trả null nếu input falsy.
 */
function normalizeAudioRef(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl || null;
    if (rawUrl.startsWith('gs://')) return rawUrl;
    const m = rawUrl.match(GCS_HTTPS_RE);
    if (!m) return rawUrl;
    // Pattern A: storage.googleapis.com/<bucket>/<object>
    if (m[1] && m[2]) {
        return `gs://${m[1]}/${decodeURIComponent(m[2])}`;
    }
    // Pattern B: <bucket>.storage.googleapis.com/<object>
    if (m[3] && m[4]) {
        return `gs://${m[3]}/${decodeURIComponent(m[4])}`;
    }
    return rawUrl;
}

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
    normalizeAudioRef,
};
