/**
 * Auth Controller
 * Handles HTTP request/response for authentication endpoints
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/user.model');

/**
 * POST /api/auth/register
 */
async function register(req, res) {
    try {
        const { email, password, displayName } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Check existing user
        const existing = await UserModel.findByEmail(email);
        if (existing) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Insert user
        const userId = await UserModel.create({ email, passwordHash, displayName });

        res.status(201).json({
            message: 'User created',
            userId
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const user = await UserModel.findByEmailForLogin(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

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
        await UserModel.updateRefreshToken(user.id, refreshHash);

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
}

/**
 * POST /api/auth/refresh
 */
async function refresh(req, res) {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        // Verify token
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

        // Get user
        const user = await UserModel.findByIdForRefresh(decoded.userId);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

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
}

/**
 * GET /api/auth/me
 */
async function me(req, res) {
    try {
        const user = await UserModel.findById(req.user.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

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
}

module.exports = {
    register,
    login,
    refresh,
    me
};
