/**
 * Streak Service
 * Handles user study streak and XP calculations
 * Logic based on module2a.md specification
 */

const db = require('../config/database');
const xpService = require('./xp.service');
const pushService = require('./push.service');
const activityLog = require('./activityLog.service');
const achievementsService = require('./achievements.service');

const STREAK_MILESTONES = new Set([3, 7, 14, 30, 50, 100, 200, 365]);

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
        // Use DB's CURDATE() for consistent timezone handling
        const [rows] = await db.execute(
            `SELECT last_study_date, current_streak, longest_streak, total_study_days,
                    CURDATE() as today_date,
                    DATE_SUB(CURDATE(), INTERVAL 1 DAY) as yesterday_date
             FROM users WHERE id = ?`,
            [userId]
        );

        if (!rows[0]) return { updated: false, reason: 'User not found' };

        const user = rows[0];
        const todayStr = user.today_date;
        const yesterdayStr = user.yesterday_date;

        // Parse last study date for comparison
        let lastStudyStr = null;
        if (user.last_study_date) {
            // last_study_date is a DATE column, format as YYYY-MM-DD
            const d = new Date(user.last_study_date);
            lastStudyStr = d.toISOString().split('T')[0];
        }

        // Format today/yesterday from DB for comparison
        const todayFormatted = new Date(todayStr).toISOString().split('T')[0];
        const yesterdayFormatted = new Date(yesterdayStr).toISOString().split('T')[0];

        // If already studied today, no update needed
        if (lastStudyStr === todayFormatted) {
            return { updated: false, reason: 'Already studied today' };
        }

        let newStreak = user.current_streak || 0;
        let newTotalDays = user.total_study_days || 0;

        if (lastStudyStr === yesterdayFormatted) {
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

        // Milestone — fire-and-forget side effects (don't block streak return)
        if (STREAK_MILESTONES.has(newStreak)) {
            (async () => {
                try {
                    await activityLog.log(userId, 'streak_milestone', {
                        title: `Đạt ${newStreak} ngày học liên tục!`,
                        payload: { streak: newStreak },
                    });
                    await pushService.pushToUser(userId, {
                        title: `${newStreak} ngày liên tục!`,
                        body: `Bạn đã giữ chuỗi học ${newStreak} ngày. Tiếp tục giữ phong độ nhé!`,
                        url: '/profile',
                        tag: `streak-${newStreak}`,
                        type: 'streak_milestone',
                        icon: 'local_fire_department',
                    });
                    await achievementsService.checkStreakAchievements(userId, newStreak);
                } catch (e) {
                    console.error('[streak] milestone side-effect failed:', e.message);
                }
            })();
        }

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
    return xpService.awardXp(userId, 'manual', { amount: xp, skipLevelUnlock: true });
}

/**
 * Calculate XP based on review quality
 * @param {number} quality - 0-5 rating
 * @returns {number} XP amount
 */
function calculateXP(quality) {
    return xpService.calculateXP(quality);
}

module.exports = {
    updateStreak,
    addXP,
    calculateXP
};
