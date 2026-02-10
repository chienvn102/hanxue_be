const express = require('express');
const router = express.Router();
const adminAuthController = require('../controllers/adminAuth.controller');
const adminMiddleware = require('../middleware/admin.middleware');

// Public admin routes
router.post('/login', adminAuthController.login);

// Protected admin routes
router.get('/me', adminMiddleware, adminAuthController.getMe);
router.get('/stats', adminMiddleware, adminAuthController.getStats);

module.exports = router;
