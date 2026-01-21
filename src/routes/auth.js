const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register new user
 *     description: Create a new user account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: password123
 *               displayName:
 *                 type: string
 *                 example: John Doe
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User created
 *                 userId:
 *                   type: integer
 *                   example: 1
 *       400:
 *         description: Invalid input or email exists
 *       500:
 *         description: Server error
 */
// Register
router.post('/register', async (req, res) => {
    try {
        const { email, password, displayName } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Check existing user
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await db.execute(
            'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)',
            [email, passwordHash, displayName || null]
        );

        res.status(201).json({
            message: 'User created',
            userId: result.insertId
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const [users] = await db.execute(
            'SELECT id, email, password_hash, display_name, target_hsk, is_premium FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];

        // Verify password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate tokens
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
        );

        const refreshToken = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
        );

        // Store refresh token hash
        const refreshHash = await bcrypt.hash(refreshToken, 10);
        await db.execute(
            'UPDATE users SET refresh_token_hash = ? WHERE id = ?',
            [refreshHash, user.id]
        );

        res.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                displayName: user.display_name,
                targetHsk: user.target_hsk,
                isPremium: user.is_premium
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Refresh token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        // Verify token
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

        // Get user
        const [users] = await db.execute(
            'SELECT id, email, refresh_token_hash FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const user = users[0];

        // Verify refresh token hash
        const valid = await bcrypt.compare(refreshToken, user.refresh_token_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Generate new access token
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
        );

        res.json({ accessToken });
    } catch (err) {
        console.error('Refresh error:', err);
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const [users] = await db.execute(
            `SELECT id, email, display_name, avatar_url, target_hsk, 
                    total_xp, current_streak, is_premium, created_at
             FROM users WHERE id = ?`,
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        res.json({
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            avatarUrl: user.avatar_url,
            targetHsk: user.target_hsk,
            totalXp: user.total_xp,
            currentStreak: user.current_streak,
            isPremium: user.is_premium,
            createdAt: user.created_at
        });
    } catch (err) {
        console.error('Get me error:', err);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

module.exports = router;
