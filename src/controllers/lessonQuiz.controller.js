/**
 * Lesson Quiz Controller
 * - POST /api/lessons/:id/quiz/start   → tạo phiên, trả câu hỏi (KHÔNG kèm đáp án)
 * - POST /api/lessons/:id/quiz/answer  → chấm 1 câu, trả đáp án đúng + giải thích
 * - POST /api/lessons/:id/quiz/finish  → tổng kết, ghi quiz_score + cập nhật SRS
 *
 * Anti-cheat: server giữ đáp án đúng; /start không trả đáp án (giống grammar
 * quiz ở practice.controller.js). Session in-memory, TTL 30 phút.
 */

const crypto = require('crypto');
const lessonQuizService = require('../services/lessonQuiz.service');
const TextbookLesson = require('../models/textbookLesson.model');
const Course = require('../models/course.model');
const GrammarQuiz = require('../models/grammarQuiz.model');
const streakService = require('../services/streak.service');
const xpService = require('../services/xp.service');
const progressTracker = require('../services/progressTracker.service');

const SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SIZE = Number.parseInt(process.env.LESSON_QUIZ_SIZE || '10', 10);

// token → { userId, lessonId, questions:[{id,kind,refId,correctAnswer,explanation,points}],
//           answers:{ [id]: {correct, kind, refId} }, finished, expiresAt }
const sessions = new Map();

function genToken() {
    return crypto.randomBytes(16).toString('hex');
}

function purgeExpired() {
    const now = Date.now();
    for (const [k, v] of sessions) {
        if (v.expiresAt < now) sessions.delete(k);
    }
}

async function startQuiz(req, res) {
    try {
        purgeExpired();
        const lessonId = req.params.id;

        const questions = await lessonQuizService.buildLessonQuiz(lessonId, { size: DEFAULT_SIZE });
        if (!questions.length) {
            return res.status(404).json({
                success: false,
                message: 'Bài học này chưa có từ vựng/ngữ pháp để tạo quiz.',
            });
        }

        const token = genToken();
        sessions.set(token, {
            userId: req.user.userId,
            lessonId: Number(lessonId),
            questions,
            answers: {},
            finished: false,
            expiresAt: Date.now() + SESSION_TTL_MS,
        });

        // Client-safe payload: NO correctAnswer / explanation.
        const clientQuestions = questions.map((q) => ({
            id: q.id,
            kind: q.kind,
            questionType: q.questionType,
            questionText: q.questionText,
            options: q.options,
        }));

        return res.json({ success: true, data: { token, questions: clientQuestions } });
    } catch (err) {
        console.error('lessonQuizStart error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi tạo phiên quiz.' });
    }
}

function getSession(req, res) {
    const { token } = req.body || {};
    if (!token) {
        res.status(400).json({ success: false, message: 'Thiếu token.' });
        return null;
    }
    const session = sessions.get(token);
    if (!session) {
        res.status(404).json({ success: false, message: 'Phiên đã hết hạn. Bắt đầu lại.' });
        return null;
    }
    if (session.userId !== req.user.userId) {
        res.status(403).json({ success: false, message: 'Không khớp người chơi.' });
        return null;
    }
    if (session.expiresAt < Date.now()) {
        sessions.delete(token);
        res.status(410).json({ success: false, message: 'Phiên đã hết hạn.' });
        return null;
    }
    return session;
}

async function answerQuiz(req, res) {
    try {
        const session = getSession(req, res);
        if (!session) return;

        const { questionId, choice } = req.body || {};
        if (questionId === undefined || choice === undefined) {
            return res.status(400).json({ success: false, message: 'Thiếu questionId/choice.' });
        }
        const question = session.questions.find((q) => q.id === String(questionId));
        if (!question) {
            return res.status(400).json({ success: false, message: 'Câu hỏi không thuộc phiên này.' });
        }

        const correct = String(choice) === String(question.correctAnswer);
        session.answers[question.id] = { correct, kind: question.kind, refId: question.refId };

        return res.json({
            success: true,
            data: { correct, correctAnswer: question.correctAnswer, explanation: question.explanation },
        });
    } catch (err) {
        console.error('lessonQuizAnswer error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi chấm câu trả lời.' });
    }
}

async function finishQuiz(req, res) {
    try {
        const session = getSession(req, res);
        if (!session) return;
        if (session.finished) {
            return res.status(410).json({ success: false, message: 'Phiên đã được tính rồi.' });
        }
        session.finished = true;

        const userId = req.user.userId;
        const total = session.questions.length;
        const answered = Object.keys(session.answers).length;

        let correct = 0;
        const statsByGrammar = {};
        const vocabAttempts = [];
        for (const ans of Object.values(session.answers)) {
            if (ans.correct) correct += 1;
            if (ans.kind === 'grammar') {
                const g = statsByGrammar[ans.refId] || { seen: 0, correct: 0, wrong: 0 };
                g.seen += 1;
                if (ans.correct) g.correct += 1; else g.wrong += 1;
                statsByGrammar[ans.refId] = g;
            } else if (ans.kind === 'vocab') {
                vocabAttempts.push({ vocabId: ans.refId, quality: ans.correct ? 5 : 2 });
            }
        }
        const score = total > 0 ? Math.round((correct / total) * 100) : 0;

        // Persist quiz_score + recompute lesson aggregate/gate.
        await TextbookLesson.upsertProgressScore(userId, session.lessonId, 'quiz_score', score);
        const progress = await TextbookLesson.recomputeLessonScore(userId, session.lessonId);

        // SRS / progress sync (best-effort, never blocks the response).
        try {
            if (Object.keys(statsByGrammar).length) {
                await GrammarQuiz.upsertProgress(userId, statsByGrammar);
            }
            if (vocabAttempts.length) {
                await progressTracker.recordVocabAttemptsBatch(userId, vocabAttempts, { source: 'lesson_quiz' });
            }
        } catch (e) {
            console.error('lessonQuizFinish SRS sync error:', e.message);
        }

        let xpEarned = 0;
        try {
            await streakService.updateStreak(userId);
            xpEarned = await xpService.awardXp(userId, 'practice_grammar_quiz', {
                score,
                refType: 'lesson_quiz',
                refId: session.lessonId,
            });
        } catch (e) {
            console.error('lessonQuizFinish xp error:', e.message);
        }

        // Lesson just completed via the scored exercise gate.
        if (progress.justCompleted) {
            try {
                await xpService.awardXp(userId, 'lesson_complete', {
                    refId: session.lessonId,
                    refType: 'lesson',
                });
                if (progress.courseId) await Course.markCompletionIfDone(userId, progress.courseId);
            } catch (e) {
                console.error('lessonQuizFinish completion error:', e.message);
            }
        }

        sessions.delete(req.body.token);
        return res.json({
            success: true,
            data: {
                total,
                answered,
                correct,
                score,
                xpEarned,
                lessonScore: progress.aggregate,
                lessonPassed: progress.passed,
                lessonCompleted: progress.justCompleted,
            },
        });
    } catch (err) {
        console.error('lessonQuizFinish error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi hoàn tất phiên quiz.' });
    }
}

module.exports = { startQuiz, answerQuiz, finishQuiz };
