/**
 * HSK Exam Routes
 * Admin and client routes for HSK test management
 */

const express = require('express');
const router = express.Router();
const hskExamController = require('../controllers/hskExam.controller');
const hskExamImportController = require('../controllers/hskExamImport.controller');
const { authMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin.middleware');

function handleImportUpload(req, res, next) {
    hskExamImportController.uploadImportFiles(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                success: false,
                message: err.message || 'Upload import file không hợp lệ.',
            });
        }
        return next();
    });
}

// ============================================================
// ADMIN OCR IMPORT HOOK (additive; does not alter existing CRUD)
// Must stay before dynamic GET /:id routes.
// ============================================================

router.post(
    '/import/ocr',
    adminMiddleware,
    handleImportUpload,
    hskExamImportController.createOcrImport
);
router.get('/import/jobs/:jobId', adminMiddleware, hskExamImportController.getImportJob);

// ============================================================
// PUBLIC ROUTES (Client - Taking Exams)
// ============================================================

// Get list of active exams (public)
router.get('/public', hskExamController.getPublicExamList);

// Get full exam with answers + transcripts — requires login (đáp án + transcript
// là nội dung nhạy cảm, không để lộ cho khách chưa đăng nhập).
router.get('/:id/answers', authMiddleware, hskExamController.getExamAnswers);

// ============================================================
// AUTHENTICATED USER ROUTES (for students taking exams)
// ============================================================

// Start an exam (creates attempt)
router.post('/:id/start', authMiddleware, hskExamController.startExam);

// Submit answer during exam
router.post('/attempts/:attemptId/answer', authMiddleware, hskExamController.submitAnswer);

// Finish exam and get score
router.post('/attempts/:attemptId/finish', authMiddleware, hskExamController.finishExam);

// AI grading status for writing types
router.get('/attempts/:attemptId/ai-grade-status', authMiddleware, hskExamController.getAiGradeStatus);

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

// HF2 — Instantiate full exam skeleton from level template (HSK 1/2/3)
router.post('/from-template', adminMiddleware, hskExamController.createExamFromTemplate);

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

// ============================================================
// ADMIN ROUTES - Question Group Management (Phase A — refactor HSK 1-3)
// ============================================================

// List groups for section
router.get('/sections/:sectionId/groups', adminMiddleware, hskExamController.listGroups);

// Create group for section (image_grid / word_bank / reply_bank / passage)
router.post('/sections/:sectionId/groups', adminMiddleware, hskExamController.createGroup);

// Update group
router.put('/groups/:groupId', adminMiddleware, hskExamController.updateGroup);

// Delete group (FK CASCADE sets question.group_id = NULL)
router.delete('/groups/:groupId', adminMiddleware, hskExamController.deleteGroup);

module.exports = router;

