/**
 * Practice Controller
 * - GET  /api/practice/text?level=1[&corpus=1]      (legacy speech-practice text)
 * - GET  /api/practice/match?hsk=&limit=8           (HF4.3 — Pikachu match game)
 * - POST /api/practice/match-clear {token, vocabId} (HF4.3 — verify pair, +5 XP)
 * - POST /api/practice/translate-prompt {hsk}       (HF4.4 — AI sinh câu Việt → Trung)
 * - POST /api/practice/translate-grade {token, user_zh}  (HF4.4 — AI chấm)
 *
 * Anti-abuse (post code-review):
 *   - Match: server giữ token + Set<pairIds claimed>. Client chỉ gửi vocabId
 *     đã clear; server verify token + vocabId chưa claim → award 5 XP và mark.
 *   - Translate: server giữ {vi, expectedZh, hsk, graded}. Client KHÔNG gửi
 *     expected_zh nữa — chỉ gửi token + user_zh. Mỗi token chỉ grade được 1
 *     lần (graded=true → 410 Gone).
 *   - Translate routes thêm aiRateLimit (như /api/chat/send) để chặn farm Groq.
 *   - Sessions có TTL 30 phút, auto-cleanup mỗi lần insert.
 */

const crypto = require('crypto');
const practiceTexts = require('../config/practiceTexts');
const db = require('../config/database');
const groq = require('../services/groq');
const streakService = require('../services/streak.service');
const ChatModel = require('../models/chat.model');

const SESSION_TTL_MS = 30 * 60 * 1000;
const MATCH_XP_PER_PAIR = 5;

/**
 * In-memory session stores. Đủ cho single-process droplet hiện tại;
 * khi scale ra nhiều worker → chuyển sang Redis hoặc bảng DB.
 *   matchSessions:     token → { userId, pairIds: Set, cleared: Set, expiresAt }
 *   translateSessions: token → { userId, vi, expectedZh, expectedPinyin, hsk, graded, expiresAt }
 */
const matchSessions = new Map();
const translateSessions = new Map();

function genRequestId(prefix) {
    return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function genSessionToken() {
    return crypto.randomBytes(16).toString('hex'); // 32 hex chars
}

function purgeExpired(store) {
    const now = Date.now();
    for (const [k, v] of store) {
        if (v.expiresAt < now) store.delete(k);
    }
}

function normalizeHsk(hsk) {
    if (hsk === undefined || hsk === null || hsk === '') return null;
    const n = Number.parseInt(hsk, 10);
    if (!Number.isFinite(n) || n < 1 || n > 6) return null;
    return n;
}

/**
 * Strip a leading ```json ... ``` fence so JSON.parse works on Groq output.
 */
function unwrapJsonFence(s) {
    if (!s) return s;
    return String(s)
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

// =====================================================================
// /api/practice/text  (legacy, không thay đổi)
// =====================================================================
async function getPracticeText(req, res) {
    const requestId = genRequestId('practice');
    try {
        const userId = req.user.userId;
        const level = Math.min(6, Math.max(1, parseInt(req.query.level, 10) || 1));
        const useGroq = req.query.corpus !== '1';

        console.log(`[${requestId}] practice.getPracticeText userId=${userId} level=${level} useGroq=${useGroq}`);
        const text = await practiceTexts.getPracticeText(level, useGroq, requestId);
        return res.json({ success: true, data: text });
    } catch (error) {
        console.error(`[${requestId}] Get practice text error:`, error.message);
        try {
            const level = Math.min(6, Math.max(1, parseInt(req.query.level, 10) || 1));
            const fallback = await practiceTexts.getPracticeText(level, false, requestId);
            return res.json({ success: true, data: fallback });
        } catch (innerErr) {
            console.error(`[${requestId}] Practice fallback also failed:`, innerErr.message);
            return res.status(500).json({ success: false, message: 'Lỗi lấy văn bản luyện tập' });
        }
    }
}

// =====================================================================
// HF4.3 — GET /api/practice/match?hsk=&limit=8
// Server tạo session: pairIds = ids đã chọn. Trả về token cho client.
// =====================================================================
async function getMatchPairs(req, res) {
    try {
        purgeExpired(matchSessions);

        const hskInt = normalizeHsk(req.query.hsk);
        const limit = Math.min(parseInt(req.query.limit, 10) || 8, 16);

        // Pull 4x oversample rồi dedup theo meaning_vi VÀ simplified để tránh
        // ambiguous matches (vd nhiều vocab có cùng nghĩa "to/lớn" sẽ rối UI).
        let sql = `
            SELECT id, simplified, pinyin, meaning_vi
            FROM vocabulary
            WHERE meaning_vi IS NOT NULL AND meaning_vi != ''
              AND simplified IS NOT NULL AND simplified != ''
        `;
        const params = [];
        if (hskInt !== null) {
            sql += ' AND hsk_level = ?';
            params.push(hskInt);
        }
        sql += ' ORDER BY RAND() LIMIT ?';
        params.push(limit * 4);

        const [rawRows] = await db.execute(sql, params);

        // Dedup: chuẩn hoá meaning_vi (lowercase, trim, lấy nghĩa đầu tiên trước
        // dấu phẩy/chấm phẩy) để tránh "to lớn" và "lớn, rộng" coi là khác nhau.
        const norm = (s) => String(s || '')
            .toLowerCase()
            .split(/[;,\/|()\[\]:]/)[0]
            .trim();

        const seenMeaning = new Set();
        const seenSimplified = new Set();
        const dedup = [];
        for (const r of rawRows) {
            const m = norm(r.meaning_vi);
            if (!m) continue;
            if (seenMeaning.has(m) || seenSimplified.has(r.simplified)) continue;
            seenMeaning.add(m);
            seenSimplified.add(r.simplified);
            dedup.push(r);
            if (dedup.length >= limit) break;
        }

        // Nếu dedup không đủ (db quá ít), fallback bằng raw rows giữ thứ tự nhưng
        // chỉ cấm trùng simplified (gameplay vẫn chạy được)
        if (dedup.length < Math.min(2, limit)) {
            const fallback = [];
            const seenS = new Set();
            for (const r of rawRows) {
                if (seenS.has(r.simplified)) continue;
                seenS.add(r.simplified);
                fallback.push(r);
                if (fallback.length >= limit) break;
            }
            if (fallback.length >= 2) dedup.splice(0, dedup.length, ...fallback);
        }

        if (dedup.length < 2) {
            return res.json({ success: true, token: '', pairs: [] });
        }

        const token = genSessionToken();
        matchSessions.set(token, {
            userId: req.user.userId,
            pairIds: new Set(dedup.map(r => r.id)),
            cleared: new Set(),
            expiresAt: Date.now() + SESSION_TTL_MS,
        });

        return res.json({
            success: true,
            token,
            pairs: dedup.map(r => ({
                id: r.id,
                simplified: r.simplified,
                pinyin: r.pinyin,
                meaningVi: r.meaning_vi,
            }))
        });
    } catch (err) {
        console.error('Get match pairs error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi lấy cặp từ' });
    }
}

// =====================================================================
// HF4.3 — POST /api/practice/match-clear {token, vocabId}
// Verify session + vocab thuộc session + chưa cleared → +5 XP, mark cleared.
// =====================================================================
async function clearMatchPair(req, res) {
    try {
        const { token, vocabId } = req.body || {};
        if (!token || !vocabId) {
            return res.status(400).json({ success: false, message: 'Thiếu token/vocabId.' });
        }

        const session = matchSessions.get(token);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Phiên đã hết hạn. Bắt đầu ván mới.' });
        }
        if (session.userId !== req.user.userId) {
            return res.status(403).json({ success: false, message: 'Không khớp người chơi.' });
        }
        if (session.expiresAt < Date.now()) {
            matchSessions.delete(token);
            return res.status(410).json({ success: false, message: 'Phiên đã hết hạn.' });
        }
        const vid = Number.parseInt(vocabId, 10);
        if (!Number.isFinite(vid) || !session.pairIds.has(vid)) {
            return res.status(400).json({ success: false, message: 'Cặp không thuộc ván này.' });
        }
        if (session.cleared.has(vid)) {
            return res.status(409).json({ success: false, message: 'Cặp đã được tính trước đó.' });
        }

        session.cleared.add(vid);

        try {
            await streakService.updateStreak(req.user.userId);
            await streakService.addXP(req.user.userId, MATCH_XP_PER_PAIR);
        } catch (xpErr) {
            console.error('clearMatchPair streak/xp error:', xpErr.message);
        }

        // Cleanup nếu user đã clear hết
        if (session.cleared.size >= session.pairIds.size) {
            matchSessions.delete(token);
        }

        return res.json({
            success: true,
            data: { cleared: session.cleared.size, total: session.pairIds.size, xpEarned: MATCH_XP_PER_PAIR }
        });
    } catch (err) {
        console.error('clearMatchPair error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi xử lý.' });
    }
}

// =====================================================================
// HF4.4 — POST /api/practice/translate-prompt {hsk}
// KHÔNG gửi expected_zh/expected_pinyin về client (chỉ giữ server-side).
// =====================================================================
async function translatePrompt(req, res) {
    const requestId = genRequestId('translate-prompt');
    try {
        purgeExpired(translateSessions);

        const hskInt = normalizeHsk(req.body?.hsk) || 1;

        const messages = [
            {
                role: 'system',
                content:
                    'Bạn là giáo viên dạy tiếng Trung. Sinh đúng MỘT câu tiếng Việt phù hợp với học viên HSK ' +
                    hskInt +
                    '. Câu phải đơn giản, sử dụng từ vựng có trong HSK ≤ ' + hskInt + '. ' +
                    'Trả về CHỈ một JSON object hợp lệ (không markdown), với key: ' +
                    '"vi" (câu tiếng Việt), "expected_zh" (bản dịch tiếng Trung giản thể), ' +
                    '"expected_pinyin" (pinyin có dấu thanh).'
            },
            { role: 'user', content: 'Sinh 1 câu mới.' }
        ];

        const { text } = await groq.sendMessage(messages, requestId);
        let parsed;
        try {
            parsed = JSON.parse(unwrapJsonFence(text));
        } catch {
            console.error(`[${requestId}] translatePrompt JSON parse failed; raw="${(text || '').slice(0, 200)}"`);
            return res.status(502).json({ success: false, message: 'AI trả về dữ liệu không hợp lệ.' });
        }

        if (!parsed.vi || !parsed.expected_zh) {
            return res.status(502).json({ success: false, message: 'AI thiếu trường bắt buộc.' });
        }

        // Đếm vào cùng quota AI/ngày như /api/chat/send (best-effort).
        try { await ChatModel.incrementDailyAiChat(req.user.userId); } catch {}

        const vi = String(parsed.vi).trim();
        const expectedZh = String(parsed.expected_zh).trim();
        const expectedPinyin = parsed.expected_pinyin ? String(parsed.expected_pinyin).trim() : '';

        const token = genSessionToken();
        translateSessions.set(token, {
            userId: req.user.userId,
            vi,
            expectedZh,
            expectedPinyin,
            hsk: hskInt,
            graded: false,
            expiresAt: Date.now() + SESSION_TTL_MS,
        });

        return res.json({
            success: true,
            data: {
                token,
                vi,
                hsk: hskInt,
                // expected_zh / expected_pinyin chỉ trả về SAU khi grade.
            }
        });
    } catch (err) {
        console.error(`[${requestId}] translatePrompt error:`, err.message);
        return res.status(err.status || 500).json({
            success: false,
            message: err.publicMessage || 'Lỗi tạo câu dịch.'
        });
    }
}

// =====================================================================
// HF4.4 — POST /api/practice/translate-grade {token, user_zh}
// Server lookup vi/expected_zh từ session. XP: ≥80 → +10, 50–79 → +5, <50 → +1
// Token one-time-use (graded=true → 410 Gone).
// =====================================================================
async function translateGrade(req, res) {
    const requestId = genRequestId('translate-grade');
    try {
        const { token, user_zh } = req.body || {};
        if (!token || !user_zh) {
            return res.status(400).json({ success: false, message: 'Thiếu token/user_zh.' });
        }

        const session = translateSessions.get(token);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Phiên đã hết hạn. Sinh câu mới.' });
        }
        if (session.userId !== req.user.userId) {
            return res.status(403).json({ success: false, message: 'Không khớp người chơi.' });
        }
        if (session.expiresAt < Date.now()) {
            translateSessions.delete(token);
            return res.status(410).json({ success: false, message: 'Phiên đã hết hạn.' });
        }
        if (session.graded) {
            return res.status(410).json({ success: false, message: 'Câu này đã được chấm rồi. Sinh câu mới.' });
        }

        const userZh = String(user_zh).trim();
        if (!userZh) {
            return res.status(400).json({ success: false, message: 'user_zh trống.' });
        }

        const messages = [
            {
                role: 'system',
                content:
                    'Bạn là giáo viên chấm bài dịch tiếng Trung. Đánh giá bản dịch của học viên ' +
                    'dựa trên: đúng nghĩa + ngữ pháp + dùng từ phù hợp. Trả về CHỈ một JSON object ' +
                    '(không markdown), với key: "score" (số nguyên 0-100), "feedback_vi" (nhận xét ngắn ' +
                    'tiếng Việt 1-2 câu), "correct_zh" (bản dịch chính xác/được khuyên dùng).'
            },
            {
                role: 'user',
                content:
                    `Câu gốc tiếng Việt: "${session.vi}"\n` +
                    `Bản dịch mẫu: "${session.expectedZh}"\n` +
                    `Bản dịch của học viên: "${userZh}"\n\n` +
                    `Hãy chấm điểm.`
            }
        ];

        const { text } = await groq.sendMessage(messages, requestId);
        let parsed;
        try {
            parsed = JSON.parse(unwrapJsonFence(text));
        } catch {
            console.error(`[${requestId}] translateGrade JSON parse failed; raw="${(text || '').slice(0, 200)}"`);
            return res.status(502).json({ success: false, message: 'AI trả về dữ liệu không hợp lệ.' });
        }

        try { await ChatModel.incrementDailyAiChat(req.user.userId); } catch {}

        const scoreNum = Number.parseInt(parsed.score, 10);
        const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, scoreNum)) : 0;
        const feedbackVi = parsed.feedback_vi ? String(parsed.feedback_vi).trim() : '';
        const correctZh = parsed.correct_zh ? String(parsed.correct_zh).trim() : session.expectedZh;

        // XP rules — không persist history per Q6
        let xp = 1;
        if (score >= 80) xp = 10;
        else if (score >= 50) xp = 5;

        // Mark session as graded → token một-lần-dùng
        session.graded = true;
        // Clean up sau khi grade thành công
        translateSessions.delete(token);

        try {
            await streakService.updateStreak(req.user.userId);
            if (xp > 0) await streakService.addXP(req.user.userId, xp);
        } catch (xpErr) {
            console.error(`[${requestId}] streak/xp update failed:`, xpErr.message);
        }

        return res.json({
            success: true,
            data: {
                score,
                feedbackVi,
                correctZh,
                expectedPinyin: session.expectedPinyin,
                xpEarned: xp,
            }
        });
    } catch (err) {
        console.error(`[${requestId}] translateGrade error:`, err.message);
        return res.status(err.status || 500).json({
            success: false,
            message: err.publicMessage || 'Lỗi chấm bài dịch.'
        });
    }
}

module.exports = {
    getPracticeText,
    getMatchPairs,
    clearMatchPair,
    translatePrompt,
    translateGrade,
};
