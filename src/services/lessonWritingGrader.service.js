/**
 * Lesson writing grader (Groq).
 *
 * Chấm bài viết của bài tập trong bài học bằng Groq (LPU, JSON mode) thay cho
 * heuristic đếm keyword. Trả điểm 0-100 + nhận xét. Nếu tắt cờ / thiếu key /
 * Groq lỗi -> trả null để caller (TextbookLesson.submitWriting) dùng lại cách
 * chấm theo keyword cũ (không bao giờ làm hỏng luồng nộp bài).
 *
 * Rubric mirror services/hskWritingGrader.service.js (task/grammar/vocab/fluency).
 */

const groq = require('./groq');

const PASS_SCORE = Number.parseInt(process.env.LESSON_PASS_PCT || '70', 10);

function aiEnabled() {
    return (
        String(process.env.WRITING_AI_GRADING_ENABLED || '').toLowerCase() === 'true' &&
        !!process.env.GROQ_API_KEY
    );
}

function clampScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function list(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 5);
}

function extractJsonObject(text) {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Groq response did not contain a JSON object');
    return JSON.parse(match[0]);
}

function buildMessages({ promptVi, promptZh, expectedKeywords, sampleAnswerZh, minChars, maxChars, answerZh }) {
    const keywords = Array.isArray(expectedKeywords) ? expectedKeywords : [];
    const system =
        'You are a strict but fair Mandarin (HSK) writing examiner for Vietnamese learners. ' +
        'Output ONLY a valid JSON object, no markdown. The response must be json.';
    const user = [
        'Grade this Chinese writing answer for a textbook lesson exercise. Return ONLY valid JSON.',
        '',
        'Required JSON shape:',
        '{',
        '  "score": 0-100,',
        '  "isPass": true,',
        '  "feedbackVi": "Vietnamese feedback, max 2 sentences",',
        '  "feedbackZh": "Chinese correction or short feedback, max 1 sentence",',
        '  "suggestedAnswer": "A natural Chinese model answer",',
        '  "criteria": {"task":0-25,"grammar":0-25,"vocabulary":0-25,"fluency":0-25},',
        '  "strengths": ["..."],',
        '  "issues": ["..."]',
        '}',
        '',
        'Rubric (each 0-25, score = sum):',
        '- task: follows the prompt and uses the required keywords/grammar if any.',
        '- grammar: word order, particles, aspect markers, punctuation.',
        '- vocabulary: appropriate word choice and correct usage.',
        '- fluency: naturalness and completeness as Chinese.',
        `Pass threshold: ${PASS_SCORE}/100. Length guide: ${minChars || 5}-${maxChars || 200} Chinese chars.`,
        '',
        `Prompt (Vietnamese): ${promptVi || ''}`,
        `Prompt (Chinese), if any: ${promptZh || ''}`,
        `Required keywords/grammar: ${keywords.join(', ') || '(none)'}`,
        `Reference / sample answer, if any: ${sampleAnswerZh || ''}`,
        '',
        `Student answer: ${answerZh || ''}`,
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

/**
 * Grade a writing answer with Groq.
 * @returns {Promise<null|{score,isPass,feedbackVi,feedbackZh,suggestedAnswer,strengths,issues,source}>}
 *          null when AI grading is disabled (caller should fall back).
 * @throws when Groq is enabled but fails (caller should catch + fall back).
 */
async function gradeWriting(input) {
    if (!aiEnabled()) return null;

    const messages = buildMessages(input);
    const { text } = await groq.sendMessage(messages, 'lesson-writing', {
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 700,
    });

    const parsed = extractJsonObject(text);
    const score = clampScore(parsed.score);
    return {
        score,
        isPass: typeof parsed.isPass === 'boolean' ? parsed.isPass : score >= PASS_SCORE,
        feedbackVi: String(parsed.feedbackVi || parsed.feedback_vi || '').trim(),
        feedbackZh: String(parsed.feedbackZh || parsed.feedback_zh || '').trim(),
        suggestedAnswer: String(parsed.suggestedAnswer || parsed.suggested_answer || '').trim(),
        strengths: list(parsed.strengths),
        issues: list(parsed.issues),
        source: 'groq',
    };
}

module.exports = {
    PASS_SCORE,
    aiEnabled,
    gradeWriting,
};
