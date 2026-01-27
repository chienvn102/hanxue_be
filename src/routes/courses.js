const express = require('express');
const router = express.Router();
const courseController = require('../controllers/course.controller');
const { authMiddleware } = require('../middleware/auth');
const roleMiddleware = require('../middleware/role.middleware');

// Public routes (or authenticated user)
router.get('/', authMiddleware, courseController.getCourses);
router.get('/:id', authMiddleware, courseController.getCourse);

// Admin routes
router.post('/', authMiddleware, roleMiddleware(['admin']), courseController.createCourse);
router.put('/:id', authMiddleware, roleMiddleware(['admin']), courseController.updateCourse);
router.delete('/:id', authMiddleware, roleMiddleware(['admin']), courseController.deleteCourse);

module.exports = router;
