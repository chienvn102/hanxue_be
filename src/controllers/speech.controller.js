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
const azureSpeech = require('../services/azureSpeech');
const gemini = require('../services/gemini.service');
const pinyinService = require('../services/pinyin.service');
const pronunciationFeedbackService = require('../services/pronunciationFeedback.service');
const { incrementDailySpeechCount } = require('../middleware/speechRateLimit');

function isAzureConfigured() {
    return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

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

        const useAzure = isAzureConfigured();
        console.log(`[${requestId}] Pronunciation: userId=${userId}, ref="${referenceText.slice(0, 50)}", fileSize=${req.file.size}, provider=${useAzure ? 'azure' : 'cloud-speech-fallback'}`);

        // Primary: Azure Speech với phoneme-level scoring. Fallback: Cloud Speech +
        // Levenshtein diff (kém chính xác hơn nhưng vẫn chạy được nếu Azure xuống).
        const result = useAzure
            ? await azureSpeech.assessPronunciation(req.file.buffer, referenceText.trim(), requestId)
            : await cloudSpeech.assessPronunciation(req.file.buffer, referenceText.trim(), requestId);
        result.provider = useAzure ? 'azure' : 'cloud-speech';

        // Bilingual feedback rule-based (giữ legacy).
        const bilingual = pronunciationFeedbackService.generateFeedback(result);
        result.feedback = bilingual.zh;     // backwards compat: TTS reads this
        result.feedbackVi = bilingual.vi;   // new: shown to learner

        // Gemini layer — lấy phoneme-level từ Azure để feedback chi tiết bằng tiếng Việt.
        // Nếu provider là Cloud Speech fallback (không có phoneme) thì prompt sẽ nhận
        // weakPhonemes rỗng → Gemini tự xử lý mặc dù feedback ít chi tiết hơn.
        try {
            const referencePinyin = String(
                req.body.referencePinyin
                || pinyinService.convert(referenceText).join(' ')
            );
            const detectedPinyin = pinyinService.convert(result.recognizedText).join(' ');
            const weakPhonemes = (result.words || []).flatMap(w =>
                Array.isArray(w.phonemes)
                    ? w.phonemes
                        .filter(p => (p.accuracyScore ?? 100) < 60)
                        .map(p => ({ phoneme: p.phoneme, score: p.accuracyScore, word: w.word }))
                    : []
            ).slice(0, 12); // cap để khỏi tốn token
            const wrongWords = (result.words || [])
                .filter(w => (w.accuracyScore ?? 100) < 70)
                .map(w => `${w.word}(${w.accuracyScore})`)
                .slice(0, 10)
                .join(', ') || 'không có';

            const ai = await gemini.chat([
                {
                    role: 'system',
                    content: 'Ban la giao vien phat am tieng Trung chuyen nghiep. Tra ve CHI JSON hop le, ngan gon, cu the.',
                },
                {
                    role: 'user',
                    content:
                        `Hoc vien HSK ${req.user?.targetHsk || 1} luyen doc: "${referenceText}" (${referencePinyin}).\n` +
                        `Azure ghi nhan:\n` +
                        `- Pronunciation: ${result.pronunciationScore}/100\n` +
                        `- Accuracy: ${result.accuracyScore}, Fluency: ${result.fluencyScore}, Completeness: ${result.completenessScore}\n` +
                        `- Hoc vien noi: "${result.recognizedText}" (${detectedPinyin})\n` +
                        `- Tu phat am sai: ${wrongWords}\n` +
                        `- Phoneme yeu (<60): ${weakPhonemes.length ? JSON.stringify(weakPhonemes) : 'khong co'}\n\n` +
                        'Hay:\n' +
                        '1. Liet ke CHINH XAC 1-3 loi quan trong nhat (tone/initial/final), kem cach sua bang tieng Viet.\n' +
                        '2. Cho 2 bai tap ngan (1 dong/bai) bang tieng Viet kem tu Trung mau.\n' +
                        '3. Tra JSON: {"score":0-100,"highlights":[{"phoneme":"...","error":"...","fix_vi":"..."}],"tone_errors":[{"word":"...","expected_tone":"...","detected_tone":"..."}],"phoneme_errors":[{"word":"...","phoneme":"...","fix_vi":"..."}],"exercises":["..."],"feedback_vi":"...","summary_vi":"..."}\n' +
                        'KHONG bia neu khong co du lieu cu the.',
                },
            ], { temperature: 0.2, maxOutputTokens: 900 });
            const parsed = JSON.parse(gemini.unwrapJsonFence(ai.text));
            result.aiFeedback = parsed;
            result.weakPhonemes = weakPhonemes;
            if (Number.isFinite(Number(parsed.score))) {
                result.pronunciationScore = Math.max(0, Math.min(100, Number(parsed.score)));
            }
            if (parsed.feedback_vi || parsed.summary_vi) {
                result.feedbackVi = parsed.feedback_vi || parsed.summary_vi;
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
