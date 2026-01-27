/**
 * HSK Exam Routes
 * Admin and client routes for HSK test management
 */

const express = require('express');
const router = express.Router();
const hskExamController = require('../controllers/hskExam.controller');
const { authMiddleware } = require('../middleware/auth');
const roleMiddleware = require('../middleware/role.middleware');

// ============================================================
// PUBLIC ROUTES (Client - Taking Exams)
// ============================================================

// Get list of active exams (public)
router.get('/public', hskExamController.getPublicExamList);

// ============================================================
// AUTHENTICATED USER ROUTES
// ============================================================

// Start an exam (creates attempt)
router.post('/:id/start', authMiddleware, hskExamController.startExam);

// Submit answer during exam
router.post('/attempts/:attemptId/answer', authMiddleware, hskExamController.submitAnswer);

// Finish exam and get score
router.post('/attempts/:attemptId/finish', authMiddleware, hskExamController.finishExam);

// Get exam result
router.get('/attempts/:attemptId/result', authMiddleware, hskExamController.getExamResult);

// Get user's exam history
router.get('/history', authMiddleware, hskExamController.getUserHistory);

// ============================================================
// ADMIN ROUTES - Exam Management
// ============================================================

// List all exams (admin)
router.get('/', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.listExams);

// Get exam detail with sections and questions
router.get('/:id', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.getExamDetail);

// Create new exam
router.post('/', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.createExam);

// Update exam
router.put('/:id', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.updateExam);

// Delete exam
router.delete('/:id', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.deleteExam);

// ============================================================
// ADMIN ROUTES - Section Management
// ============================================================

// Create section for exam
router.post('/:examId/sections', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.createSection);

// Update section
router.put('/sections/:sectionId', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.updateSection);

// Delete section
router.delete('/sections/:sectionId', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.deleteSection);

// ============================================================
// ADMIN ROUTES - Question Management
// ============================================================

// Get questions for section
router.get('/sections/:sectionId/questions', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.getQuestions);

// Create question for section
router.post('/sections/:sectionId/questions', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.createQuestion);

// Update question
router.put('/questions/:questionId', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.updateQuestion);

// Delete question
router.delete('/questions/:questionId', authMiddleware, roleMiddleware(['admin', 'super_admin']), hskExamController.deleteQuestion);

module.exports = router;
