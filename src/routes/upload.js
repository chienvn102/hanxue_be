/**
 * Upload Routes
 * Handles admin media uploads. Uses GCS when buckets are configured, otherwise
 * falls back to the legacy local public/uploads directory for local dev.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminMiddleware = require('../middleware/admin.middleware');
const { authMiddleware } = require('../middleware/auth');
const gcs = require('../services/gcs.service');

const router = express.Router();

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function extFromOriginalName(originalName) {
    return path.extname(originalName || '').toLowerCase();
}

function uniqueFilename(prefix, originalName) {
    return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extFromOriginalName(originalName)}`;
}

async function saveLocal({ kind, file, filename }) {
    const dir = path.join(__dirname, `../../public/uploads/${kind}`);
    ensureDir(dir);
    const fullPath = path.join(dir, filename);
    await fs.promises.writeFile(fullPath, file.buffer);
    return `/uploads/${kind}/${filename}`;
}

async function handleMediaUpload(req, res, { kind, field, prefix }) {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: `No ${field} file uploaded` });
        }

        const filename = uniqueFilename(prefix, file.originalname);
        const bucketName = gcs.getBucketName(kind === 'images' ? 'image' : 'audio');

        let url;
        if (bucketName) {
            const objectName = `uploads/${kind}/${filename}`;
            url = await gcs.uploadBuffer({
                bucketName,
                objectName,
                buffer: file.buffer,
                contentType: file.mimetype,
                publicRead: process.env.GCS_UPLOAD_PUBLIC === 'true',
            });
        } else {
            url = await saveLocal({ kind, file, filename });
        }

        return res.json({
            success: true,
            url,
            filename,
            originalName: file.originalname,
            size: file.size,
        });
    } catch (error) {
        console.error(`${kind} upload error:`, error);
        return res.status(error.status || 500).json({
            success: false,
            message: error.publicMessage || 'Upload failed',
            error: error.message,
        });
    }
}

async function deleteLocal(kind, filename) {
    const filePath = path.join(__dirname, `../../public/uploads/${kind}`, filename);
    if (!fs.existsSync(filePath)) return false;
    await fs.promises.unlink(filePath);
    return true;
}

const memoryStorage = multer.memoryStorage();

const audioUpload = multer({
    storage: memoryStorage,
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/ogg', 'audio/webm'];
        if (allowedMimes.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Invalid file type. Only audio files are allowed.'), false);
    },
    limits: { fileSize: 10 * 1024 * 1024 },
});

const imageUpload = multer({
    storage: memoryStorage,
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedMimes.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Invalid file type. Only image files (JPEG, PNG, WebP, GIF) are allowed.'), false);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/audio', adminMiddleware, audioUpload.single('audio'), (req, res) =>
    handleMediaUpload(req, res, { kind: 'audio', field: 'audio', prefix: 'audio' })
);

router.delete('/audio/:filename', adminMiddleware, async (req, res) => {
    try {
        const deleted = await deleteLocal('audio', req.params.filename);
        return deleted
            ? res.json({ success: true, message: 'File deleted' })
            : res.status(404).json({ success: false, message: 'File not found or stored in GCS' });
    } catch (error) {
        console.error('Delete audio error:', error);
        return res.status(500).json({ success: false, message: 'Delete failed', error: error.message });
    }
});

router.post('/image', adminMiddleware, imageUpload.single('image'), (req, res) =>
    handleMediaUpload(req, res, { kind: 'images', field: 'image', prefix: 'img' })
);

// User-side avatar upload (any authenticated user, smaller size cap)
const avatarUpload = multer({
    storage: memoryStorage,
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Chỉ chấp nhận JPEG/PNG/WebP cho avatar.'), false);
    },
    limits: { fileSize: 2 * 1024 * 1024 },
});

router.post('/avatar', authMiddleware, avatarUpload.single('image'), (req, res) =>
    handleMediaUpload(req, res, { kind: 'images', field: 'image', prefix: `avatar-u${req.user.userId}` })
);

router.delete('/image/:filename', adminMiddleware, async (req, res) => {
    try {
        const deleted = await deleteLocal('images', req.params.filename);
        return deleted
            ? res.json({ success: true, message: 'File deleted' })
            : res.status(404).json({ success: false, message: 'File not found or stored in GCS' });
    } catch (error) {
        console.error('Delete image error:', error);
        return res.status(500).json({ success: false, message: 'Delete failed', error: error.message });
    }
});

module.exports = router;
