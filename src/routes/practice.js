/**
 * Practice Routes
 * Mount: /api/practice
 * All routes require auth.
 *
 * Translate endpoints share the same daily Groq budget as /api/chat/send via
 * the `aiRateLimit` middleware (Free 20/day, Premium 500/day).
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const aiRateLimit = require('../middleware/aiRateLimit');
const practiceController = require('../controllers/practice.controller');

const router = express.Router();

// All practice routes require auth
router.use(authMiddleware);

// Speech practice text (legacy)
router.get('/text', practiceController.getPracticeText);

// HF4.3 — Match game (server-side session, anti-XP-farm)
router.get('/match', practiceController.getMatchPairs);
router.post('/match-clear', practiceController.clearMatchPair);

// HF4.4 — Translate game (Groq) — gated by aiRateLimit + server session token
router.post('/translate-prompt', aiRateLimit, practiceController.translatePrompt);
router.post('/translate-grade',  aiRateLimit, practiceController.translateGrade);

module.exports = router;
