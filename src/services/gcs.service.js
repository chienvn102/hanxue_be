/**
 * Google Cloud Storage helper for media uploads.
 */

const path = require('path');

let storageClient;

function getStorage() {
    if (storageClient) return storageClient;
    const { Storage } = require('@google-cloud/storage');
    storageClient = new Storage();
    return storageClient;
}

function getBucketName(kind = 'audio') {
    if (kind === 'image') return process.env.GCS_BUCKET_IMAGES || process.env.GCS_BUCKET_MEDIA;
    return process.env.GCS_BUCKET_AUDIO || process.env.GCS_BUCKET_MEDIA;
}

function safeObjectName(prefix, originalName) {
    const ext = path.extname(originalName || '').toLowerCase();
    const base = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    return `${prefix.replace(/^\/+|\/+$/g, '')}/${base}`;
}

function publicUrl(bucketName, objectName) {
    const base = process.env.GCS_PUBLIC_BASE_URL || 'https://storage.googleapis.com';
    return `${base.replace(/\/$/, '')}/${bucketName}/${encodeURI(objectName)}`;
}

/**
 * Upload buffer lên GCS. Bucket dùng uniform bucket-level access → KHÔNG được
 * gọi object-level ACL (`makePublic`). Caller dùng `getSignedReadUrl` hoặc
 * `audioUrl.service.resolveAudioUrl` khi cần phục vụ URL.
 * Trả về reference `{ bucketName, objectName }` để controller lưu vào DB
 * dưới dạng `gs://<bucket>/<object>`.
 */
async function uploadBuffer({ bucketName, objectName, buffer, contentType }) {
    if (!bucketName) {
        const err = new Error('GCS bucket is not configured');
        err.publicMessage = 'Kho luu tru media chua duoc cau hinh.';
        err.status = 500;
        throw err;
    }

    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, {
        resumable: false,
        metadata: {
            contentType: contentType || 'application/octet-stream',
            cacheControl: 'private, max-age=3600',
        },
    });

    return { bucketName, objectName };
}

const DEFAULT_SIGNED_URL_TTL_MS = parseInt(process.env.GCS_SIGNED_URL_TTL_MS || '86400000', 10);

async function getSignedReadUrl(bucketName, objectName, expiresMs = DEFAULT_SIGNED_URL_TTL_MS) {
    const [url] = await getStorage()
        .bucket(bucketName)
        .file(objectName)
        .getSignedUrl({
            action: 'read',
            expires: Date.now() + expiresMs,
        });
    return url;
}

module.exports = {
    getBucketName,
    safeObjectName,
    uploadBuffer,
    getSignedReadUrl,
    publicUrl,
    DEFAULT_SIGNED_URL_TTL_MS,
};
