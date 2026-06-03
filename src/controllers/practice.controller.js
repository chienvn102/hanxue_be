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
const gemini = require('../services/gemini.service');
const groq = require('../services/groq');
const streakService = require('../services/streak.service');
const xpService = require('../services/xp.service');
const ChatModel = require('../models/chat.model');
const grammarQuizModel = require('../models/grammarQuiz.model');

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
// quizSessions: token → { userId, questions: [{id, correctAnswer, grammarId, explanation, points}],
//                         answers: { [questionId]: { correct, grammarId } }, finished, expiresAt }
const quizSessions = new Map();

function genRequestId(prefix) {
    return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function genSessionToken() {
    return crypto.randomBytes(16).toString('hex'); // 32 hex chars
}

// Translate game chạy Groq-first (LPU nhanh hơn Gemini cho output ngắn/JSON),
// fallback Gemini nếu Groq tắt/lỗi/thiếu key. Bật mặc định; tắt qua env.
const GROQ_TRANSLATE_ENABLED = process.env.GROQ_TRANSLATE_ENABLED !== 'false';

async function translateAi(messages, requestId, opts = {}) {
    const canGroq = GROQ_TRANSLATE_ENABLED && process.env.GROQ_API_KEY;
    if (canGroq) {
        try {
            return await groq.sendMessage(messages, requestId, opts);
        } catch (err) {
            console.error(`[${requestId}] Groq translate failed, fallback Gemini:`, err.message);
        }
    }
    return gemini.sendMessage(messages, requestId);
}

// =====================================================================
// Translate grading — sanitize AI-returned breakdown shape so we never
// pass through arbitrary keys. Anything missing/malformed → safe defaults.
// =====================================================================

function clampScore(raw) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
}

function sanitizeAxis(axis, listKey) {
    if (!axis || typeof axis !== 'object') {
        return { score: 0, commentVi: '', [listKey]: [] };
    }
    const out = {
        score: clampScore(axis.score),
        commentVi: typeof axis.comment_vi === 'string' ? axis.comment_vi.trim() : '',
    };
    const list = Array.isArray(axis[listKey]) ? axis[listKey] : [];
    out[listKey] = list.slice(0, 6).map(item => {
        if (!item || typeof item !== 'object') return null;
        if (listKey === 'issues') {
            return {
                type: typeof item.type === 'string' ? item.type.slice(0, 40) : 'other',
                found: typeof item.found === 'string' ? item.found.slice(0, 120) : '',
                shouldBe: typeof item.should_be === 'string' ? item.should_be.slice(0, 120) : '',
                explanationVi: typeof item.explanation_vi === 'string' ? item.explanation_vi.trim().slice(0, 240) : '',
            };
        }
        // suggestions
        return {
            yourWord: typeof item.your_word === 'string' ? item.your_word.slice(0, 40) : '',
            betterWord: typeof item.better_word === 'string' ? item.better_word.slice(0, 40) : '',
            reasonVi: typeof item.reason_vi === 'string' ? item.reason_vi.trim().slice(0, 240) : '',
        };
    }).filter(Boolean);
    return out;
}

function sanitizeBreakdown(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        meaningAccuracy: {
            score: clampScore(raw.meaning_accuracy?.score),
            commentVi: typeof raw.meaning_accuracy?.comment_vi === 'string' ? raw.meaning_accuracy.comment_vi.trim() : '',
        },
        grammar: sanitizeAxis(raw.grammar, 'issues'),
        vocabulary: sanitizeAxis(raw.vocabulary, 'suggestions'),
        fluency: {
            score: clampScore(raw.fluency?.score),
            commentVi: typeof raw.fluency?.comment_vi === 'string' ? raw.fluency.comment_vi.trim() : '',
        },
    };
}

function sanitizeHighlights(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 6).map(item => {
        if (!item || typeof item !== 'object') return null;
        const type = item.type === 'good' || item.type === 'warn' ? item.type : 'good';
        const text = typeof item.text_vi === 'string' ? item.text_vi.trim().slice(0, 200) : '';
        if (!text) return null;
        return { type, textVi: text };
    }).filter(Boolean);
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
            await xpService.awardXp(req.user.userId, 'practice_match_pair', {
                refId: vid,
                refType: 'vocabulary',
            });
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
    const startedAt = Date.now();
    console.log(`[${requestId}] translatePrompt START userId=${req.user?.userId} hsk=${req.body?.hsk}`);
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

        const { text } = await translateAi(messages, requestId, {
            temperature: 0.8,
            maxTokens: 400,
            jsonMode: true,
        });
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
        try {
            await ChatModel.incrementDailyAiChat(req.user.userId);
        } catch (dbErr) {
            console.error(`[${requestId}] incrementDailyAiChat error:`, dbErr.message);
        }

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

        console.log(`[${requestId}] translatePrompt OK in ${Date.now() - startedAt}ms`);
        return res.json({
            success: true,
            data: {
                token,
                vi,
                hsk: hskInt,
                // expected_zh / expected_pinyin chỉ trả về SAU khi grade.
            }
        });
    } catch (error) {
        console.error(`[${requestId}] translatePrompt error:`, {
            message: error.message,
            status: error.status,
            stack: error.stack,
        });
        const httpStatus = [429, 502, 503, 504].includes(error.status) ? error.status : 500;
        return res.status(httpStatus).json({
            success: false,
            message: error.publicMessage || 'Lỗi tạo câu dịch. Vui lòng thử lại.'
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
                    `Bạn là giáo viên dạy tiếng Trung cho người Việt (trình độ HSK ${session.hsk || 1}). ` +
                    'Chấm bài dịch theo 4 trục — mỗi trục có điểm 0-100 và phân tích cụ thể:\n' +
                    '- meaning_accuracy: bản dịch truyền tải đúng ý câu gốc tiếng Việt không\n' +
                    '- grammar: cấu trúc câu, trật tự từ, từ loại, trợ từ\n' +
                    '- vocabulary: dùng từ phù hợp HSK, có từ nào nên thay tốt hơn\n' +
                    '- fluency: câu có tự nhiên không, có quá cứng/dài/lặp không\n\n' +
                    'NGUYÊN TẮC:\n' +
                    '- KHÔNG bịa lỗi nếu câu đã đúng. Nếu trục đó hoàn hảo, issues/suggestions là mảng rỗng.\n' +
                    '- KHÔNG nhận xét chung chung như "cần luyện thêm". Phải chỉ rõ chỗ sai cụ thể.\n' +
                    '- Với mỗi lỗi grammar: chỉ ra "found" (đoạn sai trong câu học viên), "should_be" (nên viết thế nào), "explanation_vi" (1 câu giải thích vì sao).\n' +
                    '- Với mỗi từ có thể thay tốt hơn: "your_word", "better_word", "reason_vi" (1 câu).\n' +
                    '- highlights là 2-4 điểm nổi bật: "good" cho điểm tốt, "warn" cho điểm sai trọng yếu.\n' +
                    '- overall_score là điểm tổng 0-100 dựa trên 4 trục (không cần trung bình cộng cứng — weight theo mức độ nghiêm trọng lỗi).\n\n' +
                    'Trả về CHỈ JSON object (không markdown, không fence) theo schema:\n' +
                    '{\n' +
                    '  "overall_score": <0-100>,\n' +
                    '  "breakdown": {\n' +
                    '    "meaning_accuracy": { "score": <0-100>, "comment_vi": "..." },\n' +
                    '    "grammar": { "score": <0-100>, "issues": [ { "type": "word_order|missing_word|particle|tense|...", "found": "...", "should_be": "...", "explanation_vi": "..." } ] },\n' +
                    '    "vocabulary": { "score": <0-100>, "suggestions": [ { "your_word": "...", "better_word": "...", "reason_vi": "..." } ] },\n' +
                    '    "fluency": { "score": <0-100>, "comment_vi": "..." }\n' +
                    '  },\n' +
                    '  "highlights": [ { "type": "good|warn", "text_vi": "..." } ],\n' +
                    '  "feedback_vi": "Tổng kết 1-2 câu tiếng Việt cho học viên",\n' +
                    '  "correct_zh": "...",\n' +
                    '  "correct_pinyin": "...",\n' +
                    '  "next_practice_hint_vi": "Gợi ý 1 mẫu câu / pattern nên luyện tiếp"\n' +
                    '}'
            },
            {
                role: 'user',
                content:
                    `Câu gốc tiếng Việt: "${session.vi}"\n` +
                    `Bản dịch mẫu: "${session.expectedZh}"\n` +
                    `Bản dịch của học viên: "${userZh}"\n\n` +
                    `Chấm bài.`
            }
        ];

        const { text } = await translateAi(messages, requestId, {
            temperature: 0.2,
            maxTokens: 1800,
            jsonMode: true,
        });
        let parsed;
        try {
            parsed = JSON.parse(unwrapJsonFence(text));
        } catch {
            console.error(`[${requestId}] translateGrade JSON parse failed; raw="${(text || '').slice(0, 200)}"`);
            return res.status(502).json({ success: false, message: 'AI trả về dữ liệu không hợp lệ.' });
        }

        try { await ChatModel.incrementDailyAiChat(req.user.userId); } catch {}

        // overall_score is the new canonical field; fall back to legacy "score" if missing.
        const rawScore = parsed.overall_score ?? parsed.score;
        const scoreNum = Number.parseInt(rawScore, 10);
        const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, scoreNum)) : 0;
        const feedbackVi = parsed.feedback_vi ? String(parsed.feedback_vi).trim() : '';
        const correctZh = parsed.correct_zh ? String(parsed.correct_zh).trim() : session.expectedZh;
        const correctPinyin = parsed.correct_pinyin ? String(parsed.correct_pinyin).trim() : (session.expectedPinyin || '');
        const nextHintVi = parsed.next_practice_hint_vi ? String(parsed.next_practice_hint_vi).trim() : '';
        const breakdown = sanitizeBreakdown(parsed.breakdown);
        const highlights = sanitizeHighlights(parsed.highlights);

        // XP rules — không persist history per Q6
        const xp = xpService.calculateAmount('practice_translate', { score });

        // Mark session as graded → token một-lần-dùng
        session.graded = true;
        // Clean up sau khi grade thành công
        translateSessions.delete(token);

        try {
            await streakService.updateStreak(req.user.userId);
            if (xp > 0) {
                await xpService.awardXp(req.user.userId, 'practice_translate', {
                    score,
                    refType: 'translate_session',
                });
            }
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
                correctPinyin,
                xpEarned: xp,
                breakdown,
                highlights,
                nextPracticeHintVi: nextHintVi,
            }
        });
    } catch (error) {
        console.error(`[${requestId}] translateGrade error:`, {
            message: error.message,
            status: error.status,
            stack: error.stack,
        });
        const httpStatus = [429, 502, 503, 504].includes(error.status) ? error.status : 500;
        return res.status(httpStatus).json({
            success: false,
            message: error.publicMessage || 'Lỗi chấm bài dịch. Vui lòng thử lại.'
        });
    }
}

async function writeComplete(req, res) {
    try {
        const charactersCompleted = Math.min(Math.max(parseInt(req.body?.charactersCompleted, 10) || 1, 1), 20);
        const totalMistakes = Math.max(parseInt(req.body?.totalMistakes, 10) || 0, 0);
        const xpEarned = await xpService.awardXp(req.user.userId, 'write_complete', {
            amount: charactersCompleted * 5,
            refType: 'write_practice',
            metadata: { charactersCompleted, totalMistakes },
        });
        await streakService.updateStreak(req.user.userId);
        res.json({ success: true, xpEarned });
    } catch (error) {
        console.error('writeComplete error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

// =====================================================================
// Grammar Quiz — seeded MCQ linked to grammar points.
// Anti-cheat: server holds correct answers; client never receives them on
// /start. Grading + XP happen server-side. Mirrors match/translate sessions.
// =====================================================================

async function grammarQuizStart(req, res) {
    try {
        purgeExpired(quizSessions);

        const body = req.body || {};
        const grammarIds = Array.isArray(body.grammarIds)
            ? body.grammarIds.map(Number).filter(Number.isFinite)
            : [];
        const hsk = normalizeHsk(body.hsk);
        const limit = Math.min(Math.max(parseInt(body.limit, 10) || 10, 1), 30);

        if (!grammarIds.length && hsk === null) {
            return res.status(400).json({
                success: false,
                message: 'Chọn ít nhất một ngữ pháp hoặc một cấp HSK.',
            });
        }

        const rows = await grammarQuizModel.getQuestions({ grammarIds, hskLevel: hsk, limit });
        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Chưa có câu hỏi cho lựa chọn này.',
            });
        }

        const token = genSessionToken();
        quizSessions.set(token, {
            userId: req.user.userId,
            questions: rows.map(r => ({
                id: r.id,
                correctAnswer: r.correct_answer,
                grammarId: r.grammar_pattern_id,
                explanation: r.explanation || '',
                points: r.points || 1,
            })),
            answers: {},
            finished: false,
            expiresAt: Date.now() + SESSION_TTL_MS,
        });

        // Client-safe payload: NO correct_answer / explanation.
        const questions = rows.map(r => ({
            id: r.id,
            grammarPatternId: r.grammar_pattern_id,
            grammarPoint: r.grammar_point,
            hskLevel: r.hsk_level,
            questionType: r.question_type,
            questionText: r.question_text,
            options: r.options,
        }));

        return res.json({ success: true, data: { token, questions } });
    } catch (err) {
        console.error('grammarQuizStart error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi tạo phiên trắc nghiệm.' });
    }
}

async function grammarQuizAnswer(req, res) {
    try {
        const { token, questionId, choice } = req.body || {};
        if (!token || questionId === undefined || choice === undefined) {
            return res.status(400).json({ success: false, message: 'Thiếu token/questionId/choice.' });
        }

        const session = quizSessions.get(token);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Phiên đã hết hạn. Bắt đầu lại.' });
        }
        if (session.userId !== req.user.userId) {
            return res.status(403).json({ success: false, message: 'Không khớp người chơi.' });
        }
        if (session.expiresAt < Date.now()) {
            quizSessions.delete(token);
            return res.status(410).json({ success: false, message: 'Phiên đã hết hạn.' });
        }

        const qid = Number.parseInt(questionId, 10);
        const question = session.questions.find(q => q.id === qid);
        if (!question) {
            return res.status(400).json({ success: false, message: 'Câu hỏi không thuộc phiên này.' });
        }

        const correct = String(choice) === String(question.correctAnswer);
        session.answers[qid] = { correct, grammarId: question.grammarId };

        return res.json({
            success: true,
            data: { correct, correctAnswer: question.correctAnswer, explanation: question.explanation },
        });
    } catch (err) {
        console.error('grammarQuizAnswer error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi chấm câu trả lời.' });
    }
}

async function grammarQuizFinish(req, res) {
    try {
        const { token } = req.body || {};
        if (!token) {
            return res.status(400).json({ success: false, message: 'Thiếu token.' });
        }

        const session = quizSessions.get(token);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Phiên đã hết hạn.' });
        }
        if (session.userId !== req.user.userId) {
            return res.status(403).json({ success: false, message: 'Không khớp người chơi.' });
        }
        if (session.finished) {
            return res.status(410).json({ success: false, message: 'Phiên đã được tính rồi.' });
        }
        session.finished = true;

        const total = session.questions.length;
        const answered = Object.keys(session.answers).length;
        let correct = 0;
        const statsByGrammar = {};
        for (const ans of Object.values(session.answers)) {
            if (ans.correct) correct += 1;
            const g = statsByGrammar[ans.grammarId] || { seen: 0, correct: 0, wrong: 0 };
            g.seen += 1;
            if (ans.correct) g.correct += 1; else g.wrong += 1;
            statsByGrammar[ans.grammarId] = g;
        }
        const score = total > 0 ? Math.round((correct / total) * 100) : 0;

        let xpEarned = 0;
        try {
            await grammarQuizModel.upsertProgress(req.user.userId, statsByGrammar);
            await streakService.updateStreak(req.user.userId);
            xpEarned = await xpService.awardXp(req.user.userId, 'practice_grammar_quiz', {
                score,
                refType: 'grammar_quiz',
            });
        } catch (xpErr) {
            console.error('grammarQuizFinish progress/xp error:', xpErr.message);
        }

        quizSessions.delete(token);
        return res.json({ success: true, data: { total, answered, correct, score, xpEarned } });
    } catch (err) {
        console.error('grammarQuizFinish error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi hoàn tất phiên.' });
    }
}

module.exports = {
    getPracticeText,
    getMatchPairs,
    clearMatchPair,
    translatePrompt,
    translateGrade,
    writeComplete,
    grammarQuizStart,
    grammarQuizAnswer,
    grammarQuizFinish,
};
