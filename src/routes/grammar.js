/**
 * Grammar Routes
 */

const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin.middleware');
const grammarController = require('../controllers/grammar.controller');

const router = express.Router();

// Public Routes
router.get('/', optionalAuth, grammarController.list);
router.get('/:id', grammarController.getById);

// Admin Routes
router.post('/', adminMiddleware, grammarController.create);
router.put('/:id', adminMiddleware, grammarController.update);
router.delete('/:id', adminMiddleware, grammarController.deleteGrammar);

module.exports = router;
