const express = require('express');
const router = express.Router();
const lessonController = require('../controllers/lesson.controller');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role.middleware');

// Public/User routes
router.get('/course/:courseId', authMiddleware, lessonController.getLessonsByCourse);
router.get('/:id', authMiddleware, lessonController.getLessonDetails);

// Admin routes - Lessons
router.post('/', authMiddleware, roleMiddleware(['admin']), lessonController.createLesson);
router.put('/:id', authMiddleware, roleMiddleware(['admin']), lessonController.updateLesson);
router.delete('/:id', authMiddleware, roleMiddleware(['admin']), lessonController.deleteLesson);

// Admin routes - Contents
router.post('/:id/contents', authMiddleware, roleMiddleware(['admin']), lessonController.addContent);

// Admin routes - Questions
router.post('/:id/questions', authMiddleware, roleMiddleware(['admin']), lessonController.addQuestion);

module.exports = router;
