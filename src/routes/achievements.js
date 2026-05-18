const express = require('express');
const router = express.Router();
const achievementsController = require('../controllers/achievements.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, achievementsController.list);

module.exports = router;
