const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authMiddleware } = require('../middleware/auth');

const passwordCodeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false
});

// All routes require authentication
router.use(authMiddleware);

// Profile
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.post('/password-code', passwordCodeLimiter, userController.sendPasswordCode);
router.post('/onboarding', userController.completeOnboarding);
router.put('/password', userController.changePassword);

module.exports = router;
