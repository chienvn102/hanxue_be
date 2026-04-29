/**
 * Speech Rate Limit Middleware
 * DB-based rate limiting for speech endpoints (TTS, STT, Pronunciation)
 * Uses daily_activity.speech_requests column
 */

const db = require('../config/database');

async function speechRateLimit(req, res, next) {
    try {
        const userId = req.user.userId;

        const [userInfo, speechCount] = await Promise.all([
            getUserInfo(userId),
            getDailySpeechCount(userId)
        ]);

        const limit = userInfo.isPremium ? 100 : 20; // Premium: 100/day, Free: 20/day
        const remaining = Math.max(0, limit - speechCount);

        // Set header for FE
        res.set('X-SpeechRateLimit-Remaining', String(remaining));

        if (speechCount >= limit) {
            return res.status(429).json({
                success: false,
                message: 'Bạn đã dùng hết lượt giọng nói hôm nay. Quay lại ngày mai nhé!',
                data: { used: speechCount, limit, isPremium: userInfo.isPremium }
            });
        }

        // Attach to req for controller use
        req.speechRateInfo = { speechCount, limit, isPremium: userInfo.isPremium };

        next();
    } catch (error) {
        console.error('Speech rate limit error:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi hệ thống khi kiểm tra giới hạn. Vui lòng thử lại.'
        });
    }
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

/**
 * Get today's speech request count for a user
 * @param {number} userId
 * @returns {Promise<number>}
 */
async function getDailySpeechCount(userId) {
    const [rows] = await db.execute(
        `SELECT speech_requests FROM daily_activity
         WHERE user_id = ? AND activity_date = CURDATE()`,
        [userId]
    );
    return rows[0]?.speech_requests || 0;
}

/**
 * Increment daily speech request count
 * @param {number} userId
 * @returns {Promise<number>} new count
 */
async function incrementDailySpeechCount(userId) {
    await db.execute(
        `INSERT INTO daily_activity (user_id, activity_date, speech_requests)
         VALUES (?, CURDATE(), 1)
         ON DUPLICATE KEY UPDATE speech_requests = speech_requests + 1`,
        [userId]
    );
    const [rows] = await db.execute(
        `SELECT speech_requests FROM daily_activity
         WHERE user_id = ? AND activity_date = CURDATE()`,
        [userId]
    );
    return rows[0]?.speech_requests || 1;
}

module.exports = {
    speechRateLimit,
    incrementDailySpeechCount
};