/**
 * Chat Model
 * DB operations for AI chat: rate limit tracking, user info lookup
 * Phase 1: Stateless — no message persistence, only daily_activity tracking
 */

const db = require('../config/database');

/**
 * Get today's AI chat count for a user
 * @param {number} userId
 * @returns {Promise<number>}
 */
async function getDailyAiChatCount(userId) {
    const [rows] = await db.execute(
        `SELECT ai_chats FROM daily_activity
         WHERE user_id = ? AND activity_date = CURDATE()`,
        [userId]
    );
    return rows[0]?.ai_chats || 0;
}

/**
 * Increment daily AI chat count (upsert) and return new count
 * Uses uk_user_date unique key for safe upsert
 * Returns the post-increment count for atomic XP cap check
 * @param {number} userId
 * @returns {Promise<number>} new ai_chats count after increment
 */
async function incrementDailyAiChat(userId) {
    await db.execute(
        `INSERT INTO daily_activity (user_id, activity_date, ai_chats)
         VALUES (?, CURDATE(), 1)
         ON DUPLICATE KEY UPDATE ai_chats = ai_chats + 1`,
        [userId]
    );
    // Read back the actual count after atomic increment
    const [rows] = await db.execute(
        `SELECT ai_chats FROM daily_activity
         WHERE user_id = ? AND activity_date = CURDATE()`,
        [userId]
    );
    return rows[0]?.ai_chats || 1;
}

/**
 * Get user's HSK level and premium status
 * @param {number} userId
 * @returns {Promise<{targetHsk: number, isPremium: boolean}>}
 */
async function getUserInfo(userId) {
    const [rows] = await db.execute(
        'SELECT target_hsk, is_premium FROM users WHERE id = ?',
        [userId]
    );
    if (!rows[0]) {
        return { targetHsk: 1, isPremium: false };
    }
    return {
        targetHsk: rows[0].target_hsk || 1,
        isPremium: Boolean(rows[0].is_premium)
    };
}

module.exports = {
    getDailyAiChatCount,
    incrementDailyAiChat,
    getUserInfo
};
