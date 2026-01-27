/**
 * Character Routes
 */

const express = require('express');
const characterController = require('../controllers/character.controller');

const router = express.Router();

// Get characters by word (must be before /:hanzi)
router.get('/word/:word', characterController.getByWord);

// Get character by hanzi
router.get('/:hanzi', characterController.getByHanzi);

// Get stroke order only
router.get('/:hanzi/stroke', characterController.getStroke);

module.exports = router;
