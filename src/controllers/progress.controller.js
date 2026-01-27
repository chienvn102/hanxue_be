/**
 * Progress Controller
 * Handles HTTP request/response for user vocabulary learning progress
 */

const ProgressModel = require('../models/progress.model');
const srs = require('../services/srs');
const streakService = require('../services/streak.service');

/**
 * GET /api/progress/due
 */
async function getDue(req, res) {
    try {
        const userId = req.user.userId;
        const { limit = 20, hsk } = req.query;

        const rows = await ProgressModel.getDueVocab(userId, { limit, hsk });

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
                audioUrl: row.audio_url,
                progress: {
                    masteryLevel: row.mastery_level,
                    easeFactor: parseFloat(row.ease_factor),
                    intervalDays: row.interval_days,
                    repetitions: row.repetitions,
                    nextReview: row.next_review,
                    timesSeen: row.times_seen,
                    timesCorrect: row.times_correct
                }
            }))
        });
    } catch (err) {
        console.error('Get due vocabulary error:', err);
        res.status(500).json({ error: 'Failed to get due vocabulary' });
    }
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
 * GET /api/progress/stats
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
            dueToday: overall.due_today || 0,
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
 * POST /api/progress/review
 */
async function submitReview(req, res) {
    try {
        const userId = req.user.userId;
        const { vocabId, quality, responseMs } = req.body;

        // Validate input
        if (!vocabId || quality === undefined) {
            return res.status(400).json({ error: 'vocabId and quality are required' });
        }

        if (quality < 0 || quality > 5) {
            return res.status(400).json({ error: 'Quality must be between 0 and 5' });
        }

        // Check if vocabulary exists
        const exists = await ProgressModel.vocabExists(vocabId);
        if (!exists) {
            return res.status(404).json({ error: 'Vocabulary not found' });
        }

        // Get current progress (if exists)
        const currentProgress = await ProgressModel.getProgress(userId, vocabId);

        // Calculate new SRS values
        const newValues = srs.calculateNextReview(quality, currentProgress);
        const isCorrect = quality >= 3;

        if (!currentProgress) {
            // Insert new progress record
            await ProgressModel.createProgress(userId, vocabId, newValues, isCorrect, responseMs);
        } else {
            // Update existing progress
            const newAvgMs = responseMs && currentProgress.avg_response_ms
                ? Math.round((currentProgress.avg_response_ms + responseMs) / 2)
                : responseMs || currentProgress.avg_response_ms;

            await ProgressModel.updateProgress(userId, vocabId, newValues, isCorrect, newAvgMs);
        }

        // Update streak and XP after successful review
        try {
            await streakService.updateStreak(userId);
            const xp = streakService.calculateXP(quality);
            if (xp > 0) {
                await streakService.addXP(userId, xp);
            }
        } catch (streakErr) {
            // Log but don't fail the review
            console.error('Streak/XP update error:', streakErr);
        }

        res.json({
            success: true,
            vocabId: vocabId,
            quality: quality,
            qualityDescription: srs.getQualityDescription(quality),
            newProgress: {
                masteryLevel: newValues.mastery_level,
                easeFactor: newValues.ease_factor,
                intervalDays: newValues.interval_days,
                repetitions: newValues.repetitions,
                nextReview: newValues.next_review
            }
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
                easeFactor: parseFloat(row.ease_factor),
                intervalDays: row.interval_days,
                repetitions: row.repetitions,
                nextReview: row.next_review,
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
    getDue,
    getNew,
    getStats,
    submitReview,
    getProgressById
};
