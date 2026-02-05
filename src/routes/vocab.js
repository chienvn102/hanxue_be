/**
 * Vocabulary Routes
 */

const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin.middleware');
const vocabController = require('../controllers/vocab.controller');

const router = express.Router();

// Get vocabulary list
router.get('/', optionalAuth, vocabController.list);

// Fulltext search (must be before /:id to avoid conflict)
router.get('/search/fulltext', vocabController.searchFulltext);

// Get single vocabulary
router.get('/:id', vocabController.getById);

// Get examples for vocabulary
router.get('/:id/examples', vocabController.getExamples);

// ========== Admin Routes ==========
router.post('/', adminMiddleware, vocabController.create);
router.put('/:id', adminMiddleware, vocabController.update);
router.delete('/:id', adminMiddleware, vocabController.deleteVocab);

// ========== Notebook Save/Unsave ==========
const { authMiddleware } = require('../middleware/auth');
const notebookController = require('../controllers/notebook.controller');
router.post('/:id/save', authMiddleware, notebookController.saveVocab);
router.delete('/:id/save', authMiddleware, notebookController.unsaveVocab);

module.exports = router;
