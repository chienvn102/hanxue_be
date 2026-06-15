/**
 * Media proxy — resolve `gs://bucket/object` → time-limited signed URL.
 *
 * Trình duyệt KHÔNG load được `gs://` trực tiếp. Ảnh đề HSK (và ảnh import OCR)
 * lưu dạng gs:// trong DB; route này 302-redirect sang signed URL để <img>/<audio>
 * hiển thị được, mà KHÔNG phải đổi giá trị lưu trong DB (admin vẫn sửa/lưu gs://).
 *
 * Public giống trang xem đáp án (vốn đã expose signed audio URL). Chặn lạm dụng
 * bằng allowlist bucket — chỉ ký object trong bucket của HanXue.
 */

const express = require('express');
const router = express.Router();
const gcs = require('../services/gcs.service');

const GS_RE = /^gs:\/\/([^/]+)\/(.+)$/;
// Cache signed URL để không phải ký lại mỗi lần load (signed TTL 24h → cache 12h).
const SIGN_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const signCache = new Map(); // ref → { url, expiresAt }

function allowedBuckets() {
    const set = new Set();
    for (const kind of ['image', 'audio']) {
        const b = gcs.getBucketName(kind);
        if (b) set.add(b);
    }
    return set;
}

// GET /api/media/img?ref=gs://bucket/object → 302 signed URL
router.get('/img', async (req, res) => {
    try {
        const ref = String(req.query.ref || '');
        const m = ref.match(GS_RE);
        if (!m) return res.status(400).json({ error: 'ref phải dạng gs://bucket/object' });
        const bucket = m[1];
        const object = m[2];
        if (!allowedBuckets().has(bucket)) {
            return res.status(403).json({ error: 'Bucket không được phép' });
        }
        if (object.includes('..')) {
            return res.status(400).json({ error: 'object không hợp lệ' });
        }

        const now = Date.now();
        const cached = signCache.get(ref);
        let url = cached && cached.expiresAt > now ? cached.url : null;
        if (!url) {
            url = await gcs.getSignedReadUrl(bucket, object);
            signCache.set(ref, { url, expiresAt: now + SIGN_CACHE_TTL_MS });
        }

        // Cho phép browser cache redirect ngắn để giảm round-trip khi 1 trang có
        // nhiều ảnh (vd lưới A-F). Ngắn hơn nhiều so với TTL signed URL.
        res.set('Cache-Control', 'private, max-age=600');
        return res.redirect(302, url);
    } catch (e) {
        console.error('[media] resolve failed:', e.message);
        return res.status(502).json({ error: 'Không resolve được media' });
    }
});

module.exports = router;
