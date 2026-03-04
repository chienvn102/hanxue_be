/**
 * Upload Routes
 * Handles file uploads for the admin (audio + images)
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminMiddleware = require('../middleware/admin.middleware');

const router = express.Router();

// Helper: ensure directory exists
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ============================================================
// Audio Upload
// ============================================================

const audioStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../public/uploads/audio');
        ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'audio-' + uniqueSuffix + ext);
    }
});

const audioFilter = (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/ogg', 'audio/webm'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only audio files are allowed.'), false);
    }
};

const audioUpload = multer({
    storage: audioStorage,
    fileFilter: audioFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.post('/audio', adminMiddleware, audioUpload.single('audio'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const relativePath = `/uploads/audio/${req.file.filename}`;

        res.json({
            success: true,
            url: relativePath,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
    }
});

router.delete('/audio/:filename', adminMiddleware, (req, res) => {
    try {
        const filePath = path.join(__dirname, '../../public/uploads/audio', req.params.filename);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ success: true, message: 'File deleted' });
        } else {
            res.status(404).json({ success: false, message: 'File not found' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, message: 'Delete failed', error: error.message });
    }
});

// ============================================================
// Image Upload
// ============================================================

const imageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../public/uploads/images');
        ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'img-' + uniqueSuffix + ext);
    }
});

const imageFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only image files (JPEG, PNG, WebP, GIF) are allowed.'), false);
    }
};

const imageUpload = multer({
    storage: imageStorage,
    fileFilter: imageFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

router.post('/image', adminMiddleware, imageUpload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const relativePath = `/uploads/images/${req.file.filename}`;

        res.json({
            success: true,
            url: relativePath,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
    }
});

router.delete('/image/:filename', adminMiddleware, (req, res) => {
    try {
        const filePath = path.join(__dirname, '../../public/uploads/images', req.params.filename);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ success: true, message: 'File deleted' });
        } else {
            res.status(404).json({ success: false, message: 'File not found' });
        }
    } catch (error) {
        console.error('Image delete error:', error);
        res.status(500).json({ success: false, message: 'Delete failed', error: error.message });
    }
});

module.exports = router;
