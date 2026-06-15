const db = require('../config/database');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const Vocab = require('../models/vocab.model');
const Lesson = require('../models/lesson.model');
const HskExam = require('../models/hskExam.model');
const cloudTts = require('./cloudTts.service');
const edgeTts = require('./edgeTts.service');
const gcs = require('./gcs.service');
const { resolveAudioUrl } = require('./audioUrl.service');

// Local FS root for edge-tts output. Must match the directory Express serves
// via `app.use('/audio', express.static(...))` in src/index.js — that's
// `../public/audio` relative to src/.
const PUBLIC_AUDIO_DIR = process.env.PUBLIC_AUDIO_DIR
    || path.join(__dirname, '../../public/audio');

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Upload buffer rồi trả về `gs://bucket/object` reference cho DB.
 * Caller dùng `resolveAudioUrl(...)` để lấy signed URL khi serve.
 */
async function uploadAudioToGcs(prefix, filename, buffer) {
    const { bucketName, objectName } = await gcs.uploadBuffer({
        bucketName: gcs.getBucketName('audio'),
        objectName: `${prefix.replace(/^\/+|\/+$/g, '')}/${filename}`,
        buffer,
        contentType: buffer.contentType || 'audio/mpeg',
    });
    return `gs://${bucketName}/${objectName}`;
}

async function genVocabAudio(vocabId) {
    const vocab = await Vocab.getById(vocabId);
    if (!vocab) {
        const err = new Error('Vocabulary not found');
        err.status = 404;
        throw err;
    }

    const audio = await cloudTts.synthesize(vocab.simplified, { voice: 'female', speed: 0.9 });
    const gsUrl = await uploadAudioToGcs('vocab', `${vocabId}.mp3`, audio);
    await Vocab.update(vocabId, { audio_url: gsUrl });
    const signedUrl = await resolveAudioUrl(gsUrl);
    return { url: signedUrl, gsUrl };
}

async function getHskQuestion(questionId) {
    const [rows] = await db.execute(
        `SELECT q.*, s.exam_id
           FROM hsk_questions q
           JOIN hsk_sections s ON s.id = q.section_id
          WHERE q.id = ?`,
        [questionId]
    );
    return rows[0] || null;
}

async function genHskListeningAudio(questionId) {
    const question = await getHskQuestion(questionId);
    if (!question) {
        const err = new Error('HSK question not found');
        err.status = 404;
        throw err;
    }

    const text = normalizeText(question.transcript || question.question_text || question.statement);
    if (!text) {
        const err = new Error('Question has no transcript/text for TTS');
        err.status = 400;
        throw err;
    }

    const audio = await cloudTts.synthesize(text, { voice: 'female', speed: 0.95 });
    const gsUrl = await uploadAudioToGcs(`hsk/${question.exam_id}`, `${questionId}.mp3`, audio);
    await HskExam.updateQuestion(questionId, { question_audio: gsUrl });
    const signedUrl = await resolveAudioUrl(gsUrl);
    return { url: signedUrl, gsUrl };
}

async function genLessonAudio(lessonId) {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
        const err = new Error('Lesson not found');
        err.status = 404;
        throw err;
    }

    const text = normalizeText(lesson.passage_zh || lesson.title);
    if (!text) {
        const err = new Error('Lesson has no passage text for TTS');
        err.status = 400;
        throw err;
    }

    const audio = await cloudTts.synthesize(text, { voice: 'female', speed: 0.9 });
    const gsUrl = await uploadAudioToGcs(`lessons/${lessonId}`, 'passage.mp3', audio);
    await db.execute('UPDATE lessons SET passage_audio_url = ? WHERE id = ?', [gsUrl, lessonId]);
    const signedUrl = await resolveAudioUrl(gsUrl);
    return { url: signedUrl, gsUrl };
}

/**
 * Gen audio cho 1 string text (không cần entity ID — dùng cho create flow ở admin).
 * Lưu vào path tạm `tts/<hash>.mp3` để cache + tránh đè nhau.
 */
async function genTextAudio(text, { voice = 'female', speed = 0.9 } = {}) {
    const cleaned = normalizeText(text);
    if (!cleaned) {
        const err = new Error('Text is required for TTS');
        err.status = 400;
        throw err;
    }
    if (cleaned.length > 200) {
        const err = new Error('Text quá dài (tối đa 200 ký tự)');
        err.status = 400;
        throw err;
    }
    // Hash text để cache: nếu admin tạo cùng 1 từ nhiều lần thì dùng lại object cũ
    const crypto = require('crypto');
    const hash = crypto.createHash('sha1').update(`${voice}|${speed}|${cleaned}`).digest('hex').slice(0, 16);
    const audio = await cloudTts.synthesize(cleaned, { voice, speed });
    const gsUrl = await uploadAudioToGcs('tts', `${hash}.mp3`, audio);
    const signedUrl = await resolveAudioUrl(gsUrl);
    return { url: signedUrl, gsUrl };
}

async function genExampleAudio(exampleId) {
    const [rows] = await db.execute(
        'SELECT id, sentence_zh FROM dictionary_examples WHERE id = ?',
        [exampleId]
    ).catch((error) => {
        if (error.code === 'ER_NO_SUCH_TABLE') return [[]];
        throw error;
    });
    const example = rows[0];
    if (!example) {
        const err = new Error('Example not found');
        err.status = 404;
        throw err;
    }

    const audio = await cloudTts.synthesize(normalizeText(example.sentence_zh), { voice: 'female', speed: 0.9 });
    const gsUrl = await uploadAudioToGcs('examples', `${exampleId}.mp3`, audio);
    await db.execute(
        `UPDATE dictionary_examples
            SET audio_url = ?, audio_provider = 'manual'
          WHERE id = ?`,
        [gsUrl, exampleId]
    );
    const signedUrl = await resolveAudioUrl(gsUrl);
    return { url: signedUrl, gsUrl };
}

// ============================================================
// Edge TTS variants — local file storage at /public/audio/<prefix>/<file>.mp3.
// Returns { url, gsUrl } where both are the same relative URL (no GCS); FE
// stores `gsUrl` to DB, plays `url` directly via Express static serving.
// ============================================================

async function genVocabAudioEdge(vocabId, { voice = 'female' } = {}) {
    const vocab = await Vocab.getById(vocabId);
    if (!vocab) {
        const err = new Error('Vocabulary not found');
        err.status = 404;
        throw err;
    }
    const text = normalizeText(vocab.simplified);
    if (!text) {
        const err = new Error('Vocab has no simplified text for TTS');
        err.status = 400;
        throw err;
    }
    const relPath = `vocab/${vocabId}.mp3`;
    const outputFile = path.join(PUBLIC_AUDIO_DIR, relPath);
    await edgeTts.synthesizeToFile(text, outputFile, { voice });
    const audioUrl = `/audio/${relPath}`;
    await Vocab.update(vocabId, { audio_url: audioUrl });
    return { url: audioUrl, gsUrl: audioUrl };
}

async function genTextAudioEdge(text, { voice = 'female' } = {}) {
    // GIỮ xuống dòng (chỉ gộp space/tab) để parser hội thoại tách đúng lượt nói
    // có nhãn người nói (男：/女：/老师：…). Vocab 1 từ → vẫn là 1 đoạn như cũ.
    const cleaned = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t ]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .split('\n').map(l => l.trim()).join('\n')
        .trim();
    if (!cleaned) {
        const err = new Error('Text is required for TTS');
        err.status = 400;
        throw err;
    }
    // Cho phép bài khoá dài (hội thoại được tách thành nhiều đoạn ngắn khi gen).
    if (cleaned.length > 3000) {
        const err = new Error('Text quá dài (tối đa 3000 ký tự) — tách nhỏ rồi tạo lại.');
        err.status = 400;
        throw err;
    }
    // Cache: same text+voice → reuse file.
    const hash = crypto.createHash('sha1').update(`edge|${voice}|${cleaned}`).digest('hex').slice(0, 16);
    const relPath = `tts/${hash}.mp3`;
    const outputFile = path.join(PUBLIC_AUDIO_DIR, relPath);

    let exists = false;
    try {
        const st = await fs.stat(outputFile);
        exists = st.size > 0;
    } catch { /* not cached */ }

    if (!exists) {
        // Tự xử lý hội thoại nhiều người nói (giọng nam/nữ + ffmpeg concat).
        await edgeTts.synthesizeDialogueToFile(cleaned, outputFile, { defaultVoice: voice });
    }

    const audioUrl = `/audio/${relPath}`;
    return { url: audioUrl, gsUrl: audioUrl };
}

module.exports = {
    genVocabAudio,
    genHskListeningAudio,
    genLessonAudio,
    genExampleAudio,
    genTextAudio,
    // Edge TTS (Python edge_tts subprocess)
    genVocabAudioEdge,
    genTextAudioEdge,
};
