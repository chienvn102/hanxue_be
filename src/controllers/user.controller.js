const bcrypt = require('bcryptjs');
const UserModel = require('../models/user.model');
const {
    createAndSendPasswordCode,
    verifyPasswordCode
} = require('../services/passwordCode.service');
const { resolveAudioUrl } = require('../services/audioUrl.service');

function toBoolean(value) {
    return !!value;
}

/**
 * Resolve a stored media reference (gs://bucket/object) to a signed read URL.
 * Non-gs:// values (relative `/uploads/...` paths, absolute http URLs, null)
 * are returned unchanged. Implemented via the existing audioUrl service —
 * the same gs:// → signed-URL machinery already used for audio works for
 * any GCS object, including avatars.
 */
async function resolveStoredMediaUrl(raw) {
    return resolveAudioUrl(raw);
}

async function toUserResponse(user) {
    const hasPassword = toBoolean(user.password_set_at);
    const profileCompleted = toBoolean(user.profile_completed_at);
    const avatarUrl = await resolveStoredMediaUrl(user.avatar_url);

    return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl,
        role: user.role,
        targetHsk: user.target_hsk,
        completedHskLevels: UserModel.parseJsonArray(user.completed_hsk_levels).map(Number).filter(Number.isFinite),
        dailyGoalMins: user.daily_goal_mins,
        preferredVoice: user.preferred_voice,
        totalXp: user.total_xp || 0,
        currentStreak: user.current_streak || 0,
        longestStreak: user.longest_streak || 0,
        totalStudyDays: user.total_study_days || 0,
        lastStudyDate: user.last_study_date,
        nativeLanguage: user.native_language,
        isPremium: !!user.is_premium,
        createdAt: user.created_at,
        hasPassword,
        profileCompleted,
        requiresOnboarding: !hasPassword || !profileCompleted,
        emailVerified: !!user.email_verified,
        googleLinked: !!user.google_id
    };
}

function normalizeProfileInput(body) {
    const data = {};

    if (body.displayName !== undefined) {
        const displayName = String(body.displayName).trim();
        if (!displayName || displayName.length > 100) {
            throw new Error('Display name must be 1-100 characters');
        }
        data.displayName = displayName;
    }

    if (body.targetHsk !== undefined) {
        const targetHsk = Number(body.targetHsk);
        if (!Number.isInteger(targetHsk) || targetHsk < 1 || targetHsk > 6) {
            throw new Error('Target HSK must be between 1 and 6');
        }
        data.targetHsk = targetHsk;
    }

    if (body.nativeLanguage !== undefined) {
        const nativeLanguage = String(body.nativeLanguage).trim().toLowerCase();
        if (!nativeLanguage || nativeLanguage.length > 10) {
            throw new Error('Native language is invalid');
        }
        data.nativeLanguage = nativeLanguage;
    }

    if (body.dailyGoalMins !== undefined) {
        const dailyGoalMins = Number(body.dailyGoalMins);
        if (!Number.isInteger(dailyGoalMins) || dailyGoalMins < 1 || dailyGoalMins > 600) {
            throw new Error('Daily goal must be between 1 and 600 minutes');
        }
        data.dailyGoalMins = dailyGoalMins;
    }

    if (body.preferredVoice !== undefined) {
        const preferredVoice = String(body.preferredVoice).trim().toLowerCase();
        if (!['male', 'female'].includes(preferredVoice)) {
            throw new Error('Preferred voice is invalid');
        }
        data.preferredVoice = preferredVoice;
    }

    if (body.avatarUrl !== undefined) {
        const avatarUrl = String(body.avatarUrl || '').trim();
        if (avatarUrl && avatarUrl.length > 255) {
            throw new Error('Avatar URL is too long');
        }
        data.avatarUrl = avatarUrl || null;
    }

    return data;
}

async function getFreshProfile(userId) {
    const user = await UserModel.findById(userId);
    return user ? await toUserResponse(user) : null;
}

/**
 * GET /api/user/profile
 */
async function getProfile(req, res) {
    try {
        const profile = await getFreshProfile(req.user.userId);
        if (!profile) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(profile);
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Failed to retrieve profile' });
    }
}

/**
 * PUT /api/user/profile
 */
async function updateProfile(req, res) {
    try {
        const userId = req.user.userId;
        const profileData = normalizeProfileInput(req.body);

        if (Object.keys(profileData).length === 0) {
            return res.status(400).json({ error: 'No profile fields provided' });
        }

        const updated = await UserModel.updateProfile(userId, profileData);

        if (!updated) {
            return res.status(404).json({ error: 'User not found or no changes made' });
        }

        const profile = await getFreshProfile(userId);
        res.json(profile);
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(400).json({ error: err.message || 'Failed to update profile' });
    }
}

/**
 * POST /api/user/password-code
 */
async function sendPasswordCode(req, res) {
    try {
        const user = await UserModel.findByIdForAuth(req.user.userId);
        if (!user || !user.is_active) {
            return res.status(404).json({ error: 'User not found' });
        }

        await createAndSendPasswordCode(user, 'password_change');
        res.json({ message: 'Verification code sent' });
    } catch (err) {
        console.error('Send password code error:', err.message);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
}

/**
 * POST /api/user/onboarding
 */
async function completeOnboarding(req, res) {
    try {
        const userId = req.user.userId;
        const user = await UserModel.findByIdWithPassword(userId);
        const profileData = normalizeProfileInput(req.body);
        const newPassword = String(req.body.newPassword || '');

        if (!user || !user.is_active) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!newPassword) {
            return res.status(400).json({ error: 'Password required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const requiredFields = ['displayName', 'targetHsk', 'nativeLanguage', 'dailyGoalMins', 'preferredVoice'];
        const missingField = requiredFields.find((field) => profileData[field] === undefined);
        if (missingField) {
            return res.status(400).json({ error: 'Required profile fields missing' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await UserModel.completeOnboarding(userId, {
            passwordHash,
            ...profileData
        });

        const profile = await getFreshProfile(userId);
        res.json(profile);
    } catch (err) {
        console.error('Complete onboarding error:', err);
        res.status(400).json({ error: err.message || 'Failed to complete onboarding' });
    }
}

/**
 * PUT /api/user/password
 */
async function changePassword(req, res) {
    try {
        const userId = req.user.userId;
        const { currentPassword } = req.body;
        const code = String(req.body.code || '').trim();
        const newPassword = String(req.body.newPassword || '');

        if (!code || !newPassword) {
            return res.status(400).json({ error: 'Verification code and new password required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const userWithPassword = await UserModel.findByIdWithPassword(userId);

        if (!userWithPassword || !userWithPassword.password_hash || !userWithPassword.is_active) {
            return res.status(400).json({ error: 'User validation failed' });
        }

        if (userWithPassword.password_set_at) {
            if (!currentPassword) {
                return res.status(400).json({ error: 'Current password required' });
            }

            const validPassword = await bcrypt.compare(currentPassword, userWithPassword.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Incorrect current password' });
            }
        }

        const codeResult = await verifyPasswordCode(userId, code, 'password_change');
        if (!codeResult.valid) {
            return res.status(400).json({ error: 'Invalid or expired verification code' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await UserModel.updatePassword(userId, newHash);
        await UserModel.clearRefreshToken(userId);

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'Failed to change password' });
    }
}

module.exports = {
    getProfile,
    updateProfile,
    sendPasswordCode,
    completeOnboarding,
    changePassword
};
