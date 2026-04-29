/**
 * Speech Routes
 * Mount: /api/speech
 * All routes require auth
 */

const express = require('express');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth'); // P0 fix: destructure
const speechController = require('../controllers/speech.controller');
const { speechRateLimit } = require('../middleware/speechRateLimit');

const router = express.Router();

// Multer: accept WAV audio only (Azure Speech SDK expects WAV/PCM)
// FE must convert to WAV before uploading (or we add ffmpeg conversion later)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['audio/wav', 'audio/wave', 'audio/x-wav'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Chỉ hỗ trợ file WAV. Nhận được: ${file.mimetype}`));
        }
    },
});

// All speech routes require auth
router.use(authMiddleware);

// Session-based quota: only the heavy operations (transcribe, pronunciation)
// consume daily quota. TTS (sample/feedback playback) is free so 1 practice
// session = 1 quota unit (the pronunciation submit), not 2-3.
router.post('/transcribe', speechRateLimit, upload.single('audio'), speechController.transcribe);
router.post('/pronunciation', speechRateLimit, upload.single('audio'), speechController.pronunciation);

// POST /api/speech/tts — no daily quota; light per-request guard via text length cap in controller.
router.post('/tts', speechController.tts);

// Multer error handler
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                message: 'File âm thanh quá lớn (tối đa 10MB).'
            });
        }
        return res.status(400).json({
            success: false,
            message: `Lỗi upload: ${err.message}`
        });
    }
    if (err.message && err.message.includes('Chỉ hỗ trợ file WAV')) {
        return res.status(415).json({
            success: false,
            message: err.message
        });
    }
    next(err);
});

module.exports = router;
