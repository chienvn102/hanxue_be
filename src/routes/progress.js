/**
 * Progress Routes — flashcard accuracy tracking (SRS removed in HF4.1).
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const progressController = require('../controllers/progress.controller');

const router = express.Router();

router.get('/new', authMiddleware, progressController.getNew);
router.get('/stats', authMiddleware, progressController.getStats);
router.get('/today', authMiddleware, progressController.getToday);
router.post('/review', authMiddleware, progressController.submitReview);
router.get('/:vocabId', authMiddleware, progressController.getProgressById);

module.exports = router;
