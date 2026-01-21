/**
 * Flashcard API Routes
 */

const express = require('express');
const db = require('../config/database');

const router = express.Router();

/**
 * @swagger
 * /api/flashcard:
 *   get:
 *     summary: Get flashcard session
 *     description: Get random vocabulary words for flashcard study session
 *     tags: [Flashcard]
 *     parameters:
 *       - in: query
 *         name: hsk
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 6
 *         description: Filter by HSK level
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of flashcards to return
 *     responses:
 *       200:
 *         description: Flashcard session data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   example: 20
 *                 flashcards:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Vocabulary'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
    try {
        const { hsk, limit = 20 } = req.query;
        const wordLimit = Math.min(parseInt(limit) || 20, 100);

        let sql = `
            SELECT id, simplified, traditional, pinyin, han_viet, 
                   meaning_vi, meaning_en, hsk_level
            FROM vocabulary 
            WHERE meaning_vi IS NOT NULL AND meaning_vi != ''
        `;
        const params = [];

        if (hsk) {
            sql += ' AND hsk_level = ?';
            params.push(parseInt(hsk));
        }

        // Random order
        sql += ' ORDER BY RAND() LIMIT ?';
        params.push(wordLimit);

        const [rows] = await db.execute(sql, params);

        // Format response
        const flashcards = rows.map(row => ({
            id: row.id,
            simplified: row.simplified,
            traditional: row.traditional,
            pinyin: row.pinyin,
            hanViet: row.han_viet,
            meaningVi: row.meaning_vi,
            meaningEn: row.meaning_en,
            hskLevel: row.hsk_level
        }));

        res.json({
            count: flashcards.length,
            flashcards
        });
    } catch (err) {
        console.error('Get flashcards error:', err);
        res.status(500).json({ error: 'Failed to get flashcards' });
    }
});

/**
 * GET /api/flashcard/choices
 * Get wrong answer choices for multiple choice mode
 * Query params:
 *   - exclude: Comma-separated IDs to exclude
 *   - count: Number of wrong answers (default 3)
 *   - hsk: HSK level to match difficulty
 */
router.get('/choices', async (req, res) => {
    try {
        const { exclude = '', count = 3, hsk } = req.query;
        const excludeIds = exclude.split(',').filter(Boolean).map(Number);
        const choiceCount = Math.min(parseInt(count) || 3, 10);

        let sql = `
            SELECT id, meaning_vi
            FROM vocabulary 
            WHERE meaning_vi IS NOT NULL AND meaning_vi != ''
        `;
        const params = [];

        if (excludeIds.length > 0) {
            sql += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
            params.push(...excludeIds);
        }

        if (hsk) {
            sql += ' AND hsk_level = ?';
            params.push(parseInt(hsk));
        }

        sql += ' ORDER BY RAND() LIMIT ?';
        params.push(choiceCount);

        const [rows] = await db.execute(sql, params);

        res.json({
            choices: rows.map(row => ({
                id: row.id,
                meaningVi: row.meaning_vi
            }))
        });
    } catch (err) {
        console.error('Get choices error:', err);
        res.status(500).json({ error: 'Failed to get choices' });
    }
});

module.exports = router;
