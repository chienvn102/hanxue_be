/**
 * Progress Controller
 * Tracks per-user vocabulary progress (times_seen / correct / wrong) + SRS
 * schedule (ease_factor / interval_days / repetitions / next_review) computed
 * via shared srs.service (SM-2 simplified). SRS due items are surfaced by
 * notificationScheduler for review reminders.
 */

const db = require('../config/database');
const ProgressModel = require('../models/progress.model');
const streakService = require('../services/streak.service');
const xpService = require('../services/xp.service');
const progressTracker = require('../services/progressTracker.service');

/**
 * Compute mastery_level (0–5) từ accuracy + total reviews. Đơn giản hoá thay
 * cho SM-2: càng nhiều lần đúng liên tiếp + accuracy cao thì mastery cao.
 */
function deriveMastery(timesSeen, timesCorrect) {
    if (timesSeen === 0) return 0;
    const acc = timesCorrect / timesSeen;
    if (timesSeen < 2) return 1;
    if (acc < 0.5) return 1;
    if (acc < 0.7) return 2;
    if (timesSeen < 5) return 3;
    if (acc < 0.85) return 3;
    if (timesSeen < 10) return 4;
    return 5;
}

/**
 * GET /api/progress/new
 */
async function getNew(req, res) {
    try {
        const userId = req.user.userId;
        const { limit = 10, hsk } = req.query;

        const rows = await ProgressModel.getNewVocab(userId, { limit, hsk });

        res.json({
            count: rows.length,
            data: rows.map(row => ({
                id: row.id,
                simplified: row.simplified,
                traditional: row.traditional,
                pinyin: row.pinyin,
                hanViet: row.han_viet,
                meaningVi: row.meaning_vi,
                meaningEn: row.meaning_en,
                hskLevel: row.hsk_level,
                audioUrl: row.audio_url
            }))
        });
    } catch (err) {
        console.error('Get new vocabulary error:', err);
        res.status(500).json({ error: 'Failed to get new vocabulary' });
    }
}

/**
 * GET /api/progress/stats — KHÔNG còn `dueToday` (SRS removed).
 */
async function getStats(req, res) {
    try {
        const userId = req.user.userId;
        const { overall, masteryDistribution, hskDistribution } = await ProgressModel.getStats(userId);

        const accuracy = overall.total_reviews > 0
            ? Math.round((overall.total_correct / overall.total_reviews) * 100)
            : 0;

        res.json({
            totalLearned: overall.total_learned || 0,
            mastered: overall.mastered || 0,
            avgMastery: Math.round((overall.avg_mastery || 0) * 10) / 10,
            totalReviews: overall.total_reviews || 0,
            accuracy: accuracy,
            masteryDistribution: masteryDistribution.reduce((acc, row) => {
                acc[row.mastery_level] = row.count;
                return acc;
            }, {}),
            hskDistribution: hskDistribution.reduce((acc, row) => {
                if (row.hsk_level) acc[row.hsk_level] = row.count;
                return acc;
            }, {})
        });
    } catch (err) {
        console.error('Get stats error:', err);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
}

/**
 * POST /api/progress/review — flashcard ghi nhận đúng/sai (no SRS).
 *
 * Body: { vocabId, quality (0–5), responseMs? }
 *   quality ≥ 3 → đếm là đúng; <3 → sai. (Giữ format quality 0–5 để tương
 *   thích FE flashcard cũ; sau này có thể đổi sang { correct: bool }.)
 */
async function submitReview(req, res) {
    try {
        const userId = req.user.userId;
        const { vocabId, quality, responseMs } = req.body;

        if (!vocabId || quality === undefined) {
            return res.status(400).json({ error: 'vocabId and quality are required' });
        }
        if (quality < 0 || quality > 5) {
            return res.status(400).json({ error: 'Quality must be between 0 and 5' });
        }

        const exists = await ProgressModel.vocabExists(vocabId);
        if (!exists) {
            return res.status(404).json({ error: 'Vocabulary not found' });
        }

        const isCorrect = quality >= 3;
        // Single sink — same UPSERT + SRS path that match/writing/translate use.
        await progressTracker.recordVocabAttempt(userId, vocabId, quality, {
            source: 'flashcard',
            responseMs: responseMs || null,
        });

        // Streak + XP (best-effort). Trả về xpEarned để FE không phải tự
        // tính lại (tránh drift giữa display và BE — bug HF4 review #2).
        let xpEarned = 0;
        try {
            await streakService.updateStreak(userId);
            xpEarned = isCorrect ? await xpService.awardXp(userId, 'flashcard_review', {
                quality,
                refId: vocabId,
                refType: 'vocabulary',
            }) : 0;
        } catch (streakErr) {
            console.error('Streak/XP update error:', streakErr);
        }

        res.json({
            success: true,
            vocabId,
            quality,
            correct: isCorrect,
            xpEarned,
        });
    } catch (err) {
        console.error('Submit review error:', err);
        res.status(500).json({ error: 'Failed to submit review' });
    }
}

/**
 * GET /api/progress/:vocabId
 */
async function getProgressById(req, res) {
    try {
        const userId = req.user.userId;
        const { vocabId } = req.params;

        const row = await ProgressModel.getProgressWithVocab(userId, vocabId);

        if (!row) {
            return res.json({ learned: false });
        }

        res.json({
            learned: true,
            vocabId: parseInt(vocabId),
            simplified: row.simplified,
            pinyin: row.pinyin,
            meaningVi: row.meaning_vi,
            progress: {
                masteryLevel: row.mastery_level,
                lastReviewed: row.last_reviewed,
                timesSeen: row.times_seen,
                timesCorrect: row.times_correct,
                timesWrong: row.times_wrong,
                avgResponseMs: row.avg_response_ms
            }
        });
    } catch (err) {
        console.error('Get progress error:', err);
        res.status(500).json({ error: 'Failed to get progress' });
    }
}

// Mục tiêu XP mỗi ngày cho panel "Mục tiêu hôm nay" (chỉnh qua env nếu cần).
// ~6-7 lần ôn đúng hoặc 2-3 bài học là đạt.
const DAILY_XP_GOAL = (() => {
    const n = parseInt(process.env.DAILY_XP_GOAL || '50', 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
})();

/**
 * GET /api/progress/today — số liệu hoạt động HÔM NAY cho panel "Mục tiêu hôm nay".
 * Mục tiêu theo XP (không phải phút). words_reviewed/words_learned được ghi tại
 * progressTracker.recordVocabAttempt. SRS đã gỡ (HF4) nên không có "due cards".
 */
async function getToday(req, res) {
    try {
        const userId = req.user.userId;
        const [rows] = await db.execute(
            `SELECT
                COALESCE(da.xp_earned, 0)       AS todayXp,
                COALESCE(da.words_reviewed, 0)  AS wordsReviewed,
                COALESCE(da.words_learned, 0)   AS wordsLearned,
                COALESCE(u.current_streak, 0)   AS currentStreak
             FROM users u
             LEFT JOIN daily_activity da
                 ON da.user_id = u.id AND da.activity_date = CURDATE()
             WHERE u.id = ?`,
            [userId]
        );

        const r = rows[0] || {};
        const todayXp = Number(r.todayXp) || 0;
        const dailyXpGoal = DAILY_XP_GOAL;
        const goalPercent = Math.min(100, Math.round((todayXp / dailyXpGoal) * 100));

        res.json({
            todayXp,
            wordsReviewed: Number(r.wordsReviewed) || 0,
            wordsLearned: Number(r.wordsLearned) || 0,
            currentStreak: Number(r.currentStreak) || 0,
            dailyXpGoal,
            goalPercent,
            goalMet: todayXp >= dailyXpGoal,
        });
    } catch (err) {
        console.error('Get today activity error:', err);
        res.status(500).json({ error: 'Failed to get today activity' });
    }
}

module.exports = {
    getNew,
    getStats,
    getToday,
    submitReview,
    getProgressById
};
