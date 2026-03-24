/**
 * Speech Controller
 * Handles Azure Speech endpoints (Phase C)
 * - POST /api/speech/transcribe     — STT
 * - POST /api/speech/pronunciation   — Pronunciation assessment
 * - POST /api/speech/tts             — Text-to-speech
 */

const crypto = require('crypto');
const azureSpeech = require('../services/azureSpeech');

function genRequestId() {
    return 'speech-' + crypto.randomBytes(4).toString('hex');
}

/**
 * POST /api/speech/transcribe
 * Body: multipart/form-data with 'audio' file field
 * Response: { success, data: { text, language, confidence } }
 */
async function transcribe(req, res) {
    const requestId = genRequestId();
    try {
        const userId = req.user.userId;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng gửi file âm thanh (trường "audio").'
            });
        }

        console.log(`[${requestId}] Transcribe: userId=${userId}, fileSize=${req.file.size}, mime=${req.file.mimetype}`);

        const result = await azureSpeech.transcribe(req.file.buffer, requestId);

        return res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error(`[${requestId}] Transcribe error:`, {
            message: error.message,
            status: error.status,
            stack: error.stack,
        });
        const httpStatus = [400, 429, 502, 503, 504].includes(error.status) ? error.status : 500;
        return res.status(httpStatus).json({
            success: false,
            message: error.publicMessage || 'Lỗi nhận diện giọng nói. Vui lòng thử lại.',
        });
    }
}

/**
 * POST /api/speech/pronunciation
 * Body: multipart/form-data with 'audio' file + 'referenceText' field
 * Response: { success, data: { recognizedText, referenceText, scores, words, feedback } }
 */
async function pronunciation(req, res) {
    const requestId = genRequestId();
    try {
        const userId = req.user.userId;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng gửi file âm thanh (trường "audio").'
            });
        }

        const referenceText = req.body.referenceText;
        if (!referenceText || typeof referenceText !== 'string' || !referenceText.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng gửi referenceText (văn bản tham chiếu).'
            });
        }

        console.log(`[${requestId}] Pronunciation: userId=${userId}, ref="${referenceText.slice(0, 50)}", fileSize=${req.file.size}`);

        const result = await azureSpeech.assessPronunciation(
            req.file.buffer,
            referenceText.trim(),
            requestId
        );

        return res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error(`[${requestId}] Pronunciation error:`, {
            message: error.message,
            status: error.status,
            stack: error.stack,
        });
        const httpStatus = [400, 429, 502, 503, 504].includes(error.status) ? error.status : 500;
        return res.status(httpStatus).json({
            success: false,
            message: error.publicMessage || 'Lỗi chấm phát âm. Vui lòng thử lại.',
        });
    }
}

/**
 * POST /api/speech/tts
 * Body: JSON { text, voice? }
 * Response: audio/wav binary
 */
async function tts(req, res) {
    const requestId = genRequestId();
    try {
        const userId = req.user.userId;
        const { text } = req.body;

        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng gửi text cần đọc.'
            });
        }

        if (text.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Text quá dài (tối đa 500 ký tự).'
            });
        }

        console.log(`[${requestId}] TTS: userId=${userId}, textLen=${text.length}`);

        const audioBuffer = await azureSpeech.synthesize(text.trim(), requestId);

        res.set({
            'Content-Type': 'audio/wav',
            'Content-Length': audioBuffer.length,
            'Cache-Control': 'no-cache',
        });
        return res.send(audioBuffer);
    } catch (error) {
        console.error(`[${requestId}] TTS error:`, {
            message: error.message,
            status: error.status,
            stack: error.stack,
        });
        const httpStatus = [429, 502, 503, 504].includes(error.status) ? error.status : 500;
        return res.status(httpStatus).json({
            success: false,
            message: error.publicMessage || 'Lỗi tổng hợp giọng nói. Vui lòng thử lại.',
        });
    }
}

module.exports = {
    transcribe,
    pronunciation,
    tts,
};
