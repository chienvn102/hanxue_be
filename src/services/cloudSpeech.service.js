/**
 * Google Cloud Speech-to-Text service.
 * Replaces Azure Speech STT/pronunciation with Google STT plus local alignment.
 */

const DEFAULT_LANGUAGE = process.env.GCP_SPEECH_LANGUAGE || 'cmn-Hans-CN';
const DEFAULT_SAMPLE_RATE = parseInt(process.env.GCP_SPEECH_SAMPLE_RATE || '16000', 10);
const TIMEOUT_MS = parseInt(process.env.GCP_SPEECH_TIMEOUT_MS || '20000', 10);

let speechClient;

function getClient() {
    if (speechClient) return speechClient;
    const speech = require('@google-cloud/speech');
    speechClient = new speech.SpeechClient();
    return speechClient;
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`${label} timed out after ${ms}ms`);
                err.publicMessage = 'Xu ly giong noi qua cham, vui long thu lai.';
                err.status = 504;
                reject(err);
            }, ms);
        }),
    ]);
}

function normalizeChinese(text) {
    return String(text || '').replace(/[^\u3400-\u9fff]/g, '');
}

function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[m][n];
}

async function transcribe(audioBuffer, { languageCode = DEFAULT_LANGUAGE, sampleRateHertz = DEFAULT_SAMPLE_RATE } = {}) {
    try {
        const client = getClient();
        const [response] = await withTimeout(
            client.recognize({
                audio: { content: audioBuffer.toString('base64') },
                config: {
                    languageCode,
                    encoding: 'LINEAR16',
                    sampleRateHertz,
                    enableWordTimeOffsets: true,
                    enableWordConfidence: true,
                    model: 'latest_long',
                },
            }),
            TIMEOUT_MS,
            'Cloud Speech'
        );

        const alternatives = (response.results || [])
            .map(r => r.alternatives?.[0])
            .filter(Boolean);
        const transcript = alternatives.map(a => a.transcript || '').join(' ').trim();
        const words = alternatives.flatMap(a => a.words || []);
        const confidences = alternatives
            .map(a => typeof a.confidence === 'number' ? a.confidence : null)
            .filter(v => v !== null);
        const confidence = confidences.length
            ? confidences.reduce((sum, v) => sum + v, 0) / confidences.length
            : 0;

        return {
            text: transcript,
            transcript,
            language: languageCode,
            confidence,
            words,
        };
    } catch (error) {
        const err = new Error(error.message || 'Cloud Speech failed');
        err.publicMessage = error.publicMessage || 'Khong nhan dien duoc giong noi. Vui long thu lai.';
        err.status = error.status || 502;
        throw err;
    }
}

async function assessPronunciation(audioBuffer, referenceText, requestId) {
    if (!referenceText || referenceText.length > 200) {
        const err = new Error('Invalid reference text');
        err.publicMessage = 'Van ban tham chieu khong hop le hoac qua dai.';
        err.status = 400;
        throw err;
    }

    const result = await transcribe(audioBuffer);
    const expected = normalizeChinese(referenceText);
    const actual = normalizeChinese(result.text);
    const distance = levenshtein(expected, actual);
    const maxLen = Math.max(expected.length, actual.length, 1);
    const accuracyScore = Math.max(0, Math.round((1 - distance / maxLen) * 100));
    const completenessScore = expected.length
        ? Math.max(0, Math.min(100, Math.round((actual.length / expected.length) * 100)))
        : 0;
    const pronunciationScore = Math.round((accuracyScore * 0.75) + (completenessScore * 0.25));

    if (requestId) {
        console.log(`[${requestId}] Cloud pronunciation: score=${pronunciationScore}, transcript="${result.text}"`);
    }

    return {
        recognizedText: result.text,
        referenceText,
        accuracyScore,
        fluencyScore: result.confidence ? Math.round(result.confidence * 100) : accuracyScore,
        completenessScore,
        pronunciationScore,
        words: result.words.map(w => ({
            word: w.word,
            accuracyScore: typeof w.confidence === 'number' ? Math.round(w.confidence * 100) : null,
            errorType: 'None',
            phonemes: [],
        })),
        weakPhonemes: [],
        feedback: null,
    };
}

module.exports = {
    transcribe,
    assessPronunciation,
};
