/**
 * Google Cloud Text-to-Speech service.
 */

const VOICES = {
    female: process.env.GCP_TTS_VOICE_FEMALE || 'cmn-CN-Wavenet-A',
    male: process.env.GCP_TTS_VOICE_MALE || 'cmn-CN-Wavenet-B',
    female2: process.env.GCP_TTS_VOICE_FEMALE2 || 'cmn-CN-Wavenet-C',
    male2: process.env.GCP_TTS_VOICE_MALE2 || 'cmn-CN-Wavenet-D',
};

const TIMEOUT_MS = parseInt(process.env.GCP_TTS_TIMEOUT_MS || '20000', 10);

let ttsClient;

function getClient() {
    if (ttsClient) return ttsClient;
    const tts = require('@google-cloud/text-to-speech');
    ttsClient = new tts.TextToSpeechClient();
    return ttsClient;
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`${label} timed out after ${ms}ms`);
                err.publicMessage = 'Tong hop giong noi qua cham, vui long thu lai.';
                err.status = 504;
                reject(err);
            }, ms);
        }),
    ]);
}

function getContentType(audioEncoding) {
    if (audioEncoding === 'MP3') return 'audio/mpeg';
    if (audioEncoding === 'OGG_OPUS') return 'audio/ogg';
    return 'audio/wav';
}

async function synthesize(text, {
    voice = 'female',
    speed = 1.0,
    audioEncoding = process.env.GCP_TTS_AUDIO_ENCODING || 'MP3',
} = {}) {
    try {
        const client = getClient();
        const selectedVoice = VOICES[voice] || VOICES.female;
        const [response] = await withTimeout(
            client.synthesizeSpeech({
                input: { text },
                voice: {
                    languageCode: 'cmn-CN',
                    name: selectedVoice,
                },
                audioConfig: {
                    audioEncoding,
                    speakingRate: speed,
                    sampleRateHertz: audioEncoding === 'MP3' ? undefined : 24000,
                },
            }),
            TIMEOUT_MS,
            'Cloud TTS'
        );

        const buffer = Buffer.from(response.audioContent || []);
        buffer.contentType = getContentType(audioEncoding);
        buffer.audioEncoding = audioEncoding;
        return buffer;
    } catch (error) {
        const err = new Error(error.message || 'Cloud TTS failed');
        err.publicMessage = error.publicMessage || 'Loi tong hop giong noi. Vui long thu lai.';
        err.status = error.status || 502;
        throw err;
    }
}

module.exports = {
    synthesize,
    VOICES,
    getContentType,
};
