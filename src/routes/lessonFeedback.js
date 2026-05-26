const express = require('express');
const router = express.Router();
const controller = require('../controllers/lessonFeedback.controller');
const { authMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin.middleware');

// User endpoints (lesson-scoped) — dùng user JWT (accessToken)
router.get('/lessons/:id/feedback', controller.listByLesson);
router.post('/lessons/:id/feedback', authMiddleware, controller.create);
router.put('/lessons/feedback/:fid', authMiddleware, controller.update);
router.delete('/lessons/feedback/:fid', authMiddleware, controller.remove);

// Admin moderation — dùng adminToken (bảng `admins`) để đồng bộ với UI
// /admin/login. Controller xử lý FK user_id bằng "shadow user" tự tạo cho
// adminReply (tránh hai hệ auth chồng chéo).
router.get('/admin/feedback', adminMiddleware, controller.adminList);
router.get('/admin/feedback/bug-count', adminMiddleware, controller.bugCount);
router.put('/admin/feedback/:fid/resolve', adminMiddleware, controller.adminResolve);
router.put('/admin/feedback/:fid/hide', adminMiddleware, controller.adminHide);
router.post('/admin/feedback/:fid/reply', adminMiddleware, controller.adminReply);

module.exports = router;
