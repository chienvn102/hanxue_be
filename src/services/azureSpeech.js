/**
 * DEPRECATED: Azure Speech Service.
 *
 * HanXue now uses cloudSpeech.service.js and cloudTts.service.js. This file is
 * kept only as a rollback shim during deployment verification.
 *
 * Wrapper for Azure Cognitive Services Speech SDK
 * Features: STT (transcribe), pronunciation assessment, TTS
 *
 * Error convention (same as groq.js):
 *   - throw with { publicMessage, status } for controller
 *   - internal details in message (logs only)
 */

let sdk;
try {
    sdk = require('microsoft-cognitiveservices-speech-sdk');
} catch {
    console.error('[azureSpeech] WARN: microsoft-cognitiveservices-speech-sdk not installed. Speech features disabled. Run: npm install');
    // Export stub functions so app doesn't crash
    const notInstalled = () => {
        const err = new Error('Azure Speech SDK not installed');
        err.publicMessage = 'Chức năng giọng nói chưa sẵn sàng. Vui lòng liên hệ admin.';
        err.status = 503;
        throw err;
    };
    module.exports = { transcribe: notInstalled, assessPronunciation: notInstalled, synthesize: notInstalled };
    return;
}

const DEFAULTS = {
    language: process.env.AZURE_SPEECH_LANGUAGE || 'zh-CN',
    voice: process.env.AZURE_SPEECH_VOICE || 'zh-CN-XiaoxiaoNeural',
    timeoutMs: parseInt(process.env.AZURE_SPEECH_TIMEOUT_MS) || 15000,
};

/**
 * Create a SpeechConfig from env
 */
function createSpeechConfig() {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) {
        const err = new Error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not configured');
        err.publicMessage = 'Dịch vụ nhận diện giọng nói chưa được cấu hình.';
        err.status = 500;
        throw err;
    }
    const config = sdk.SpeechConfig.fromSubscription(key, region);
    config.speechRecognitionLanguage = DEFAULTS.language;
    return config;
}

/**
 * Wrap an SDK operation with timeout
 */
function withTimeout(promise, ms, label) {
    let timer;
    const wrapped = promise.finally(() => clearTimeout(timer));
    return Promise.race([
        wrapped,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`${label} timed out after ${ms}ms`);
                err.publicMessage = 'Xử lý giọng nói quá chậm, vui lòng thử lại.';
                err.status = 504;
                reject(err);
            }, ms);
        }),
    ]);
}

/**
 * Transcribe audio buffer to text (STT)
 * @param {Buffer} audioBuffer - WAV audio buffer (mono 16kHz PCM recommended)
 * @param {string} [requestId] - correlation ID
 * @returns {Promise<{text: string, language: string, confidence: number}>}
 */
async function transcribe(audioBuffer, requestId) {
    const logPrefix = requestId ? `[${requestId}]` : '[speech]';
    const speechConfig = createSpeechConfig();

    // Use fromWavFileInput which correctly parses WAV headers + PCM data
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    try {
        const result = await withTimeout(
            new Promise((resolve, reject) => {
                recognizer.recognizeOnceAsync(
                    (res) => resolve(res),
                    (err) => reject(err)
                );
            }),
            DEFAULTS.timeoutMs,
            'Transcribe'
        );

        if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            console.log(`${logPrefix} Transcribed: "${result.text}" (duration=${result.duration})`);
            return {
                text: result.text,
                language: DEFAULTS.language,
                confidence: 1.0, // SDK doesn't expose confidence for single recognition
            };
        } else if (result.reason === sdk.ResultReason.NoMatch) {
            console.log(`${logPrefix} No speech recognized`);
            return { text: '', language: DEFAULTS.language, confidence: 0 };
        } else {
            const detail = result.errorDetails || 'Unknown recognition error';
            console.error(`${logPrefix} Recognition failed: ${detail}`);
            const err = new Error(`Speech recognition failed: ${detail}`);
            err.publicMessage = 'Không nhận diện được giọng nói. Vui lòng thử lại.';
            err.status = 502;
            throw err;
        }
    } finally {
        recognizer.close();
    }
}

/**
 * Assess pronunciation against reference text
 * @param {Buffer} audioBuffer - WAV audio buffer
 * @param {string} referenceText - Expected Chinese text
 * @param {string} [requestId] - correlation ID
 * @returns {Promise<PronunciationResult>}
 */
async function assessPronunciation(audioBuffer, referenceText, requestId) {
    const logPrefix = requestId ? `[${requestId}]` : '[speech]';

    // P2: limit reference text length to prevent abuse
    if (referenceText.length > 200) {
        const err = new Error('Reference text too long');
        err.publicMessage = 'Văn bản tham chiếu quá dài (tối đa 200 ký tự).';
        err.status = 400;
        throw err;
    }

    const speechConfig = createSpeechConfig();

    // Use fromWavFileInput which correctly parses WAV headers + PCM data
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    // Configure pronunciation assessment - PHONEME LEVEL
    const pronConfig = new sdk.PronunciationAssessmentConfig(
        referenceText,
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Phoneme, // Changed from Word to Phoneme
        true // enable miscue
    );

    // Enable phoneme-level details
    pronConfig.phonemeAlphabet = 'IPA';
    pronConfig.nbestPhonemeCount = 5; // Get top 5 phoneme alternatives

    pronConfig.applyTo(recognizer);

    try {
        const result = await withTimeout(
            new Promise((resolve, reject) => {
                recognizer.recognizeOnceAsync(
                    (res) => resolve(res),
                    (err) => reject(err)
                );
            }),
            20000, // pronunciation needs more time
            'PronunciationAssess'
        );

        if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            const pronResult = sdk.PronunciationAssessmentResult.fromResult(result);

            const words = [];
            const weakPhonemes = [];

            if (pronResult.detailResult?.Words) {
                for (const w of pronResult.detailResult.Words) {
                    const wordData = {
                        word: w.Word,
                        accuracyScore: w.PronunciationAssessment?.AccuracyScore ?? null,
                        errorType: w.PronunciationAssessment?.ErrorType || 'None',
                        phonemes: [] // NEW: Phoneme-level data
                    };

                    // Extract phoneme data
                    if (w.PronunciationAssessment?.DetailResult?.Phonemes) {
                        for (const p of w.PronunciationAssessment.DetailResult.Phonemes) {
                            const phonemeData = {
                                phoneme: p.Phoneme,
                                accuracyScore: p.AccuracyScore,
                                errorType: p.ErrorType || 'None'
                            };
                            wordData.phonemes.push(phonemeData);

                            // Track weak phonemes
                            if (p.AccuracyScore < 70) {
                                weakPhonemes.push({
                                    word: w.Word,
                                    phoneme: p.Phoneme,
                                    accuracyScore: p.AccuracyScore,
                                    errorType: p.ErrorType || 'None'
                                });
                            }
                        }
                    }

                    words.push(wordData);
                }
            }

            // Generate feedback based on score (simplified - detailed feedback will be generated by rule engine)
            const pronScore = pronResult.pronunciationScore;
            let feedback;
            if (pronScore >= 85) {
                feedback = 'Xuất sắc! Phát âm rất chuẩn.';
            } else if (pronScore >= 70) {
                feedback = 'Tốt! Cần chỉnh 1-2 âm nhỏ.';
            } else {
                feedback = 'Cần luyện thêm. Thử đọc chậm từng từ.';
            }

            const response = {
                recognizedText: result.text,
                referenceText,
                accuracyScore: pronResult.accuracyScore,
                fluencyScore: pronResult.fluencyScore,
                completenessScore: pronResult.completenessScore,
                pronunciationScore: pronScore,
                words,
                weakPhonemes, // NEW: Phoneme-level weak points
                feedback: null // Will be generated by rule engine in controller
            };

            console.log(`${logPrefix} Pronunciation: score=${pronScore}, accuracy=${pronResult.accuracyScore}, fluency=${pronResult.fluencyScore}`);
            return response;
        } else if (result.reason === sdk.ResultReason.NoMatch) {
            const err = new Error('No speech detected for pronunciation assessment');
            err.publicMessage = 'Không nghe thấy giọng nói. Vui lòng nói rõ hơn.';
            err.status = 400;
            throw err;
        } else {
            const detail = result.errorDetails || 'Pronunciation assessment error';
            console.error(`${logPrefix} Pronunciation failed: ${detail}`);
            const err = new Error(detail);
            err.publicMessage = 'Lỗi chấm phát âm. Vui lòng thử lại.';
            err.status = 502;
            throw err;
        }
    } finally {
        recognizer.close();
    }
}

/**
 * Synthesize text to speech (TTS)
 * @param {string} text - Text to synthesize (Chinese)
 * @param {string} [requestId] - correlation ID
 * @returns {Promise<Buffer>} - WAV audio buffer
 */
async function synthesize(text, requestId) {
    const logPrefix = requestId ? `[${requestId}]` : '[speech]';
    const speechConfig = createSpeechConfig();
    speechConfig.speechSynthesisVoiceName = DEFAULTS.voice;

    // Output to pull stream (in-memory)
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

    try {
        const result = await withTimeout(
            new Promise((resolve, reject) => {
                synthesizer.speakTextAsync(
                    text,
                    (res) => resolve(res),
                    (err) => reject(err)
                );
            }),
            DEFAULTS.timeoutMs,
            'TTS'
        );

        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            console.log(`${logPrefix} TTS: ${text.length} chars -> ${result.audioData.byteLength} bytes`);
            return Buffer.from(result.audioData);
        } else {
            const detail = result.errorDetails || 'TTS error';
            console.error(`${logPrefix} TTS failed: ${detail}`);
            const err = new Error(detail);
            err.publicMessage = 'Lỗi tổng hợp giọng nói. Vui lòng thử lại.';
            err.status = 502;
            throw err;
        }
    } finally {
        synthesizer.close();
    }
}

module.exports = {
    transcribe,
    assessPronunciation,
    synthesize,
};
