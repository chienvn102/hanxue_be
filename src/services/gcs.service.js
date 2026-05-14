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

async function uploadBuffer({ bucketName, objectName, buffer, contentType, publicRead = false }) {
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
            cacheControl: 'public, max-age=31536000',
        },
    });

    if (publicRead) {
        await file.makePublic();
    }

    return publicUrl(bucketName, objectName);
}

async function getSignedReadUrl(bucketName, objectName, expiresMs = 1000 * 60 * 60) {
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
};
