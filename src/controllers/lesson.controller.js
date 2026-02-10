const Lesson = require('../models/lesson.model');
const Content = require('../models/content.model');
const Question = require('../models/question.model');
const db = require('../config/database');

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
            await db.execute(
                `INSERT INTO user_lesson_progress (user_id, lesson_id, status, completed_at)
                 VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = NOW()`,
                [userId, lessonId, status]
            );
        }

        res.json({ success: true, data: { lesson_id: lessonId, status } });
    } catch (error) {
        console.error('Update lesson progress error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
