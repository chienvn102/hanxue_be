/**
 * HSK Routes
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const hskController = require('../controllers/hsk.controller');

const router = express.Router();

// Get HSK tests list
router.get('/tests', hskController.getTests);

// Get single test with questions
router.get('/tests/:id', hskController.getTestById);

// Submit test answers (requires auth)
router.post('/tests/:id/submit', authMiddleware, hskController.submitTest);

// Get user's test results (requires auth)
router.get('/results', authMiddleware, hskController.getResults);

module.exports = router;
