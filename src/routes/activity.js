const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activity.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/recent', authMiddleware, activityController.recent);

module.exports = router;
