/**
 * Auth Routes
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const authController = require('../controllers/auth.controller');

const router = express.Router();

// Register new user
router.post('/register', authController.register);

// Login
router.post('/login', authController.login);

// Refresh token
router.post('/refresh', authController.refresh);

// Get current user (requires auth)
router.get('/me', authMiddleware, authController.me);

module.exports = router;
