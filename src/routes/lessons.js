const express = require('express');
const router = express.Router();
const lessonController = require('../controllers/lesson.controller');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const {
    checkCourseUnlocked,
    checkLessonCourseUnlocked,
} = require('../middleware/courseUnlock.middleware');
const roleMiddleware = require('../middleware/role.middleware');

// Public/User routes (optionalAuth allows viewing without login)
router.get('/course/:courseId', optionalAuth, checkCourseUnlocked, lessonController.getLessonsByCourse);
// /meta is the lightweight title+hsk header used by /flashcard/session,
// /practice/* pages to render "Từ vựng bài <title> · HSK <n>". MUST be before
// the bare /:id route to avoid matching 'meta' as id, and skips the
// course-unlock guard since the payload is non-sensitive metadata only.
router.get('/:id/meta', optionalAuth, lessonController.getLessonMeta);
router.get('/:id', optionalAuth, checkLessonCourseUnlocked, lessonController.getLessonDetails);

// Textbook lesson — full payload + per-section progress
router.get('/:id/textbook', optionalAuth, checkLessonCourseUnlocked, lessonController.getTextbookLesson);

// Authenticated user routes
router.post('/:id/progress', authMiddleware, checkLessonCourseUnlocked, lessonController.updateLessonProgress);
router.post('/:id/section-done', authMiddleware, checkLessonCourseUnlocked, lessonController.markSectionDone);
router.post('/writing/:exerciseId/submit', authMiddleware, lessonController.submitWritingExercise);

const adminMiddleware = require('../middleware/admin.middleware');

// Admin routes - Lessons (legacy — kept for backwards compat with admin UI)
router.post('/', adminMiddleware, roleMiddleware(['admin']), lessonController.createLesson);
router.put('/:id', adminMiddleware, roleMiddleware(['admin']), lessonController.updateLesson);
router.delete('/:id', adminMiddleware, roleMiddleware(['admin']), lessonController.deleteLesson);

// Admin routes - Textbook lesson lifecycle
router.post('/textbook', adminMiddleware, roleMiddleware(['admin']), lessonController.createTextbookLesson);
router.put('/:id/textbook', adminMiddleware, roleMiddleware(['admin']), lessonController.updateTextbookLesson);
router.post('/:id/vocabulary', adminMiddleware, roleMiddleware(['admin']), lessonController.attachVocabulary);
router.patch('/:id/vocabulary/:vocabId', adminMiddleware, roleMiddleware(['admin']), lessonController.updateVocabularyLink);
router.delete('/:id/vocabulary/:vocabId', adminMiddleware, roleMiddleware(['admin']), lessonController.detachVocabulary);
router.post('/:id/grammar', adminMiddleware, roleMiddleware(['admin']), lessonController.attachGrammar);
router.delete('/:id/grammar/:grammarId', adminMiddleware, roleMiddleware(['admin']), lessonController.detachGrammar);
router.post('/:id/writing', adminMiddleware, roleMiddleware(['admin']), lessonController.addWritingExercise);
router.patch('/:id/writing/:writingId', adminMiddleware, roleMiddleware(['admin']), lessonController.updateWritingExercise);
router.delete('/:id/writing/:writingId', adminMiddleware, roleMiddleware(['admin']), lessonController.deleteWritingExercise);

// Admin routes - Contents (legacy)
router.post('/:id/contents', adminMiddleware, roleMiddleware(['admin']), lessonController.addContent);

// Admin routes - Questions (legacy)
router.post('/:id/questions', adminMiddleware, roleMiddleware(['admin']), lessonController.addQuestion);

module.exports = router;
