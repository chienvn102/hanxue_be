/**
 * AI Rate Limit Middleware — DISABLED (test project)
 *
 * Đã tắt giới hạn theo yêu cầu (test only). Để bật lại sau:
 *   1. Uncomment block trong try/catch ở dưới
 *   2. Hoặc tăng/giảm limit (free 200, premium 2000) ở phía dưới
 *
 * Vẫn gắn `req.aiRateInfo` với placeholder để controller không bị undefined.
 */

async function aiRateLimit(req, res, next) {
    req.aiRateInfo = { chatCount: 0, limit: Infinity, isPremium: true, _disabled: true };
    res.set('X-RateLimit-Remaining', 'unlimited');
    next();
}

module.exports = aiRateLimit;
