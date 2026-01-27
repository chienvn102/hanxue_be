/**
 * HSK Exam Routes
 * Admin and client routes for HSK test management
 */

const express = require('express');
const router = express.Router();
const hskExamController = require('../controllers/hskExam.controller');
const { verifyToken } = require('../middleware/auth');
const { adminMiddleware } = require('../middleware/role.middleware');

// ============================================================
// PUBLIC ROUTES (Client - Taking Exams)
// ============================================================

// Get list of active exams (public)
router.get('/public', hskExamController.getPublicExamList);

// ============================================================
// AUTHENTICATED USER ROUTES
// ============================================================

// Start an exam (creates attempt)
router.post('/:id/start', verifyToken, hskExamController.startExam);

// Submit answer during exam
router.post('/attempts/:attemptId/answer', verifyToken, hskExamController.submitAnswer);

// Finish exam and get score
router.post('/attempts/:attemptId/finish', verifyToken, hskExamController.finishExam);

// Get exam result
router.get('/attempts/:attemptId/result', verifyToken, hskExamController.getExamResult);

// Get user's exam history
router.get('/history', verifyToken, hskExamController.getUserHistory);

// ============================================================
// ADMIN ROUTES - Exam Management
// ============================================================

// List all exams (admin)
router.get('/', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.listExams);

// Get exam detail with sections and questions
router.get('/:id', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.getExamDetail);

// Create new exam
router.post('/', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.createExam);

// Update exam
router.put('/:id', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.updateExam);

// Delete exam
router.delete('/:id', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.deleteExam);

// ============================================================
// ADMIN ROUTES - Section Management
// ============================================================

// Create section for exam
router.post('/:examId/sections', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.createSection);

// Update section
router.put('/sections/:sectionId', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.updateSection);

// Delete section
router.delete('/sections/:sectionId', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.deleteSection);

// ============================================================
// ADMIN ROUTES - Question Management
// ============================================================

// Get questions for section
router.get('/sections/:sectionId/questions', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.getQuestions);

// Create question for section
router.post('/sections/:sectionId/questions', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.createQuestion);

// Update question
router.put('/questions/:questionId', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.updateQuestion);

// Delete question
router.delete('/questions/:questionId', verifyToken, adminMiddleware(['admin', 'super_admin']), hskExamController.deleteQuestion);

module.exports = router;
