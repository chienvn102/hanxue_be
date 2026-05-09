/**
 * AI Rate Limit Middleware
 * DB-based rate limiting for AI chat endpoints
 * Uses daily_activity.ai_chats column with uk_user_date unique key
 *
 * Limits: Free = 200/day, Premium = 2000/day (test project — thoải mái)
 *
 * Fail-open: Nếu DB check lỗi → log + cho request đi tiếp (tránh chặn user
 * vì lỗi tạm thời ở model). Acceptable cho project test.
 */

const ChatModel = require('../models/chat.model');

async function aiRateLimit(req, res, next) {
    try {
        const userId = req.user.userId;

        const [userInfo, chatCount] = await Promise.all([
            ChatModel.getUserInfo(userId),
            ChatModel.getDailyAiChatCount(userId)
        ]);

        const limit = userInfo.isPremium ? 2000 : 200;
        const remaining = Math.max(0, limit - chatCount);

        // Set header for FE
        res.set('X-RateLimit-Remaining', String(remaining));

        if (chatCount >= limit) {
            return res.status(429).json({
                success: false,
                message: 'Ban da dung het luot chat AI hom nay. Quay lai ngay mai nhe!',
                data: { used: chatCount, limit, isPremium: userInfo.isPremium }
            });
        }

        // Attach to req for controller use
        req.aiRateInfo = { chatCount, limit, isPremium: userInfo.isPremium };

        next();
    } catch (error) {
        // Fail-open: log nhưng không chặn request. Khi DB tạm lỗi không nên
        // làm user chết tính năng — tệ nhất là 1 request "chui" qua rate limit.
        console.error('[aiRateLimit] DB check failed, allowing request through:', error.message);
        req.aiRateInfo = { chatCount: 0, limit: 200, isPremium: false, _failOpen: true };
        next();
    }
}

module.exports = aiRateLimit;
