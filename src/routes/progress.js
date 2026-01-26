/**
 * Progress API Routes
 * Track user vocabulary learning progress with SRS (SM-2 algorithm)
 */

const express = require('express');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const srs = require('../services/srs');

const router = express.Router();

/**
 * @swagger
 * /api/progress/due:
 *   get:
 *     summary: Get vocabulary due for review
 *     description: Get list of vocabulary words that are due for review today based on SRS schedule
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Maximum number of words to return
 *       - in: query
 *         name: hsk
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 6
 *         description: Filter by HSK level
 *     responses:
 *       200:
 *         description: List of due vocabulary
 *       401:
 *         description: Unauthorized
 */
router.get('/due', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { limit = 20, hsk } = req.query;
        const wordLimit = Math.min(parseInt(limit) || 20, 100);

        let sql = `
            SELECT 
                v.id, v.simplified, v.traditional, v.pinyin, v.han_viet,
                v.meaning_vi, v.meaning_en, v.hsk_level, v.audio_url,
                p.mastery_level, p.ease_factor, p.interval_days, 
                p.repetitions, p.next_review, p.times_seen, p.times_correct
            FROM user_vocabulary_progress p
            JOIN vocabulary v ON p.vocabulary_id = v.id
            WHERE p.user_id = ? 
              AND p.next_review <= NOW()
        `;
        const params = [userId];

        if (hsk) {
            sql += ' AND v.hsk_level = ?';
            params.push(parseInt(hsk));
        }

        sql += ' ORDER BY p.next_review ASC, p.mastery_level ASC LIMIT ?';
        params.push(wordLimit);

        const [rows] = await db.execute(sql, params);

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
});

/**
 * @swagger
 * /api/progress/new:
 *   get:
 *     summary: Get new vocabulary to learn
 *     description: Get vocabulary that user hasn't started learning yet
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: hsk
 *         schema:
 *           type: integer
 */
router.get('/new', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { limit = 10, hsk } = req.query;
        const wordLimit = Math.min(parseInt(limit) || 10, 50);

        let sql = `
            SELECT v.id, v.simplified, v.traditional, v.pinyin, v.han_viet,
                   v.meaning_vi, v.meaning_en, v.hsk_level, v.audio_url
            FROM vocabulary v
            WHERE v.id NOT IN (
                SELECT vocabulary_id FROM user_vocabulary_progress WHERE user_id = ?
            )
            AND v.meaning_vi IS NOT NULL AND v.meaning_vi != ''
        `;
        const params = [userId];

        if (hsk) {
            sql += ' AND v.hsk_level = ?';
            params.push(parseInt(hsk));
        }

        sql += ' ORDER BY v.frequency_rank ASC, v.hsk_level ASC LIMIT ?';
        params.push(wordLimit);

        const [rows] = await db.execute(sql, params);

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
});

/**
 * @swagger
 * /api/progress/stats:
 *   get:
 *     summary: Get user learning statistics
 *     description: Get summary of user's vocabulary learning progress
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get overall stats
        const [statsResult] = await db.execute(`
            SELECT 
                COUNT(*) as total_learned,
                SUM(CASE WHEN mastery_level >= 3 THEN 1 ELSE 0 END) as mastered,
                SUM(CASE WHEN next_review <= NOW() THEN 1 ELSE 0 END) as due_today,
                AVG(mastery_level) as avg_mastery,
                SUM(times_seen) as total_reviews,
                SUM(times_correct) as total_correct
            FROM user_vocabulary_progress
            WHERE user_id = ?
        `, [userId]);

        // Get mastery distribution
        const [masteryResult] = await db.execute(`
            SELECT mastery_level, COUNT(*) as count
            FROM user_vocabulary_progress
            WHERE user_id = ?
            GROUP BY mastery_level
            ORDER BY mastery_level
        `, [userId]);

        // Get HSK level distribution
        const [hskResult] = await db.execute(`
            SELECT v.hsk_level, COUNT(*) as count
            FROM user_vocabulary_progress p
            JOIN vocabulary v ON p.vocabulary_id = v.id
            WHERE p.user_id = ?
            GROUP BY v.hsk_level
            ORDER BY v.hsk_level
        `, [userId]);

        const stats = statsResult[0];
        const accuracy = stats.total_reviews > 0
            ? Math.round((stats.total_correct / stats.total_reviews) * 100)
            : 0;

        res.json({
            totalLearned: stats.total_learned || 0,
            mastered: stats.mastered || 0,
            dueToday: stats.due_today || 0,
            avgMastery: Math.round((stats.avg_mastery || 0) * 10) / 10,
            totalReviews: stats.total_reviews || 0,
            accuracy: accuracy,
            masteryDistribution: masteryResult.reduce((acc, row) => {
                acc[row.mastery_level] = row.count;
                return acc;
            }, {}),
            hskDistribution: hskResult.reduce((acc, row) => {
                if (row.hsk_level) acc[row.hsk_level] = row.count;
                return acc;
            }, {})
        });
    } catch (err) {
        console.error('Get stats error:', err);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

/**
 * @swagger
 * /api/progress/review:
 *   post:
 *     summary: Submit vocabulary review result
 *     description: Record user's review of a vocabulary word and calculate next review date
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vocabId
 *               - quality
 *             properties:
 *               vocabId:
 *                 type: integer
 *                 description: Vocabulary ID
 *               quality:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 5
 *                 description: Quality rating (0-5)
 *               responseMs:
 *                 type: integer
 *                 description: Response time in milliseconds
 *     responses:
 *       200:
 *         description: Review recorded successfully
 */
router.post('/review', authMiddleware, async (req, res) => {
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
        const [vocabCheck] = await db.execute(
            'SELECT id FROM vocabulary WHERE id = ?',
            [vocabId]
        );
        if (vocabCheck.length === 0) {
            return res.status(404).json({ error: 'Vocabulary not found' });
        }

        // Get current progress (if exists)
        const [currentProgress] = await db.execute(
            'SELECT * FROM user_vocabulary_progress WHERE user_id = ? AND vocabulary_id = ?',
            [userId, vocabId]
        );

        // Calculate new SRS values
        const newValues = srs.calculateNextReview(
            quality,
            currentProgress.length > 0 ? currentProgress[0] : null
        );

        const isCorrect = quality >= 3 ? 1 : 0;

        if (currentProgress.length === 0) {
            // Insert new progress record
            await db.execute(`
                INSERT INTO user_vocabulary_progress 
                (user_id, vocabulary_id, mastery_level, ease_factor, interval_days, 
                 repetitions, next_review, times_seen, times_correct, times_wrong, 
                 avg_response_ms, last_reviewed)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NOW())
            `, [
                userId, vocabId,
                newValues.mastery_level,
                newValues.ease_factor,
                newValues.interval_days,
                newValues.repetitions,
                newValues.next_review,
                isCorrect,
                isCorrect ? 0 : 1,
                responseMs || null
            ]);
        } else {
            // Update existing progress
            const current = currentProgress[0];
            const newAvgMs = responseMs && current.avg_response_ms
                ? Math.round((current.avg_response_ms + responseMs) / 2)
                : responseMs || current.avg_response_ms;

            await db.execute(`
                UPDATE user_vocabulary_progress SET
                    mastery_level = ?,
                    ease_factor = ?,
                    interval_days = ?,
                    repetitions = ?,
                    next_review = ?,
                    times_seen = times_seen + 1,
                    times_correct = times_correct + ?,
                    times_wrong = times_wrong + ?,
                    avg_response_ms = ?,
                    last_reviewed = NOW()
                WHERE user_id = ? AND vocabulary_id = ?
            `, [
                newValues.mastery_level,
                newValues.ease_factor,
                newValues.interval_days,
                newValues.repetitions,
                newValues.next_review,
                isCorrect,
                isCorrect ? 0 : 1,
                newAvgMs,
                userId, vocabId
            ]);
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
});

/**
 * @swagger
 * /api/progress/{vocabId}:
 *   get:
 *     summary: Get progress for specific vocabulary
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:vocabId', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { vocabId } = req.params;

        const [rows] = await db.execute(`
            SELECT p.*, v.simplified, v.pinyin, v.meaning_vi
            FROM user_vocabulary_progress p
            JOIN vocabulary v ON p.vocabulary_id = v.id
            WHERE p.user_id = ? AND p.vocabulary_id = ?
        `, [userId, vocabId]);

        if (rows.length === 0) {
            return res.json({ learned: false });
        }

        const row = rows[0];
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
});

module.exports = router;
