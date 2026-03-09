/**
 * Chat Controller
 * Handles AI chat endpoints (Phase 1: stateless)
 * Response format: { success: true/false, data/message }
 * (follows lesson/course/notebook convention)
 */

const groqService = require('../services/groq');
const ChatModel = require('../models/chat.model');
const streakService = require('../services/streak.service');

// System prompts
const SYSTEM_PROMPT_CHAT = (level) =>
    `Ban la gia su tieng Trung than thien ten 小明 (Xiǎo Míng).
Nhiem vu: giai thich kien thuc tieng Trung cho nguoi hoc Viet Nam.
Trinh do nguoi hoc: HSK ${level}.
Quy tac:
- Luon hien thi: Han tu + Pinyin + nghia tieng Viet
- Giai thich ngan gon, de hieu
- Them vi du cau khi can
- Chi dung tu vung HSK ${level} tro xuong
- Tra loi bang tieng Viet, giu tieng Trung khi can thiet`;

const SYSTEM_PROMPT_CONVERSATION = (level) =>
    `Ban la nguoi ban ngu tieng Trung ten 小红 (Xiǎo Hóng), dang tro chuyen realtime.
Trinh do nguoi hoc: HSK ${level}.
Quy tac QUAN TRONG:
- Chi dung tu vung HSK ${level} tro xuong
- Tra loi NGAN, toi da 2 cau tieng Trung
- Moi cau Trung kem (nghia Viet) ngay sau
- Phan hoi tu nhien nhu noi chuyen that
- Neu sai, sua nhe nhang roi tiep tuc
- KHONG dung markdown — chi van xuoi don gian (vi TTS se doc)`;

// Max history entries to send to Groq
const MAX_HISTORY_LENGTH = 20;
// Max chars per history message content
const MAX_CONTENT_LENGTH = 5000;
// Max chars for user message
const MAX_MESSAGE_LENGTH = 2000;
// Allowed roles in history
const ALLOWED_ROLES = new Set(['user', 'assistant']);
// XP per chat message
const XP_PER_CHAT = 10;
// Max messages that earn XP per day (cap = XP_PER_CHAT * MAX_XP_MESSAGES = 50)
const MAX_XP_MESSAGES = 5;

/**
 * Sanitize history array from client
 * - Only allow role = 'user' | 'assistant'
 * - Strip extra fields, keep only { role, content }
 * - Truncate content per message
 * - Truncate array to max entries
 */
function sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];

    return history
        .slice(-MAX_HISTORY_LENGTH)
        .filter(msg =>
            msg &&
            typeof msg.role === 'string' &&
            ALLOWED_ROLES.has(msg.role) &&
            typeof msg.content === 'string' &&
            msg.content.trim().length > 0
        )
        .map(msg => ({
            role: msg.role,
            content: msg.content.slice(0, MAX_CONTENT_LENGTH)
        }));
}

/**
 * POST /api/chat/send
 * Send a message to AI and get a response
 */
async function sendMessage(req, res) {
    try {
        const userId = req.user.userId;
        const { message, mode, history } = req.body;

        // Validate message
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Tin nhan khong duoc de trong'
            });
        }

        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Tin nhan qua dai (toi da ${MAX_MESSAGE_LENGTH} ky tu)`
            });
        }

        // Validate mode
        const chatMode = (mode === 'conversation') ? 'conversation' : 'chat';

        // Sanitize history from client
        const cleanHistory = sanitizeHistory(history);

        // Get user info for HSK level
        const userInfo = await ChatModel.getUserInfo(userId);
        const hskLevel = userInfo.targetHsk;

        // Build system prompt
        const systemPrompt = chatMode === 'conversation'
            ? SYSTEM_PROMPT_CONVERSATION(hskLevel)
            : SYSTEM_PROMPT_CHAT(hskLevel);

        // Build messages array for Groq
        const groqMessages = [
            { role: 'system', content: systemPrompt },
            ...cleanHistory,
            { role: 'user', content: message.trim() }
        ];

        // Call Groq API
        const { text: reply } = await groqService.sendMessage(groqMessages);

        // Increment daily chat count (returns actual post-increment count)
        const newChatCount = await ChatModel.incrementDailyAiChat(userId);

        // Award XP if under daily cap (5 messages * 10 XP = 50 XP/day)
        // Uses post-increment count for atomic check — no race condition
        if (newChatCount <= MAX_XP_MESSAGES) {
            try {
                await streakService.addXP(userId, XP_PER_CHAT);
            } catch (xpErr) {
                console.error('Add chat XP error:', xpErr);
            }
        }

        // Update streak
        try {
            await streakService.updateStreak(userId);
        } catch (streakErr) {
            console.error('Update streak error:', streakErr);
        }

        // Calculate remaining
        const limit = req.aiRateInfo?.limit || (userInfo.isPremium ? 500 : 20);
        const remaining = Math.max(0, limit - newChatCount);

        return res.json({
            success: true,
            data: { reply, remaining }
        });

    } catch (error) {
        console.error('Chat send error:', error);
        return res.status(500).json({
            success: false,
            message: 'Loi he thong. Vui long thu lai sau.'
        });
    }
}

/**
 * GET /api/chat/usage
 * Get user's daily AI chat usage
 */
async function getUsage(req, res) {
    try {
        const userId = req.user.userId;

        const [userInfo, chatCount] = await Promise.all([
            ChatModel.getUserInfo(userId),
            ChatModel.getDailyAiChatCount(userId)
        ]);

        const limit = userInfo.isPremium ? 500 : 20;

        return res.json({
            success: true,
            data: {
                used: chatCount,
                limit,
                isPremium: userInfo.isPremium
            }
        });

    } catch (error) {
        console.error('Chat usage error:', error);
        return res.status(500).json({
            success: false,
            message: 'Loi he thong'
        });
    }
}

module.exports = {
    sendMessage,
    getUsage
};
