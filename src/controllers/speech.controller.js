/**
 * Speech Controller
 * Handles Azure Speech endpoints (Phase C)
 * - POST /api/speech/transcribe     — STT
 * - POST /api/speech/pronunciation   — Pronunciation assessment
 * - POST /api/speech/tts             — Text-to-speech
 */

const crypto = require('crypto');
const cloudSpeech = require('../services/cloudSpeech.service');
const cloudTts = require('../services/cloudTts.service');
const gemini = require('../services/gemini.service');
const pinyinService = require('../services/pinyin.service');
const pronunciationFeedbackService = require('../services/pronunciationFeedback.service');
const { incrementDailySpeechCount } = require('../middleware/speechRateLimit');

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

        const result = await cloudSpeech.transcribe(req.file.buffer, { requestId });

        // Increment speech count after successful request
        incrementDailySpeechCount(userId).catch(err => {
            console.error('Failed to increment speech count:', err);
        });

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

        const result = await cloudSpeech.assessPronunciation(
            req.file.buffer,
            referenceText.trim(),
            requestId
        );

        // Generate bilingual feedback (Chinese for TTS, Vietnamese for display)
        const bilingual = pronunciationFeedbackService.generateFeedback(result);
        result.feedback = bilingual.zh;     // backwards compat: TTS reads this
        result.feedbackVi = bilingual.vi;   // new: shown to learner

        try {
            const referencePinyin = String(req.body.referencePinyin || pinyinService.convert(referenceText).join(' '));
            const detectedPinyin = pinyinService.convert(result.recognizedText).join(' ');
            const ai = await gemini.chat([
                {
                    role: 'system',
                    content: 'Ban la giao vien phat am tieng Trung. Tra ve CHI JSON hop le, ngan gon.',
                },
                {
                    role: 'user',
                    content:
                        `Reference: ${referenceText} (${referencePinyin})\n` +
                        `Hoc vien noi: ${result.recognizedText} (${detectedPinyin})\n` +
                        `Score tam tinh: ${result.pronunciationScore}\n\n` +
                        'Tra JSON: {"score":0-100,"tone_errors":[],"phoneme_errors":[],"exercises":["..."],"feedback_vi":"..."}',
                },
            ], { temperature: 0.2, maxOutputTokens: 700 });
            const parsed = JSON.parse(gemini.unwrapJsonFence(ai.text));
            result.aiFeedback = parsed;
            if (Number.isFinite(Number(parsed.score))) {
                result.pronunciationScore = Math.max(0, Math.min(100, Number(parsed.score)));
            }
            if (parsed.feedback_vi) {
                result.feedbackVi = parsed.feedback_vi;
            }
        } catch (aiErr) {
            console.error(`[${requestId}] Pronunciation AI feedback skipped:`, aiErr.message);
        }

        // Increment speech count after successful request
        incrementDailySpeechCount(userId).catch(err => {
            console.error('Failed to increment speech count:', err);
        });

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

        const audioBuffer = await cloudTts.synthesize(text.trim(), {
            voice: req.body.voice || req.user?.preferredVoice || 'female',
        });

        // TTS does NOT consume daily quota — sample/feedback playback should be free
        // so a practice session costs 1 unit (the pronunciation submit), not 2-3.

        res.set({
            'Content-Type': audioBuffer.contentType || 'audio/mpeg',
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
