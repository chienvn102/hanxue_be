/**
 * AI Rate Limit Middleware
 * DB-based rate limiting for AI chat endpoints
 * Uses daily_activity.ai_chats column with uk_user_date unique key
 *
 * Limits: Free = 20/day, Premium = 500/day
 */

const ChatModel = require('../models/chat.model');

async function aiRateLimit(req, res, next) {
    try {
        const userId = req.user.userId;

        const [userInfo, chatCount] = await Promise.all([
            ChatModel.getUserInfo(userId),
            ChatModel.getDailyAiChatCount(userId)
        ]);

        const limit = userInfo.isPremium ? 500 : 20;
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
        console.error('AI rate limit error:', error);
        return res.status(500).json({
            success: false,
            message: 'Loi he thong khi kiem tra gioi han. Vui long thu lai.'
        });
    }
}

module.exports = aiRateLimit;
