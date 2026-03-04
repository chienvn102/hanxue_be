/**
 * HSK Exam Controller
 * Handles HTTP requests for HSK exam endpoints
 */

const HskExamModel = require('../models/hskExam.model');
const streakService = require('../services/streak.service');

// ============================================================
// ADMIN - EXAM MANAGEMENT
// ============================================================

async function listExams(req, res) {
    try {
        const { hsk, type, page = 1, limit = 20 } = req.query;
        const { rows, total } = await HskExamModel.getExamList({
            hsk, type, page: parseInt(page), limit: parseInt(limit), activeOnly: false
        });

        res.json({
            data: rows,
            pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error('List exams error:', err);
        res.status(500).json({ error: 'Failed to list exams' });
    }
}

async function getExamDetail(req, res) {
    try {
        const exam = await HskExamModel.getExamById(req.params.id, true);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });
        res.json(exam);
    } catch (err) {
        console.error('Get exam error:', err);
        res.status(500).json({ error: 'Failed to get exam' });
    }
}

async function createExam(req, res) {
    try {
        const id = await HskExamModel.createExam(req.body);
        const exam = await HskExamModel.getExamById(id);
        res.status(201).json({ success: true, data: exam });
    } catch (err) {
        console.error('Create exam error:', err);
        res.status(500).json({ success: false, message: 'Failed to create exam', error: err.message });
    }
}

async function updateExam(req, res) {
    try {
        const affected = await HskExamModel.updateExam(req.params.id, req.body);
        if (affected === 0) return res.status(404).json({ success: false, message: 'Exam not found' });
        const exam = await HskExamModel.getExamById(req.params.id);
        res.json({ success: true, data: exam });
    } catch (err) {
        console.error('Update exam error:', err);
        res.status(500).json({ success: false, message: 'Failed to update exam', error: err.message });
    }
}

async function deleteExam(req, res) {
    try {
        const affected = await HskExamModel.deleteExam(req.params.id);
        if (affected === 0) return res.status(404).json({ success: false, message: 'Exam not found' });
        res.json({ success: true, message: 'Exam deleted' });
    } catch (err) {
        console.error('Delete exam error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete exam', error: err.message });
    }
}

// ============================================================
// ADMIN - SECTION MANAGEMENT
// ============================================================

async function createSection(req, res) {
    try {
        const id = await HskExamModel.createSection({ ...req.body, exam_id: req.params.examId });
        const sections = await HskExamModel.getSectionsByExam(req.params.examId);
        res.status(201).json({ success: true, data: sections.find(s => s.id === id) });
    } catch (err) {
        console.error('Create section error:', err);
        res.status(500).json({ success: false, message: 'Failed to create section', error: err.message });
    }
}

async function updateSection(req, res) {
    try {
        const affected = await HskExamModel.updateSection(req.params.sectionId, req.body);
        if (affected === 0) return res.status(404).json({ success: false, message: 'Section not found' });
        res.json({ success: true, message: 'Section updated' });
    } catch (err) {
        console.error('Update section error:', err);
        res.status(500).json({ success: false, message: 'Failed to update section', error: err.message });
    }
}

async function deleteSection(req, res) {
    try {
        const affected = await HskExamModel.deleteSection(req.params.sectionId);
        if (affected === 0) return res.status(404).json({ success: false, message: 'Section not found' });
        res.json({ success: true, message: 'Section deleted' });
    } catch (err) {
        console.error('Delete section error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete section', error: err.message });
    }
}

// ============================================================
// ADMIN - QUESTION MANAGEMENT
// ============================================================

async function getQuestions(req, res) {
    try {
        const questions = await HskExamModel.getQuestionsBySection(req.params.sectionId);
        res.json({ data: questions });
    } catch (err) {
        console.error('Get questions error:', err);
        res.status(500).json({ error: 'Failed to get questions' });
    }
}

async function createQuestion(req, res) {
    try {
        const id = await HskExamModel.createQuestion({ ...req.body, section_id: req.params.sectionId });
        const questions = await HskExamModel.getQuestionsBySection(req.params.sectionId);
        res.status(201).json({ success: true, data: questions.find(q => q.id === id) });
    } catch (err) {
        console.error('Create question error:', err);
        res.status(500).json({ success: false, message: 'Failed to create question', error: err.message });
    }
}

async function updateQuestion(req, res) {
    try {
        const affected = await HskExamModel.updateQuestion(req.params.questionId, req.body);
        if (affected === 0) return res.status(404).json({ success: false, message: 'Question not found' });
        res.json({ success: true, message: 'Question updated' });
    } catch (err) {
        console.error('Update question error:', err);
        res.status(500).json({ success: false, message: 'Failed to update question', error: err.message });
    }
}

async function deleteQuestion(req, res) {
    try {
        const affected = await HskExamModel.deleteQuestion(req.params.questionId);
        if (affected === 0) return res.status(404).json({ success: false, message: 'Question not found' });
        res.json({ success: true, message: 'Question deleted' });
    } catch (err) {
        console.error('Delete question error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete question', error: err.message });
    }
}

// ============================================================
// CLIENT - TAKING EXAMS
// ============================================================

async function getPublicExamList(req, res) {
    try {
        const { hsk, type, page = 1, limit = 20 } = req.query;
        const { rows, total } = await HskExamModel.getExamList({
            hsk, type, page: parseInt(page), limit: parseInt(limit), activeOnly: true
        });

        // Don't expose correct answers
        const safeRows = rows.map(exam => ({
            id: exam.id,
            title: exam.title,
            hskLevel: exam.hsk_level,
            examType: exam.exam_type,
            totalQuestions: exam.total_questions,
            durationMinutes: exam.duration_minutes,
            passingScore: exam.passing_score,
            description: exam.description
        }));

        res.json({
            data: safeRows,
            pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error('Get public exams error:', err);
        res.status(500).json({ error: 'Failed to get exams' });
    }
}

async function startExam(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });

        const exam = await HskExamModel.getExamById(req.params.id, true);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });

        // Check for existing in_progress attempt (resume support)
        let attemptId;
        let savedAnswers = [];
        const existingAttempt = await HskExamModel.getInProgressAttempt(userId, exam.id);

        if (existingAttempt) {
            attemptId = existingAttempt.id;
            savedAnswers = await HskExamModel.getAttemptAnswers(attemptId);
        } else {
            attemptId = await HskExamModel.createAttempt(userId, exam.id);
        }

        // Return exam with questions (without correct answers)
        const safeExam = {
            ...exam,
            attemptId,
            startedAt: existingAttempt?.started_at || new Date().toISOString(),
            savedAnswers: savedAnswers.map(a => ({
                questionId: a.question_id,
                answer: a.user_answer
            })),
            sections: exam.sections.map(section => ({
                ...section,
                questions: section.questions.map(q => ({
                    id: q.id,
                    questionNumber: q.question_number,
                    questionType: q.question_type,
                    questionText: q.question_text,
                    questionImage: q.question_image,
                    questionAudio: q.question_audio,
                    audioStartTime: q.audio_start_time,
                    audioEndTime: q.audio_end_time,
                    audioPlayCount: q.audio_play_count,
                    options: q.options,
                    optionImages: q.option_images,
                    points: q.points
                    // No correct_answer or explanation
                }))
            }))
        };

        res.json(safeExam);
    } catch (err) {
        console.error('Start exam error:', err);
        res.status(500).json({ error: 'Failed to start exam' });
    }
}

async function submitAnswer(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });

        const { questionId, answer, timeSpent } = req.body;
        const attemptId = req.params.attemptId;

        // Verify attempt exists, belongs to user, and is in progress
        const attempt = await HskExamModel.getAttemptById(attemptId);
        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
        if (attempt.user_id !== userId) return res.status(403).json({ error: 'Access denied' });
        if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'Exam already completed' });

        // Validate questionId belongs to this exam
        const exam = await HskExamModel.getExamById(attempt.exam_id, true);
        const validQuestionIds = new Set();
        for (const section of exam.sections) {
            for (const q of section.questions) {
                validQuestionIds.add(q.id);
            }
        }
        if (!validQuestionIds.has(questionId)) {
            return res.status(400).json({ error: 'Question does not belong to this exam' });
        }

        await HskExamModel.submitAnswer(attemptId, questionId, answer, null, 0, timeSpent || 0);

        res.json({ success: true });
    } catch (err) {
        console.error('Submit answer error:', err);
        res.status(500).json({ error: 'Failed to submit answer' });
    }
}

async function finishExam(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });

        const attemptId = req.params.attemptId;

        // Verify attempt exists and belongs to user
        const attempt = await HskExamModel.getAttemptById(attemptId);
        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
        if (attempt.user_id !== userId) return res.status(403).json({ error: 'Access denied' });
        if (attempt.status === 'completed') return res.status(400).json({ error: 'Exam already completed' });

        // Grade answers and complete
        const result = await HskExamModel.completeAttempt(attemptId);

        // Award XP + streak (idempotent: guard above ensures status !== 'completed')
        try {
            await streakService.updateStreak(userId);
            const xp = result.isPassed ? 25 : 15;
            await streakService.addXP(userId, xp);
        } catch (e) {
            console.error('Streak/XP update failed (non-blocking):', e);
        }

        res.json({ success: true, result });
    } catch (err) {
        console.error('Finish exam error:', err);
        res.status(500).json({ error: 'Failed to finish exam' });
    }
}

async function getExamResult(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });

        const attemptId = req.params.attemptId;
        const attempt = await HskExamModel.getAttemptById(attemptId);
        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

        // Verify attempt belongs to user
        if (attempt.user_id !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Only allow viewing result after completion
        if (attempt.status !== 'completed') {
            return res.status(400).json({ error: 'Exam not yet completed' });
        }

        // Get full exam with answers
        const exam = await HskExamModel.getExamById(attempt.exam_id, true);

        // Get user answers for this attempt
        const userAnswers = await HskExamModel.getAttemptWithAnswers(attemptId);
        const answerMap = {};
        for (const ua of userAnswers) {
            answerMap[ua.question_id] = {
                userAnswer: ua.user_answer,
                isCorrect: ua.is_correct,
                pointsEarned: ua.points_earned,
                timeSpent: ua.time_spent_seconds
            };
        }

        res.json({
            attempt,
            exam: {
                title: exam.title,
                hskLevel: exam.hsk_level,
                passingScore: exam.passing_score,
                totalQuestions: exam.total_questions,
                durationMinutes: exam.duration_minutes,
                sections: exam.sections.map(section => ({
                    ...section,
                    questions: section.questions.map(q => ({
                        id: q.id,
                        questionNumber: q.question_number,
                        questionType: q.question_type,
                        questionText: q.question_text,
                        questionImage: q.question_image,
                        options: q.options,
                        optionImages: q.option_images,
                        correctAnswer: q.correct_answer,
                        explanation: q.explanation,
                        points: q.points,
                        userAnswer: answerMap[q.id]?.userAnswer || null,
                        isCorrect: answerMap[q.id]?.isCorrect ?? null,
                        pointsEarned: answerMap[q.id]?.pointsEarned || 0
                    }))
                }))
            }
        });
    } catch (err) {
        console.error('Get result error:', err);
        res.status(500).json({ error: 'Failed to get result' });
    }
}

async function getUserHistory(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });

        const attempts = await HskExamModel.getUserAttempts(userId);
        res.json({ data: attempts });
    } catch (err) {
        console.error('Get history error:', err);
        res.status(500).json({ error: 'Failed to get history' });
    }
}

module.exports = {
    // Admin
    listExams,
    getExamDetail,
    createExam,
    updateExam,
    deleteExam,
    createSection,
    updateSection,
    deleteSection,
    getQuestions,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    // Client
    getPublicExamList,
    startExam,
    submitAnswer,
    finishExam,
    getExamResult,
    getUserHistory
};
