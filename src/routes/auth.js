/**
 * Auth Routes
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const authController = require('../controllers/auth.controller');

const router = express.Router();

const authAttemptLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false
});

// Register new user
router.post('/register', authAttemptLimiter, authController.register);

// Login
router.post('/login', authAttemptLimiter, authController.login);

// Login with Google Identity Services credential
router.post('/google', authAttemptLimiter, authController.googleLogin);

// Request password reset code
router.post('/forgot-password', passwordResetLimiter, authController.forgotPassword);

// Reset password with emailed code
router.post('/reset-password', passwordResetLimiter, authController.resetPassword);

// Refresh token
router.post('/refresh', authController.refresh);

// Get current user (requires auth)
router.get('/me', authMiddleware, authController.me);

module.exports = router;
