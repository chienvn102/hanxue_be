const express = require('express');
const router = express.Router();
const lessonController = require('../controllers/lesson.controller');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const roleMiddleware = require('../middleware/role.middleware');

// Public/User routes (optionalAuth allows viewing without login)
router.get('/course/:courseId', optionalAuth, lessonController.getLessonsByCourse);
router.get('/:id', optionalAuth, lessonController.getLessonDetails);

// Authenticated user routes
router.post('/:id/progress', authMiddleware, lessonController.updateLessonProgress);

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
