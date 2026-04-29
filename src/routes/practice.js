/**
 * Practice Routes
 * Mount: /api/practice
 * All routes require auth
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const practiceController = require('../controllers/practice.controller');

const router = express.Router();

// All practice routes require auth
router.use(authMiddleware);

// GET /api/practice/text?level=1&examples=true
router.get('/text', practiceController.getPracticeText);

module.exports = router;