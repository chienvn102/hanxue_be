/**
 * Flashcard Routes
 */

const express = require('express');
const flashcardController = require('../controllers/flashcard.controller');
const flashcardDeckController = require('../controllers/flashcardDeck.controller');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/decks', authMiddleware, flashcardDeckController.list);
router.post('/decks', authMiddleware, flashcardDeckController.create);
router.get('/decks/:id/session', authMiddleware, flashcardDeckController.session);
router.get('/decks/:id/items', authMiddleware, flashcardDeckController.listItems);
router.post('/decks/:id/items', authMiddleware, flashcardDeckController.addItem);
router.delete('/decks/:id/items/:vocabId', authMiddleware, flashcardDeckController.removeItem);
router.put('/decks/:id', authMiddleware, flashcardDeckController.updateDeck);
router.delete('/decks/:id', authMiddleware, flashcardDeckController.deleteDeck);

// Get flashcard session
router.get('/', flashcardController.getSession);

// Get choices for multiple choice mode
router.get('/choices', flashcardController.getChoices);

module.exports = router;
