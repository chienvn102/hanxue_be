/**
 * Achievement unlocker.
 *
 * Achievement keys are stable strings stored in user_achievements.
 * The catalog (display name, icon, threshold) lives both here (for unlock
 * detection) and on the frontend (`src/lib/achievements.ts`) for rendering.
 * Keep both in sync if you add/remove badges.
 */

const db = require('../config/database');
const pushService = require('./push.service');
const activityLog = require('./activityLog.service');

const STREAK_BADGES = [
    { key: 'streak_3',   target: 3,   name: 'Khởi động',          icon: 'local_fire_department' },
    { key: 'streak_7',   target: 7,   name: 'Tuần đầu tiên',      icon: 'local_fire_department' },
    { key: 'streak_30',  target: 30,  name: 'Tháng vàng',         icon: 'local_fire_department' },
    { key: 'streak_100', target: 100, name: 'Trăm ngày',          icon: 'local_fire_department' },
    { key: 'streak_365', target: 365, name: 'Một năm bền bỉ',     icon: 'local_fire_department' },
];

const XP_BADGES = [
    { key: 'xp_100',   target: 100,   name: '100 XP đầu tiên',  icon: 'bolt' },
    { key: 'xp_1000',  target: 1000,  name: '1000 XP',           icon: 'bolt' },
    { key: 'xp_5000',  target: 5000,  name: '5000 XP',           icon: 'bolt' },
    { key: 'xp_10000', target: 10000, name: '10K XP',            icon: 'bolt' },
];

const VOCAB_BADGES = [
    { key: 'vocab_100',  target: 100,  name: '100 từ đầu tiên', icon: 'auto_stories' },
    { key: 'vocab_500',  target: 500,  name: '500 từ vựng',     icon: 'auto_stories' },
    { key: 'vocab_1000', target: 1000, name: '1000 từ vựng',    icon: 'auto_stories' },
    { key: 'vocab_2500', target: 2500, name: '2500 từ vựng',    icon: 'auto_stories' },
];

const HSK_BADGES = [
    { key: 'hsk_1_pass', target: 1, name: 'Vượt qua HSK 1', icon: 'workspace_premium' },
    { key: 'hsk_2_pass', target: 2, name: 'Vượt qua HSK 2', icon: 'workspace_premium' },
    { key: 'hsk_3_pass', target: 3, name: 'Vượt qua HSK 3', icon: 'workspace_premium' },
    { key: 'hsk_4_pass', target: 4, name: 'Vượt qua HSK 4', icon: 'workspace_premium' },
    { key: 'hsk_5_pass', target: 5, name: 'Vượt qua HSK 5', icon: 'workspace_premium' },
    { key: 'hsk_6_pass', target: 6, name: 'Vượt qua HSK 6', icon: 'workspace_premium' },
];

const ALL = [...STREAK_BADGES, ...XP_BADGES, ...VOCAB_BADGES, ...HSK_BADGES];
const BY_KEY = Object.fromEntries(ALL.map(b => [b.key, b]));

async function unlock(userId, key, metricValue = null) {
    const badge = BY_KEY[key];
    if (!badge) return false;
    try {
        const [result] = await db.execute(
            `INSERT IGNORE INTO user_achievements (user_id, achievement_key, metric_value)
             VALUES (?, ?, ?)`,
            [userId, key, metricValue]
        );
        if (result.affectedRows === 0) return false; // already had it
        // Notify + log
        await Promise.allSettled([
            activityLog.log(userId, 'achievement_unlocked', {
                title: `Mở khoá huy hiệu: ${badge.name}`,
                icon: badge.icon,
                payload: { key, name: badge.name, metricValue },
            }),
            pushService.pushToUser(userId, {
                title: 'Mở khoá huy hiệu mới!',
                body: badge.name,
                url: '/achievements',
                tag: `achievement-${key}`,
                type: 'achievement_unlocked',
                icon: badge.icon,
            }),
        ]);
        return true;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return false;
        console.error('[achievements] unlock failed:', error.message);
        return false;
    }
}

async function checkStreakAchievements(userId, currentStreak) {
    const eligible = STREAK_BADGES.filter(b => currentStreak >= b.target);
    for (const b of eligible) {
        await unlock(userId, b.key, currentStreak);
    }
}

async function checkXpAchievements(userId, totalXp) {
    const eligible = XP_BADGES.filter(b => totalXp >= b.target);
    for (const b of eligible) {
        await unlock(userId, b.key, totalXp);
    }
}

async function checkVocabAchievements(userId, masteredCount) {
    const eligible = VOCAB_BADGES.filter(b => masteredCount >= b.target);
    for (const b of eligible) {
        await unlock(userId, b.key, masteredCount);
    }
}

async function checkHskAchievement(userId, hskLevel) {
    const key = `hsk_${hskLevel}_pass`;
    if (!BY_KEY[key]) return;
    await unlock(userId, key, hskLevel);
}

async function getUnlocked(userId) {
    try {
        const [rows] = await db.execute(
            `SELECT achievement_key, earned_at, metric_value
               FROM user_achievements
              WHERE user_id = ?
              ORDER BY earned_at DESC`,
            [userId]
        );
        return rows.map(r => ({
            key: r.achievement_key,
            earnedAt: r.earned_at,
            metricValue: r.metric_value,
        }));
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return [];
        throw error;
    }
}

module.exports = {
    unlock,
    checkStreakAchievements,
    checkXpAchievements,
    checkVocabAchievements,
    checkHskAchievement,
    getUnlocked,
    catalog: ALL,
};
