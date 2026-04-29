/**
 * Practice Controller
 * - GET /api/practice/text?level=1[&corpus=1]
 *
 * Default: ask Groq to generate a fresh, diverse Chinese practice sentence for
 * the user's HSK level. If Groq fails or `corpus=1` is passed, fall back to
 * the static corpus. The handler always responds with valid data — it never
 * surfaces Groq errors to the client (those just trigger fallback).
 */

const crypto = require('crypto');
const practiceTexts = require('../config/practiceTexts');

function genRequestId() {
    return 'practice-' + crypto.randomBytes(4).toString('hex');
}

async function getPracticeText(req, res) {
    const requestId = genRequestId();
    try {
        const userId = req.user.userId;
        const level = Math.min(6, Math.max(1, parseInt(req.query.level, 10) || 1));
        // Default to Groq generation; allow ?corpus=1 to force the static fallback.
        const useGroq = req.query.corpus !== '1';

        console.log(`[${requestId}] practice.getPracticeText userId=${userId} level=${level} useGroq=${useGroq}`);

        const text = await practiceTexts.getPracticeText(level, useGroq, requestId);

        console.log(`[${requestId}] practice.getPracticeText OK source=${text.source} len=${(text.text || '').length}`);

        return res.json({
            success: true,
            data: text,
        });
    } catch (error) {
        console.error(`[${requestId}] Get practice text error:`, {
            message: error.message,
            stack: error.stack,
        });
        // Last-resort fallback so FE never gets a 500 just for practice text.
        try {
            const level = Math.min(6, Math.max(1, parseInt(req.query.level, 10) || 1));
            const fallback = await practiceTexts.getPracticeText(level, false, requestId);
            return res.json({ success: true, data: fallback });
        } catch (innerErr) {
            console.error(`[${requestId}] Practice fallback also failed:`, innerErr.message);
            return res.status(500).json({
                success: false,
                message: 'Lỗi lấy văn bản luyện tập',
            });
        }
    }
}

module.exports = {
    getPracticeText,
};