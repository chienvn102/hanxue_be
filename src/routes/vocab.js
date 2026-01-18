const express = require('express');
const db = require('../config/database');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
