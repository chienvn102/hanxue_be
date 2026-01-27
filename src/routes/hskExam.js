/**
 * HSK Exam Routes
 * Admin and client routes for HSK test management
 */

const express = require('express');
const router = express.Router();
const hskExamController = require('../controllers/hskExam.controller');
const { authMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin.middleware');

// ============================================================
// PUBLIC ROUTES (Client - Taking Exams)
// ============================================================

// Get list of active exams (public)
router.get('/public', hskExamController.getPublicExamList);

// ============================================================
// AUTHENTICATED USER ROUTES (for students taking exams)
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
// ADMIN ROUTES - Exam Management (using adminMiddleware)
// ============================================================

// List all exams (admin)
router.get('/', adminMiddleware, hskExamController.listExams);

// Get exam detail with sections and questions
router.get('/:id', adminMiddleware, hskExamController.getExamDetail);

// Create new exam
router.post('/', adminMiddleware, hskExamController.createExam);

// Update exam
router.put('/:id', adminMiddleware, hskExamController.updateExam);

// Delete exam
router.delete('/:id', adminMiddleware, hskExamController.deleteExam);

// ============================================================
// ADMIN ROUTES - Section Management
// ============================================================

// Create section for exam
router.post('/:examId/sections', adminMiddleware, hskExamController.createSection);

// Update section
router.put('/sections/:sectionId', adminMiddleware, hskExamController.updateSection);

// Delete section
router.delete('/sections/:sectionId', adminMiddleware, hskExamController.deleteSection);

// ============================================================
// ADMIN ROUTES - Question Management
// ============================================================

// Get questions for section
router.get('/sections/:sectionId/questions', adminMiddleware, hskExamController.getQuestions);

// Create question for section
router.post('/sections/:sectionId/questions', adminMiddleware, hskExamController.createQuestion);

// Update question
router.put('/questions/:questionId', adminMiddleware, hskExamController.updateQuestion);

// Delete question
router.delete('/questions/:questionId', adminMiddleware, hskExamController.deleteQuestion);

module.exports = router;

