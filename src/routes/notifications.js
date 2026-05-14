const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/vapid-public-key', notificationController.getVapidPublicKey);
router.post('/subscribe', authMiddleware, notificationController.subscribe);
router.post('/unsubscribe', authMiddleware, notificationController.unsubscribe);
router.get('/pending', authMiddleware, notificationController.pending);
router.put('/:id/read', authMiddleware, notificationController.markRead);

module.exports = router;
