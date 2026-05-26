/**
 * HSK Exam Controller
 * Handles HTTP requests for HSK exam endpoints
 */

const HskExamModel = require('../models/hskExam.model');
const streakService = require('../services/streak.service');
const xpService = require('../services/xp.service');
const examTemplate = require('../services/hsk-exam-template.service');
const { resolveAudioUrl } = require('../services/audioUrl.service');
const pushService = require('../services/push.service');
const db = require('../config/database');

async function broadcastNewExam(exam) {
    if (!exam || !exam.hsk_level || !exam.id) return;
    try {
        const [rows] = await db.execute(
            `SELECT id FROM users WHERE is_active = 1 AND target_hsk = ?`,
            [exam.hsk_level]
        );
        await Promise.allSettled(rows.map(r => pushService.pushToUser(r.id, {
            title: 'Đề thi HSK mới đã có!',
            body: `${exam.title} (HSK ${exam.hsk_level}) — vào luyện ngay.`,
            url: `/hsk-test/${exam.id}`,
            tag: `new-exam-${exam.id}`,
            type: 'new_exam',
            icon: 'quiz',
        })));
    } catch (error) {
        console.error('[hskExam] broadcastNewExam failed:', error.message);
    }
}

/**
 * Resolve audio URLs trong exam payload: section.audio_url + mỗi question.questionAudio.
 * Mutates không sao vì objects vừa được serialize từ DB, không share reference.
 */
async function resolveExamAudio(payload) {
    if (!payload?.sections) return payload;
    for (const section of payload.sections) {
        if (section.audio_url) section.audio_url = await resolveAudioUrl(section.audio_url);
        if (Array.isArray(section.questions)) {
            for (const q of section.questions) {
                if (q.questionAudio) q.questionAudio = await resolveAudioUrl(q.questionAudio);
                if (q.question_audio) q.question_audio = await resolveAudioUrl(q.question_audio);
            }
        }
    }
    return payload;
}

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
        // Notify learners at this HSK level (fire-and-forget)
        if (exam?.is_active) broadcastNewExam(exam);
        res.status(201).json({ success: true, data: exam });
    } catch (err) {
        console.error('Create exam error:', err);
        res.status(500).json({ success: false, message: 'Failed to create exam', error: err.message });
    }
}

/**
 * POST /api/hsk-exams/from-template
 * Body: { level: 1|2|3|4|5|6, title?, exam_type?, description? }
 * → atomic instantiate full exam skeleton (sections + groups + N placeholder questions).
 */
async function createExamFromTemplate(req, res) {
    try {
        const level = parseInt(req.body?.level, 10);
        if (![1, 2, 3, 4, 5, 6].includes(level)) {
            return res.status(400).json({
                success: false,
                message: `HSK ${level || '?'} chưa có template. Chỉ hỗ trợ HSK 1-6.`
            });
        }

        const { examId, totalQuestions } = await examTemplate.instantiateTemplate(level, {
            title: req.body?.title,
            exam_type: req.body?.exam_type,
            description: req.body?.description,
        });

        const exam = await HskExamModel.getExamById(examId, true);
        res.status(201).json({ success: true, data: exam, totalQuestions });
    } catch (err) {
        console.error('Create exam from template error:', err);
        const status = err.code === 'UNSUPPORTED_LEVEL' ? 400 : 500;
        res.status(status).json({
            success: false,
            message: err.message || 'Failed to instantiate template',
        });
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
// ADMIN - QUESTION GROUPS (Phase A — refactor HSK 1-3)
// ============================================================

async function listGroups(req, res) {
    try {
        const groups = await HskExamModel.getGroupsBySection(req.params.sectionId);
        res.json({ data: groups });
    } catch (err) {
        console.error('List groups error:', err);
        res.status(500).json({ error: 'Failed to list groups' });
    }
}

async function createGroup(req, res) {
    try {
        const { group_type, title_vi, instructions_vi, content, order_index } = req.body || {};
        if (!group_type) {
            return res.status(400).json({ success: false, message: 'group_type required' });
        }
        const id = await HskExamModel.createGroup({
            section_id: req.params.sectionId,
            group_type,
            title_vi,
            instructions_vi,
            content,
            order_index,
        });
        const groups = await HskExamModel.getGroupsBySection(req.params.sectionId);
        res.status(201).json({ success: true, data: groups.find(g => g.id === id) });
    } catch (err) {
        console.error('Create group error:', err);
        res.status(500).json({ success: false, message: 'Failed to create group', error: err.message });
    }
}

async function updateGroup(req, res) {
    try {
        const affected = await HskExamModel.updateGroup(req.params.groupId, req.body || {});
        if (affected === 0) return res.status(404).json({ success: false, message: 'Group not found or no changes' });
        res.json({ success: true });
    } catch (err) {
        console.error('Update group error:', err);
        res.status(500).json({ success: false, message: 'Failed to update group', error: err.message });
    }
}

async function deleteGroup(req, res) {
    try {
        const affected = await HskExamModel.deleteGroup(req.params.groupId);
        if (affected === 0) return res.status(404).json({ success: false, message: 'Group not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('Delete group error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete group', error: err.message });
    }
}

// ============================================================
// PUBLIC - ANSWER VIEW (transcript + correct answers)
// ============================================================

async function getExamAnswers(req, res) {
    try {
        const exam = await HskExamModel.getExamById(req.params.id, true);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });
        // Public — returns full questions including transcript, passage, statement,
        // correct_answer, explanation. NO attempt or completed-status check.
        // Shape MIRRORS startExam (sections snake_case, questions camelCase) so FE
        // can reuse <QuestionRenderer>. Adds correctAnswer / explanation / transcript.
        const payload = {
            id: exam.id,
            title: exam.title,
            hsk_level: exam.hsk_level,
            exam_type: exam.exam_type,
            duration_minutes: exam.duration_minutes,
            sections: exam.sections.map(section => ({
                ...section,
                groups: section.groups || [],
                questions: section.questions.map(q => ({
                    id: q.id,
                    groupId: q.group_id,
                    questionNumber: q.question_number,
                    questionType: q.question_type,
                    questionText: q.question_text,
                    passage: q.passage,
                    statement: q.statement,
                    transcript: q.transcript,
                    questionImage: q.question_image,
                    questionAudio: q.question_audio,
                    audioStartTime: q.audio_start_time,
                    audioEndTime: q.audio_end_time,
                    audioPlayCount: q.audio_play_count,
                    options: q.options,
                    optionImages: q.option_images,
                    correctAnswer: q.correct_answer,
                    explanation: q.explanation,
                    points: q.points,
                    meta: q.meta,
                })),
            })),
        };
        await resolveExamAudio(payload);
        res.json(payload);
    } catch (err) {
        console.error('Get exam answers error:', err);
        res.status(500).json({ error: 'Failed to get exam answers' });
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

        // No resume — discard any prior in-progress attempt + start fresh.
        // Lý do: UX yêu cầu — exit không lưu. Attempt cũ chưa nộp coi như bỏ.
        await HskExamModel.discardInProgressAttempts(userId, exam.id);
        const attemptId = await HskExamModel.createAttempt(userId, exam.id);

        // Return exam with questions (without correct answers)
        const safeExam = {
            ...exam,
            attemptId,
            startedAt: new Date().toISOString(),
            savedAnswers: [],
            sections: exam.sections.map(section => ({
                ...section,
                groups: section.groups || [],
                questions: section.questions.map(q => ({
                    id: q.id,
                    groupId: q.group_id,
                    questionNumber: q.question_number,
                    questionType: q.question_type,
                    questionText: q.question_text,
                    passage: q.passage,
                    statement: q.statement,
                    questionImage: q.question_image,
                    questionAudio: q.question_audio,
                    audioStartTime: q.audio_start_time,
                    audioEndTime: q.audio_end_time,
                    audioPlayCount: q.audio_play_count,
                    options: q.options,
                    optionImages: q.option_images,
                    points: q.points,
                    meta: q.meta
                    // No correct_answer, explanation, or transcript (transcript only via public answers endpoint)
                }))
            }))
        };

        await resolveExamAudio(safeExam);
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

        // Model handles atomicity: FOR UPDATE lock + verify + grade + set completed in one transaction
        const result = await HskExamModel.completeAttempt(attemptId);

        // Award XP + streak (only reached if grading succeeded)
        try {
            await streakService.updateStreak(userId);
            await xpService.awardXp(userId, result.isPassed ? 'hsk_exam_pass' : 'hsk_exam_fail', {
                refId: attemptId,
                refType: 'hsk_attempt',
            });
            if (result.maxScore > 0 && result.totalScore / result.maxScore >= 0.95) {
                await xpService.awardXp(userId, 'hsk_exam_perfect', {
                    refId: attemptId,
                    refType: 'hsk_attempt',
                });
            }
        } catch (e) {
            console.error('Streak/XP update failed (non-blocking):', e);
        }

        res.json({ success: true, result });
    } catch (err) {
        if (err.code === 'ALREADY_COMPLETED') {
            return res.status(400).json({ error: 'Exam already completed' });
        }
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
                    groups: section.groups || [],
                    questions: section.questions.map(q => ({
                        id: q.id,
                        groupId: q.group_id,
                        questionNumber: q.question_number,
                        questionType: q.question_type,
                        questionText: q.question_text,
                        // Bổ sung 3 field thiếu trước đây — exam mode (H41328 etc.)
                        // không có questionText cho true_false, mà nội dung nằm ở
                        // statement; reading có passage; listening có transcript.
                        statement: q.statement,
                        passage: q.passage,
                        transcript: q.transcript,
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

async function getAiGradeStatus(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });

        const attempt = await HskExamModel.getAttemptById(req.params.attemptId);
        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
        if (attempt.user_id !== userId) return res.status(403).json({ error: 'Access denied' });

        res.json({
            success: true,
            data: {
                attemptId: attempt.id,
                status: attempt.status,
                requiresAiGrading: false,
                aiStatus: 'not_configured',
                message: 'AI grading queue is not enabled yet. Writing answers are saved for later grading.',
            },
        });
    } catch (err) {
        console.error('AI grade status error:', err);
        res.status(500).json({ error: 'Failed to get AI grade status' });
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
    createExamFromTemplate,
    updateExam,
    deleteExam,
    createSection,
    updateSection,
    deleteSection,
    getQuestions,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    // Admin — Question Groups
    listGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    // Public
    getExamAnswers,
    // Client
    getPublicExamList,
    startExam,
    submitAnswer,
    finishExam,
    getAiGradeStatus,
    getExamResult,
    getUserHistory
};
