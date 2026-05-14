/**
 * Progress Controller
 * Tracks per-user vocabulary progress (times_seen / correct / wrong).
 *
 * SRS đã bị bỏ hoàn toàn (HF4.1). `submitReview` chỉ ghi nhận lượt đúng/sai
 * cho flashcard session — KHÔNG còn lên lịch ôn tập theo SM-2.
 */

const ProgressModel = require('../models/progress.model');
const streakService = require('../services/streak.service');
const xpService = require('../services/xp.service');

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
        const current = await ProgressModel.getProgress(userId, vocabId);

        if (!current) {
            const mastery = deriveMastery(1, isCorrect ? 1 : 0);
            await ProgressModel.createProgress(userId, vocabId, {
                masteryLevel: mastery,
                isCorrect,
                responseMs: responseMs || null
            });
        } else {
            const newSeen = (current.times_seen || 0) + 1;
            const newCorrect = (current.times_correct || 0) + (isCorrect ? 1 : 0);
            const newAvgMs = responseMs && current.avg_response_ms
                ? Math.round((current.avg_response_ms + responseMs) / 2)
                : (responseMs || current.avg_response_ms);

            await ProgressModel.updateProgress(userId, vocabId, {
                masteryLevel: deriveMastery(newSeen, newCorrect),
                isCorrect,
                avgResponseMs: newAvgMs
            });
        }

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

module.exports = {
    getNew,
    getStats,
    submitReview,
    getProgressById
};
