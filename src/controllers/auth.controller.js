/**
 * Auth Controller
 * Handles HTTP request/response for authentication endpoints
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const UserModel = require('../models/user.model');
const {
    createAndSendPasswordCode,
    verifyPasswordCode
} = require('../services/passwordCode.service');

const googleClient = new OAuth2Client();
const GENERIC_RESET_MESSAGE = 'If an account exists, a reset code has been sent.';

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function createHttpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function createAccessToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role || 'user' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
}

function createRefreshToken(user) {
    return jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
}

function toAuthUser(user) {
    const hasPassword = !!user.password_set_at;
    const profileCompleted = !!user.profile_completed_at;

    return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        targetHsk: user.target_hsk,
        isPremium: !!user.is_premium,
        hasPassword,
        profileCompleted,
        requiresOnboarding: !hasPassword || !profileCompleted,
        emailVerified: !!user.email_verified,
        googleLinked: !!user.google_id
    };
}

async function issueAuthResponse(user) {
    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);
    const refreshHash = await bcrypt.hash(refreshToken, 10);

    await UserModel.updateRefreshToken(user.id, refreshHash);

    return {
        accessToken,
        refreshToken,
        user: toAuthUser(user)
    };
}

async function verifyGoogleCredential(credential) {
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!clientId) {
        throw createHttpError(500, 'Google login is not configured');
    }

    if (!credential || typeof credential !== 'string') {
        throw createHttpError(400, 'Google credential required');
    }

    let ticket;
    try {
        ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: clientId
        });
    } catch (err) {
        throw createHttpError(401, 'Invalid Google credential');
    }
    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email) {
        throw createHttpError(401, 'Invalid Google credential');
    }

    if (!payload.email_verified) {
        throw createHttpError(403, 'Google email is not verified');
    }

    return {
        googleId: payload.sub,
        email: normalizeEmail(payload.email),
        displayName: payload.name || payload.email.split('@')[0],
        avatarUrl: payload.picture || null
    };
}

/**
 * POST /api/auth/register
 */
async function register(req, res) {
    try {
        const { password, displayName } = req.body;
        const email = normalizeEmail(req.body.email);

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
        const { password } = req.body;
        const email = normalizeEmail(req.body.email);

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

        // Check active status
        if (!user.is_active) {
            return res.status(403).json({ error: 'Account is disabled. Please contact support.' });
        }

        res.json(await issueAuthResponse(user));
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
}

/**
 * POST /api/auth/google
 */
async function googleLogin(req, res) {
    try {
        const googleUser = await verifyGoogleCredential(req.body.credential);
        let user = await UserModel.findByGoogleId(googleUser.googleId);

        if (!user) {
            const existing = await UserModel.findByEmail(googleUser.email);

            if (existing) {
                if (!existing.is_active) {
                    return res.status(403).json({ error: 'Account is disabled. Please contact support.' });
                }

                if (existing.google_id && existing.google_id !== googleUser.googleId) {
                    return res.status(409).json({ error: 'Email is already linked to another Google account' });
                }

                if (!existing.google_id) {
                    await UserModel.linkGoogleAccount(existing.id, {
                        googleId: googleUser.googleId,
                        avatarUrl: googleUser.avatarUrl,
                        displayName: googleUser.displayName,
                        emailVerified: true
                    });
                }

                user = await UserModel.findByIdForAuth(existing.id);
            } else {
                const randomPassword = crypto.randomBytes(32).toString('hex');
                const passwordHash = await bcrypt.hash(randomPassword, 10);
                const userId = await UserModel.create({
                    email: googleUser.email,
                    passwordHash,
                    displayName: googleUser.displayName,
                    googleId: googleUser.googleId,
                    avatarUrl: googleUser.avatarUrl,
                    emailVerified: true,
                    passwordSet: false,
                    profileCompleted: false
                });
                user = await UserModel.findByIdForAuth(userId);
            }
        }

        if (!user) {
            return res.status(500).json({ error: 'Google login failed' });
        }

        if (!user.is_active) {
            return res.status(403).json({ error: 'Account is disabled. Please contact support.' });
        }

        res.json(await issueAuthResponse(user));
    } catch (err) {
        const status = err.statusCode || 500;
        const message = err.statusCode ? err.message : 'Google login failed';
        console.error('Google login error:', err.message);
        res.status(status).json({ error: message });
    }
}

/**
 * POST /api/auth/forgot-password
 */
async function forgotPassword(req, res) {
    const email = normalizeEmail(req.body.email);

    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    try {
        const user = await UserModel.findByEmail(email);

        if (user && user.is_active) {
            try {
                await createAndSendPasswordCode(user, 'password_reset');
            } catch (err) {
                console.error('Password reset email error:', err.message);
            }
        }
    } catch (err) {
        console.error('Forgot password lookup error:', err.message);
    }

    res.json({ message: GENERIC_RESET_MESSAGE });
}

/**
 * POST /api/auth/reset-password
 */
async function resetPassword(req, res) {
    try {
        const email = normalizeEmail(req.body.email);
        const code = String(req.body.code || '').trim();
        const newPassword = String(req.body.newPassword || '');

        if (!email || !code || !newPassword) {
            return res.status(400).json({ error: 'Email, code, and new password required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const user = await UserModel.findByEmail(email);
        if (!user || !user.is_active) {
            return res.status(400).json({ error: 'Invalid or expired reset code' });
        }

        const codeResult = await verifyPasswordCode(user.id, code, 'password_reset');
        if (!codeResult.valid) {
            return res.status(400).json({ error: 'Invalid or expired reset code' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await UserModel.updatePassword(user.id, passwordHash);
        await UserModel.clearRefreshToken(user.id);

        res.json({ message: 'Password reset successfully' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password' });
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

        if (!user.refresh_token_hash) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Verify refresh token hash
        const valid = await bcrypt.compare(refreshToken, user.refresh_token_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Generate new access token (must include role to match login token shape)
        const accessToken = createAccessToken(user);

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
            dailyGoalMins: user.daily_goal_mins,
            preferredVoice: user.preferred_voice,
            nativeLanguage: user.native_language,
            totalXp: user.total_xp,
            currentStreak: user.current_streak,
            isPremium: user.is_premium,
            createdAt: user.created_at,
            hasPassword: !!user.password_set_at,
            profileCompleted: !!user.profile_completed_at,
            requiresOnboarding: !user.password_set_at || !user.profile_completed_at,
            emailVerified: !!user.email_verified,
            googleLinked: !!user.google_id
        });
    } catch (err) {
        console.error('Get me error:', err);
        res.status(500).json({ error: 'Failed to get user' });
    }
}

module.exports = {
    register,
    login,
    googleLogin,
    forgotPassword,
    resetPassword,
    refresh,
    me
};
