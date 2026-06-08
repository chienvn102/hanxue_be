/**
 * Pronunciation Lab routes — mount: /api/pronunciation
 * All routes require auth. Multipart endpoints accept WAV only (mono PCM 16-bit).
 */

const express = require('express');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const ctrl = require('../controllers/pronunciation.controller');

const router = express.Router();

// Reuse the same WAV-only multer config as the /speech routes — FE produces
// WAV via audioRecorder.ts so both endpoints accept the same format.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024 }, // 6MB — syllables are short
    fileFilter: (_req, file, cb) => {
        const allowed = ['audio/wav', 'audio/wave', 'audio/x-wav'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error(`Chỉ hỗ trợ file WAV. Nhận được: ${file.mimetype}`));
    },
});

router.use(authMiddleware);

// Read-only endpoints — fast, no rate limit
router.get('/pinyin-chart', ctrl.getPinyinChart);
router.get('/audio', ctrl.getAudio);
router.get('/minimal-pairs', ctrl.listMinimalPairs);
router.get('/due', ctrl.getDue);
router.get('/stats', ctrl.getStats);

// Drill submit endpoints
router.post('/tone-trainer', upload.single('audio'), ctrl.toneTrainerSubmit);
router.post('/tone-match', ctrl.toneMatchSubmit);
router.post('/shadow', upload.single('audio'), ctrl.shadowSubmit);
router.post('/minimal-pair', ctrl.minimalPairSubmit);

// Multer error handler
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, message: 'File âm thanh quá lớn (tối đa 6MB).' });
        }
        return res.status(400).json({ success: false, message: `Lỗi upload: ${err.message}` });
    }
    if (err.message && err.message.includes('Chỉ hỗ trợ file WAV')) {
        return res.status(415).json({ success: false, message: err.message });
    }
    next(err);
});

module.exports = router;
