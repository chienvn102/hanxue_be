const express = require('express');
const router = express.Router();
const realtimeController = require('../controllers/realtime.controller');
const { authMiddleware } = require('../middleware/auth');
const aiRateLimit = require('../middleware/aiRateLimit');

// Mint a short-lived OpenAI Realtime ephemeral session.
// authMiddleware enforces login; aiRateLimit shares the chat rate counters
// so users can't farm sessions to bypass /api/chat throttles.
router.post('/session', authMiddleware, aiRateLimit, realtimeController.createSession);

module.exports = router;
