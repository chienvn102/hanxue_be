const express = require('express');
const db = require('../config/database');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/vocab:
 *   get:
 *     summary: Get vocabulary list
 *     description: Retrieve a paginated list of vocabulary with optional filtering by HSK level and search query
 *     tags: [Vocabulary]
 *     parameters:
 *       - in: query
 *         name: hsk
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 6
 *         description: Filter by HSK level (1-6)
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query (searches in simplified, traditional, pinyin, meaning)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated vocabulary list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Vocabulary'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get vocabulary list
router.get('/', optionalAuth, async (req, res) => {
    try {
        const { hsk, q, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let sql = `SELECT id, simplified, traditional, pinyin, han_viet, 
                          meaning_vi, meaning_en, hsk_level, word_type, 
                          audio_url, frequency_rank
                   FROM vocabulary WHERE 1=1`;
        const params = [];

        if (hsk) {
            sql += ' AND hsk_level = ?';
            params.push(parseInt(hsk));
        }

        if (q) {
            sql += ` AND (simplified LIKE ? OR traditional LIKE ? 
                     OR pinyin LIKE ? OR pinyin_no_tone LIKE ? 
                     OR meaning_vi LIKE ? OR han_viet LIKE ?)`;
            const searchTerm = `%${q}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        sql += ' ORDER BY frequency_rank ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const [rows] = await db.execute(sql, params);

        // Get total count
        let countSql = 'SELECT COUNT(*) as total FROM vocabulary WHERE 1=1';
        const countParams = [];

        if (hsk) {
            countSql += ' AND hsk_level = ?';
            countParams.push(parseInt(hsk));
        }

        if (q) {
            countSql += ` AND (simplified LIKE ? OR traditional LIKE ? 
                         OR pinyin LIKE ? OR pinyin_no_tone LIKE ?
                         OR meaning_vi LIKE ? OR han_viet LIKE ?)`;
            const searchTerm = `%${q}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        const [countResult] = await db.execute(countSql, countParams);

        res.json({
            data: rows.map(row => ({
                id: row.id,
                simplified: row.simplified,
                traditional: row.traditional,
                pinyin: row.pinyin,
                hanViet: row.han_viet,
                meaningVi: row.meaning_vi,
                meaningEn: row.meaning_en,
                hskLevel: row.hsk_level,
                wordType: row.word_type,
                audioUrl: row.audio_url,
                frequencyRank: row.frequency_rank
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total,
                totalPages: Math.ceil(countResult[0].total / limit)
            }
        });
    } catch (err) {
        console.error('Get vocab error:', err);
        res.status(500).json({ error: 'Failed to get vocabulary' });
    }
});

/**
 * @swagger
 * /api/vocab/{id}:
 *   get:
 *     summary: Get vocabulary by ID
 *     description: Retrieve detailed information about a single vocabulary word
 *     tags: [Vocabulary]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Vocabulary ID
 *     responses:
 *       200:
 *         description: Vocabulary details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Vocabulary'
 *       404:
 *         description: Vocabulary not found
 *       500:
 *         description: Server error
 */
// Get single vocabulary
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT * FROM vocabulary WHERE id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Vocabulary not found' });
        }

        const row = rows[0];
        res.json({
            id: row.id,
            simplified: row.simplified,
            traditional: row.traditional,
            pinyin: row.pinyin,
            hanViet: row.han_viet,
            meaningVi: row.meaning_vi,
            meaningEn: row.meaning_en,
            hskLevel: row.hsk_level,
            wordType: row.word_type,
            audioUrl: row.audio_url,
            frequencyRank: row.frequency_rank,
            examples: row.examples ? JSON.parse(row.examples) : []
        });
    } catch (err) {
        console.error('Get vocab by id error:', err);
        res.status(500).json({ error: 'Failed to get vocabulary' });
    }
});

// Search vocabulary (fulltext)
router.get('/search/fulltext', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 1) {
            return res.status(400).json({ error: 'Query required' });
        }

        const [rows] = await db.execute(
            `SELECT id, simplified, traditional, pinyin, han_viet, 
                    meaning_vi, hsk_level
             FROM vocabulary 
             WHERE MATCH(simplified, traditional, pinyin, meaning_vi, han_viet) 
             AGAINST(? IN NATURAL LANGUAGE MODE)
             LIMIT 20`,
            [q]
        );

        res.json({
            data: rows.map(row => ({
                id: row.id,
                simplified: row.simplified,
                traditional: row.traditional,
                pinyin: row.pinyin,
                hanViet: row.han_viet,
                meaningVi: row.meaning_vi,
                hskLevel: row.hsk_level
            }))
        });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get examples for vocabulary (with AI fallback)
router.get('/:id/examples', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT simplified, pinyin, meaning_vi, examples FROM vocabulary WHERE id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Vocabulary not found' });
        }

        const vocab = rows[0];
        let examples = [];
        let source = 'database';

        // Check if we have examples in DB
        if (vocab.examples) {
            try {
                examples = JSON.parse(vocab.examples);
                if (Array.isArray(examples) && examples.length > 0) {
                    return res.json({ source, examples });
                }
            } catch (e) {
                // Invalid JSON, continue to AI generation
            }
        }

        // No examples in DB, generate with AI
        try {
            const gemini = require('../services/gemini');
            examples = await gemini.generateExamples(
                vocab.simplified,
                vocab.pinyin,
                vocab.meaning_vi
            );
            source = 'ai';
        } catch (aiError) {
            console.error('AI generation failed:', aiError.message);
            examples = [];
            source = 'none';
        }

        res.json({ source, examples });
    } catch (err) {
        console.error('Get examples error:', err);
        res.status(500).json({ error: 'Failed to get examples' });
    }
});

module.exports = router;

