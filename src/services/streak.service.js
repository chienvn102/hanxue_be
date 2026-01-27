/**
 * Streak Service
 * Handles user study streak and XP calculations
 * Logic based on module2a.md specification
 */

const db = require('../config/database');

/**
 * Update user streak after study activity
 * 
 * Logic:
 * - Same day: No change
 * - Consecutive day (yesterday): Increase streak by 1
 * - Gap (more than 1 day): Reset streak to 1
 */
async function updateStreak(userId) {
    try {
        const [rows] = await db.execute(
            'SELECT last_study_date, current_streak, longest_streak, total_study_days FROM users WHERE id = ?',
            [userId]
        );

        if (!rows[0]) return { updated: false, reason: 'User not found' };

        const user = rows[0];
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Parse last study date
        let lastStudyStr = null;
        if (user.last_study_date) {
            const lastStudy = new Date(user.last_study_date);
            lastStudyStr = lastStudy.toISOString().split('T')[0];
        }

        // If already studied today, no update needed
        if (lastStudyStr === todayStr) {
            return { updated: false, reason: 'Already studied today' };
        }

        let newStreak = user.current_streak || 0;
        let newTotalDays = user.total_study_days || 0;

        // Calculate yesterday's date
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (lastStudyStr === yesterdayStr) {
            // Consecutive day - increase streak
            newStreak += 1;
        } else {
            // Gap or first time - reset/start streak
            newStreak = 1;
        }

        // Increase total study days
        newTotalDays += 1;

        // Update longest streak if needed
        const newLongest = Math.max(newStreak, user.longest_streak || 0);

        // Update database
        await db.execute(
            `UPDATE users SET 
                current_streak = ?, 
                longest_streak = ?, 
                total_study_days = ?, 
                last_study_date = CURDATE() 
             WHERE id = ?`,
            [newStreak, newLongest, newTotalDays, userId]
        );

        return {
            updated: true,
            currentStreak: newStreak,
            longestStreak: newLongest,
            totalStudyDays: newTotalDays
        };
    } catch (error) {
        console.error('Update streak error:', error);
        throw error;
    }
}

/**
 * Add XP to user
 * @param {number} userId 
 * @param {number} xp - Amount of XP to add
 */
async function addXP(userId, xp) {
    try {
        await db.execute(
            'UPDATE users SET total_xp = COALESCE(total_xp, 0) + ? WHERE id = ?',
            [xp, userId]
        );
        return true;
    } catch (error) {
        console.error('Add XP error:', error);
        throw error;
    }
}

/**
 * Calculate XP based on review quality
 * @param {number} quality - 0-5 rating
 * @returns {number} XP amount
 */
function calculateXP(quality) {
    const xpMap = {
        0: 0,
        1: 0,
        2: 0,
        3: 5,  // Correct with difficulty
        4: 8,  // Correct with hesitation
        5: 10  // Perfect response
    };
    return xpMap[quality] || 0;
}

module.exports = {
    updateStreak,
    addXP,
    calculateXP
};
