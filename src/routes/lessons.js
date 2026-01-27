const express = require('express');
const router = express.Router();
const lessonController = require('../controllers/lesson.controller');
const { authMiddleware } = require('../middleware/auth');
const roleMiddleware = require('../middleware/role.middleware');

// Public/User routes
router.get('/course/:courseId', authMiddleware, lessonController.getLessonsByCourse);
router.get('/:id', authMiddleware, lessonController.getLessonDetails);

const adminMiddleware = require('../middleware/admin.middleware');

// Admin routes - Lessons
router.post('/', adminMiddleware, roleMiddleware(['admin']), lessonController.createLesson);
router.put('/:id', adminMiddleware, roleMiddleware(['admin']), lessonController.updateLesson);
router.delete('/:id', adminMiddleware, roleMiddleware(['admin']), lessonController.deleteLesson);

// Admin routes - Contents
router.post('/:id/contents', adminMiddleware, roleMiddleware(['admin']), lessonController.addContent);

// Admin routes - Questions
router.post('/:id/questions', adminMiddleware, roleMiddleware(['admin']), lessonController.addQuestion);

module.exports = router;
