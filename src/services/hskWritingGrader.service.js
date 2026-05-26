const gemini = require('./gemini.service');

const AI_GRADED_TYPES = new Set([
    'image_keyword_sentence',
    'short_essay',
    'summary_essay',
]);

const DEFAULT_PASS_SCORE = Number.parseInt(process.env.HSK_AI_WRITING_PASS_SCORE || '70', 10);

function clampNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function extractJsonObject(text) {
    const clean = gemini.unwrapJsonFence(text);
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response did not contain a JSON object');
    return JSON.parse(match[0]);
}

function list(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 5);
}

function parseMeta(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function getKeyword(question) {
    const meta = parseMeta(question.meta) || {};
    return meta.keyword || question.statement || '';
}

function maxPoints(question) {
    return Math.max(1, Number.parseInt(question.question_points || question.points || 1, 10));
}

function sanitizeGrade(parsed, question) {
    const criteria = parsed.criteria && typeof parsed.criteria === 'object'
        ? {
            task: clampNumber(parsed.criteria.task, 0, 25),
            grammar: clampNumber(parsed.criteria.grammar, 0, 25),
            vocabulary: clampNumber(parsed.criteria.vocabulary, 0, 25),
            fluency: clampNumber(parsed.criteria.fluency, 0, 25),
        }
        : null;

    const fallbackScore = criteria
        ? criteria.task + criteria.grammar + criteria.vocabulary + criteria.fluency
        : 0;
    const score = clampNumber(parsed.score ?? fallbackScore, 0, 100);
    const passScore = clampNumber(process.env.HSK_AI_WRITING_PASS_SCORE || DEFAULT_PASS_SCORE, 0, 100);
    const isCorrect = typeof parsed.isCorrect === 'boolean'
        ? parsed.isCorrect
        : score >= passScore;
    const points = isCorrect ? maxPoints(question) : 0;

    const feedback = {
        score,
        passScore,
        feedbackVi: String(parsed.feedbackVi || parsed.feedback_vi || '').trim(),
        feedbackZh: String(parsed.feedbackZh || parsed.feedback_zh || '').trim(),
        suggestedAnswer: String(parsed.suggestedAnswer || parsed.suggested_answer || '').trim(),
        criteria: criteria || undefined,
        strengths: list(parsed.strengths),
        issues: list(parsed.issues),
    };

    return {
        score,
        isCorrect,
        pointsEarned: points,
        feedback,
    };
}

function buildPrompt(question, userAnswer) {
    const keyword = getKeyword(question);
    const meta = parseMeta(question.meta) || {};

    return [
        'Grade this HSK writing answer. Return ONLY valid JSON, no markdown.',
        '',
        'Required JSON shape:',
        '{',
        '  "score": 0-100,',
        '  "isCorrect": true,',
        '  "feedbackVi": "Vietnamese feedback, max 2 sentences",',
        '  "feedbackZh": "Chinese correction or short feedback, max 1 sentence",',
        '  "suggestedAnswer": "A natural Chinese model answer",',
        '  "criteria": {"task":0-25,"grammar":0-25,"vocabulary":0-25,"fluency":0-25},',
        '  "strengths": ["..."],',
        '  "issues": ["..."]',
        '}',
        '',
        'Rubric:',
        '- task: follows the prompt, uses required keyword if any, matches image/context if provided.',
        '- grammar: word order, particles, aspect markers, punctuation.',
        '- vocabulary: word choice and correct usage of the required word.',
        '- fluency: naturalness and completeness as a Chinese sentence/paragraph.',
        `Pass threshold: ${DEFAULT_PASS_SCORE}/100.`,
        '',
        `Question type: ${question.question_type}`,
        `Question number: ${question.question_number || ''}`,
        `Question text: ${question.question_text || ''}`,
        `Required keyword: ${keyword || ''}`,
        `Passage/context: ${question.passage || ''}`,
        `Reference answer, if any: ${question.correct_answer || ''}`,
        `Image reference, if any: ${question.question_image || ''}`,
        `Meta: ${JSON.stringify(meta)}`,
        '',
        `Student answer: ${userAnswer || ''}`,
    ].join('\n');
}

async function gradeWritingAnswer(question) {
    const userAnswer = String(question.user_answer || '').trim();
    if (!userAnswer) {
        return {
            score: 0,
            isCorrect: false,
            pointsEarned: 0,
            feedback: {
                score: 0,
                passScore: DEFAULT_PASS_SCORE,
                feedbackVi: 'Chua co cau tra loi de cham.',
                suggestedAnswer: question.correct_answer || '',
                issues: ['empty_answer'],
            },
        };
    }

    const prompt = buildPrompt(question, userAnswer);
    const { text } = await gemini.chat(
        [
            {
                role: 'system',
                content: 'You are a strict but fair HSK Mandarin writing examiner. Output only valid JSON.',
            },
            { role: 'user', content: prompt },
        ],
        {
            temperature: 0.2,
            maxOutputTokens: 900,
        }
    );
    const parsed = extractJsonObject(text);
    return sanitizeGrade(parsed, question);
}

function gradeKey(questionId, userAnswer) {
    return `${questionId}:${String(userAnswer || '')}`;
}

async function gradeAttemptWritingAnswers(answers) {
    if (String(process.env.HSK_AI_GRADING_ENABLED || 'true').toLowerCase() === 'false') {
        return {};
    }

    const candidates = (answers || []).filter(answer =>
        AI_GRADED_TYPES.has(answer.question_type)
    );
    if (candidates.length === 0) return {};

    const settled = await Promise.allSettled(
        candidates.map(async answer => ({
            key: gradeKey(answer.question_id, answer.user_answer),
            grade: await gradeWritingAnswer(answer),
        }))
    );

    const grades = {};
    for (const item of settled) {
        if (item.status === 'fulfilled') {
            grades[item.value.key] = item.value.grade;
        } else {
            console.error('[hskWritingGrader] AI grade failed:', item.reason?.message || item.reason);
        }
    }
    return grades;
}

module.exports = {
    AI_GRADED_TYPES,
    gradeKey,
    gradeAttemptWritingAnswers,
    gradeWritingAnswer,
};

