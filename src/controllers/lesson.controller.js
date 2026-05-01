const Lesson = require('../models/lesson.model');
const Content = require('../models/content.model');
const Question = require('../models/question.model');
const TextbookLesson = require('../models/textbookLesson.model');
const db = require('../config/database');
const streakService = require('../services/streak.service');

// Get all lessons for a course
exports.getLessonsByCourse = async (req, res) => {
    try {
        const userId = req.user ? req.user.userId : null;
        const lessons = await Lesson.findByCourseId(req.params.courseId, userId);
        res.json({ success: true, data: lessons });
    } catch (error) {
        console.error('Error fetching lessons:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get single lesson details with contents and questions
exports.getLessonDetails = async (req, res) => {
    try {
        const lessonId = req.params.id;

        // Parallel fetch for simplified performance
        const [lesson, contents, questions] = await Promise.all([
            Lesson.findById(lessonId),
            Content.findByLessonId(lessonId),
            Question.findByLessonId(lessonId)
        ]);

        if (!lesson) {
            return res.status(404).json({ success: false, message: 'Lesson not found' });
        }

        res.json({
            success: true,
            data: {
                ...lesson,
                contents,
                questions
            }
        });
    } catch (error) {
        console.error('Error fetching lesson details:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Create Lesson
exports.createLesson = async (req, res) => {
    try {
        const id = await Lesson.create(req.body);
        res.status(201).json({ success: true, data: { id, ...req.body } });
    } catch (error) {
        console.error('Create lesson error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Update Lesson
exports.updateLesson = async (req, res) => {
    try {
        await Lesson.update(req.params.id, req.body);
        res.json({ success: true, message: 'Lesson updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Delete Lesson
exports.deleteLesson = async (req, res) => {
    try {
        await Lesson.delete(req.params.id);
        res.json({ success: true, message: 'Lesson deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Add Content to Lesson
exports.addContent = async (req, res) => {
    try {
        const { content_type, start_time, end_time, text_content, pinyin, meaning, explanation } = req.body;
        const contentData = {
            lesson_id: req.params.id,
            type: (content_type || 'vocabulary').toUpperCase(),
            timestamp: start_time || 0,
            data: { text_content, pinyin, meaning, explanation, start_time, end_time },
            order_index: req.body.order_index || 0,
        };
        const id = await Content.create(contentData);
        res.status(201).json({ success: true, data: { id, ...contentData } });
    } catch (error) {
        console.error('Add content error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Add Question to Lesson
exports.addQuestion = async (req, res) => {
    try {
        const id = await Question.create({ ...req.body, lesson_id: req.params.id });
        res.status(201).json({ success: true, data: { id, ...req.body } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Update/Delete Content/Question endpoints could be separate or here
// For simplicity, we can have separate generic routes for contents/questions updates

// User: Update lesson progress
exports.updateLessonProgress = async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.user.userId;
        const { status } = req.body;

        if (!['in_progress', 'completed'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        // Verify lesson exists and is active
        const lesson = await Lesson.findById(lessonId);
        if (!lesson || !lesson.is_active) {
            return res.status(404).json({ success: false, message: 'Lesson not found' });
        }

        // Do not downgrade from completed to in_progress
        if (status === 'in_progress') {
            await db.execute(
                `INSERT INTO user_lesson_progress (user_id, lesson_id, status)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   status = IF(status = 'completed', status, VALUES(status))`,
                [userId, lessonId, status]
            );
        } else {
            // Check previous status BEFORE update — idempotent XP guard
            const [existing] = await db.execute(
                'SELECT status FROM user_lesson_progress WHERE user_id = ? AND lesson_id = ? LIMIT 1',
                [userId, lessonId]
            );
            const wasAlreadyCompleted = existing.length > 0 && existing[0].status === 'completed';

            await db.execute(
                `INSERT INTO user_lesson_progress (user_id, lesson_id, status, completed_at)
                 VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = NOW()`,
                [userId, lessonId, status]
            );

            // Award XP + streak only on first completion (not re-completion)
            if (!wasAlreadyCompleted) {
                try {
                    await streakService.updateStreak(userId);
                    await streakService.addXP(userId, 20);
                } catch (e) {
                    console.error('Streak/XP update failed (non-blocking):', e);
                }
            }
        }

        res.json({ success: true, data: { lesson_id: lessonId, status } });
    } catch (error) {
        console.error('Update lesson progress error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ============================================================================
// Textbook lesson endpoints (introduced 2026-04-29)
// ============================================================================

// GET /api/lessons/:id/textbook — full payload (passage + vocab + grammar
// + writing exercises + linked HSK exams + per-section progress)
exports.getTextbookLesson = async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.user ? req.user.userId : null;
        const payload = await TextbookLesson.getFullPayload(lessonId, userId);
        if (!payload) {
            return res.status(404).json({ success: false, message: 'Lesson not found' });
        }
        res.json({ success: true, data: payload });
    } catch (error) {
        console.error('Get textbook lesson error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// POST /api/lessons/:id/section-done — body: { section: 'vocab'|'passage'|'grammar'|'exercise' }
exports.markSectionDone = async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.user.userId;
        const { section } = req.body || {};
        if (!['vocab', 'passage', 'grammar', 'exercise'].includes(section)) {
            return res.status(400).json({ success: false, message: 'Invalid section' });
        }

        const result = await TextbookLesson.markSectionDone(userId, lessonId, section);

        // Award XP + streak only when the lesson transitions to completed.
        if (result.justCompleted) {
            try {
                await streakService.updateStreak(userId);
                await streakService.addXP(userId, 20);
            } catch (e) {
                console.error('Streak/XP update failed (non-blocking):', e);
            }
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Mark section done error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// POST /api/lessons/writing/:exerciseId/submit — body: { answerZh: string }
exports.submitWritingExercise = async (req, res) => {
    try {
        const exerciseId = req.params.exerciseId;
        const userId = req.user.userId;
        const { answerZh } = req.body || {};
        if (!answerZh || typeof answerZh !== 'string' || !answerZh.trim()) {
            return res.status(400).json({ success: false, message: 'answerZh required' });
        }
        const result = await TextbookLesson.submitWriting(userId, exerciseId, answerZh);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Submit writing error:', error);
        const status = error.message === 'exercise not found' ? 404 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

// ---- Admin --------------------------------------------------------------

// POST /api/lessons/textbook — create new textbook lesson skeleton
exports.createTextbookLesson = async (req, res) => {
    try {
        const id = await TextbookLesson.createTextbook({
            courseId:      req.body.courseId,
            title:         req.body.title,
            description:   req.body.description,
            passageZh:     req.body.passageZh,
            passagePinyin: req.body.passagePinyin,
            passageVi:     req.body.passageVi,
            objectivesVi:  req.body.objectivesVi,
            hskLevel:      req.body.hskLevel,
            orderIndex:    req.body.orderIndex,
        });
        res.status(201).json({ success: true, data: { id } });
    } catch (error) {
        console.error('Create textbook lesson error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// PUT /api/lessons/:id/textbook — update passage/objectives/etc.
exports.updateTextbookLesson = async (req, res) => {
    try {
        const lessonId = req.params.id;
        const allowed = [
            'title', 'description', 'passage_zh', 'passage_pinyin', 'passage_vi',
            'objectives_vi', 'hsk_level', 'order_index', 'is_active', 'passage_audio_url',
        ];
        const update = {};
        for (const k of allowed) {
            if (Object.prototype.hasOwnProperty.call(req.body, k)) update[k] = req.body[k];
        }
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ success: false, message: 'No updatable fields' });
        }
        await Lesson.update(lessonId, update);
        res.json({ success: true });
    } catch (error) {
        console.error('Update textbook lesson error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// POST /api/lessons/:id/vocabulary — body: { vocabularyId, orderIndex?, noteVi? }
exports.attachVocabulary = async (req, res) => {
    try {
        const lessonId = req.params.id;
        const { vocabularyId, orderIndex, noteVi } = req.body || {};
        if (!vocabularyId) {
            return res.status(400).json({ success: false, message: 'vocabularyId required' });
        }
        await TextbookLesson.attachVocabulary(lessonId, vocabularyId, orderIndex || 0, noteVi || null);
        res.json({ success: true });
    } catch (error) {
        console.error('Attach vocab error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// DELETE /api/lessons/:id/vocabulary/:vocabId
exports.detachVocabulary = async (req, res) => {
    try {
        await TextbookLesson.detachVocabulary(req.params.id, req.params.vocabId);
        res.json({ success: true });
    } catch (error) {
        console.error('Detach vocab error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// PATCH /api/lessons/:id/vocabulary/:vocabId — body: { orderIndex?, noteVi? }
exports.updateVocabularyLink = async (req, res) => {
    try {
        const affected = await TextbookLesson.updateVocabularyLink(
            req.params.id,
            req.params.vocabId,
            req.body || {}
        );
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Link not found or no changes' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Update vocab link error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// POST /api/lessons/:id/grammar — body: { grammarPatternId, orderIndex? }
exports.attachGrammar = async (req, res) => {
    try {
        const { grammarPatternId, orderIndex } = req.body || {};
        if (!grammarPatternId) {
            return res.status(400).json({ success: false, message: 'grammarPatternId required' });
        }
        await TextbookLesson.attachGrammar(req.params.id, grammarPatternId, orderIndex || 0);
        res.json({ success: true });
    } catch (error) {
        console.error('Attach grammar error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// DELETE /api/lessons/:id/grammar/:grammarId
exports.detachGrammar = async (req, res) => {
    try {
        await TextbookLesson.detachGrammar(req.params.id, req.params.grammarId);
        res.json({ success: true });
    } catch (error) {
        console.error('Detach grammar error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// POST /api/lessons/:id/writing — admin add a writing exercise
exports.addWritingExercise = async (req, res) => {
    try {
        const id = await TextbookLesson.addWritingExercise(req.params.id, req.body || {});
        res.status(201).json({ success: true, data: { id } });
    } catch (error) {
        console.error('Add writing exercise error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// PATCH /api/lessons/:id/writing/:writingId — admin update a writing exercise
exports.updateWritingExercise = async (req, res) => {
    try {
        const affected = await TextbookLesson.updateWritingExercise(
            req.params.writingId,
            req.params.id,
            req.body || {}
        );
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Exercise not found or no changes' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Update writing exercise error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// DELETE /api/lessons/:id/writing/:writingId
exports.deleteWritingExercise = async (req, res) => {
    try {
        const affected = await TextbookLesson.deleteWritingExercise(
            req.params.writingId,
            req.params.id
        );
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Exercise not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Delete writing exercise error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
