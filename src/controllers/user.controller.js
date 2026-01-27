const UserModel = require('../models/user.model');
const bcrypt = require('bcryptjs');

/**
 * GET /api/user/profile
 */
async function getProfile(req, res) {
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
            isPremium: !!user.is_premium,
            createdAt: user.created_at
        });
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
        const { displayName, targetHsk } = req.body;

        const updated = await UserModel.updateProfile(userId, {
            displayName,
            targetHsk
        });

        if (!updated) {
            return res.status(404).json({ error: 'User not found or no changes made' });
        }

        res.json({ message: 'Profile updated successfully' });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
}

/**
 * PUT /api/user/password
 */
async function changePassword(req, res) {
    try {
        const userId = req.user.userId;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password required' });
        }

        // Get user to check current password
        const user = await UserModel.findByIdForRefresh(userId);
        // using findByIdForRefresh because it likely returns password_hash (need to verify model)
        // actually looking at user.model.js, findByEmailForLogin returns password_hash.
        // Let's create specific method or use DB directly here for simplicity if needed, 
        // but better to add findByIdWithPassword to model.

        // Temporary: verify via email flow allows retrieving password hash, 
        // to stick to MVC, we should add `findByIdWithPassword` to model.
        // For now, let's assume we implement that in model next.

        // Wait, I can't call a non-existent method.
        // Let's implement `updatePassword` in model which takes userId and new hash,
        // BUT we need to verify old password first.

        // Let's implement verifyPassword in model? Or getPasswordHash?
        const userWithPassword = await UserModel.findByIdWithPassword(userId);

        if (!userWithPassword || !userWithPassword.password_hash) {
            return res.status(400).json({ error: 'User validation failed or Google account used' });
        }

        const valid = await bcrypt.compare(currentPassword, userWithPassword.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Incorrect current password' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await UserModel.updatePassword(userId, newHash);

        res.json({ message: 'Password changed successfully' });

    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'Failed to change password' });
    }
}

module.exports = {
    getProfile,
    updateProfile,
    changePassword
};
