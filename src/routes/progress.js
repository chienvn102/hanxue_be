/**
 * Progress Routes
 * Track user vocabulary learning progress with SRS
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const progressController = require('../controllers/progress.controller');

const router = express.Router();

// Get vocabulary due for review
router.get('/due', authMiddleware, progressController.getDue);

// Get new vocabulary to learn
router.get('/new', authMiddleware, progressController.getNew);

// Get user learning statistics
router.get('/stats', authMiddleware, progressController.getStats);

// Submit vocabulary review result
router.post('/review', authMiddleware, progressController.submitReview);

// Get progress for specific vocabulary
router.get('/:vocabId', authMiddleware, progressController.getProgressById);

module.exports = router;
