const Lesson = require('../models/lesson.model');
const Content = require('../models/content.model');
const Question = require('../models/question.model');

// Get all lessons for a course
exports.getLessonsByCourse = async (req, res) => {
    try {
        const lessons = await Lesson.findByCourseId(req.params.courseId);
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
        const id = await Content.create({ ...req.body, lesson_id: req.params.id });
        res.status(201).json({ success: true, data: { id, ...req.body } });
    } catch (error) {
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
