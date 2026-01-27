/**
 * Upload Routes
 * Handles file uploads for the admin
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminMiddleware = require('../middleware/admin.middleware');

const router = express.Router();

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../public/uploads/audio');
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'audio-' + uniqueSuffix + ext);
    }
});

// File filter for audio files
const fileFilter = (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/ogg', 'audio/webm'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only audio files are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Upload audio file
router.post('/audio', adminMiddleware, upload.single('audio'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        // Return the URL to access the file
        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
        const fileUrl = `${baseUrl}/uploads/audio/${req.file.filename}`;

        res.json({
            success: true,
            url: fileUrl,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
    }
});

// Delete uploaded file
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

module.exports = router;
