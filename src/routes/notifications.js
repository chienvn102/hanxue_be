const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/vapid-public-key', notificationController.getVapidPublicKey);
router.post('/subscribe', authMiddleware, notificationController.subscribe);
router.post('/unsubscribe', authMiddleware, notificationController.unsubscribe);
router.get('/pending', authMiddleware, notificationController.pending);
router.get('/unread-count', authMiddleware, notificationController.unreadCount);
router.get('/preferences', authMiddleware, notificationController.getPreferences);
router.put('/preferences', authMiddleware, notificationController.updatePreferences);
router.put('/read-all', authMiddleware, notificationController.markAllRead);
router.put('/:id/read', authMiddleware, notificationController.markRead);

module.exports = router;
