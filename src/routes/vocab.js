/**
 * Vocabulary Routes
 */

const express = require('express');
const { optionalAuth } = require('../middleware/auth');
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

module.exports = router;
