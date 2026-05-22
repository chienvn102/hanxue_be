const express = require('express');
const router = express.Router();
const writingController = require('../controllers/writingPractice.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/word', authMiddleware, writingController.getWord);
router.get('/due', authMiddleware, writingController.getDue);
router.post('/submit', authMiddleware, writingController.submit);

module.exports = router;
