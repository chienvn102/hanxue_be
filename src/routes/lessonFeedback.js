const express = require('express');
const router = express.Router();
const controller = require('../controllers/lessonFeedback.controller');
const { authMiddleware } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

// User endpoints (lesson-scoped)
router.get('/lessons/:id/feedback', controller.listByLesson);
router.post('/lessons/:id/feedback', authMiddleware, controller.create);
router.put('/lessons/feedback/:fid', authMiddleware, controller.update);
router.delete('/lessons/feedback/:fid', authMiddleware, controller.remove);

// Admin moderation (user-auth + role guard)
router.get('/admin/feedback', authMiddleware, requireAdmin, controller.adminList);
router.get('/admin/feedback/bug-count', authMiddleware, requireAdmin, controller.bugCount);
router.put('/admin/feedback/:fid/resolve', authMiddleware, requireAdmin, controller.adminResolve);
router.put('/admin/feedback/:fid/hide', authMiddleware, requireAdmin, controller.adminHide);
router.post('/admin/feedback/:fid/reply', authMiddleware, requireAdmin, controller.adminReply);

module.exports = router;
