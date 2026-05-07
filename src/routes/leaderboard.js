/**
 * Leaderboard Routes — public-readable, optional auth (nếu có thì biết user "me").
 * Mount: /api/leaderboard
 */

const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const leaderboardController = require('../controllers/leaderboard.controller');

const router = express.Router();

router.get('/', optionalAuth, leaderboardController.getLeaderboard);

module.exports = router;
