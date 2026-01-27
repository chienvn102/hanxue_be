/**
 * Flashcard Routes
 */

const express = require('express');
const flashcardController = require('../controllers/flashcard.controller');

const router = express.Router();

// Get flashcard session
router.get('/', flashcardController.getSession);

// Get choices for multiple choice mode
router.get('/choices', flashcardController.getChoices);

module.exports = router;
