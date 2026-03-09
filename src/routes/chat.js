const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { authMiddleware } = require('../middleware/auth');
const aiRateLimit = require('../middleware/aiRateLimit');

// All chat routes require authentication
// POST /api/chat/send — rate limited
router.post('/send', authMiddleware, aiRateLimit, chatController.sendMessage);

// GET /api/chat/usage — no rate limit needed
router.get('/usage', authMiddleware, chatController.getUsage);

module.exports = router;
