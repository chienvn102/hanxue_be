const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Get character by hanzi
router.get('/:hanzi', async (req, res) => {
    try {
        const { hanzi } = req.params;

        const [rows] = await db.execute(
            `SELECT * FROM characters WHERE hanzi = ?`,
            [hanzi]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Character not found' });
        }

        const char = rows[0];
        res.json({
            id: char.id,
            hanzi: char.hanzi,
            pinyinMain: char.pinyin_main,
            pinyinVariants: char.pinyin_variants ? JSON.parse(char.pinyin_variants) : [],
            hanViet: char.han_viet,
            meaningVi: char.meaning_vi,
            meaningEn: char.meaning_en,
            strokeCount: char.stroke_count,
            strokeOrder: char.stroke_order ? JSON.parse(char.stroke_order) : [],
            radical: char.radical,
            radicalMeaning: char.radical_meaning,
            components: char.components ? JSON.parse(char.components) : [],
            decomposition: char.decomposition,
            hskLevel: char.hsk_level,
            frequencyRank: char.frequency_rank,
            mnemonicsVi: char.mnemonics_vi
        });
    } catch (err) {
        console.error('Get character error:', err);
        res.status(500).json({ error: 'Failed to get character' });
    }
});

// Get stroke order only
router.get('/:hanzi/stroke', async (req, res) => {
    try {
        const { hanzi } = req.params;

        const [rows] = await db.execute(
            `SELECT hanzi, stroke_count, stroke_order FROM characters WHERE hanzi = ?`,
            [hanzi]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Character not found' });
        }

        const char = rows[0];
        res.json({
            hanzi: char.hanzi,
            strokeCount: char.stroke_count,
            strokeOrder: char.stroke_order ? JSON.parse(char.stroke_order) : []
        });
    } catch (err) {
        console.error('Get stroke error:', err);
        res.status(500).json({ error: 'Failed to get stroke order' });
    }
});

// Get characters by word
router.get('/word/:word', async (req, res) => {
    try {
        const { word } = req.params;
        const characters = [...word];

        if (characters.length === 0) {
            return res.status(400).json({ error: 'Word required' });
        }

        const placeholders = characters.map(() => '?').join(',');
        const [rows] = await db.execute(
            `SELECT * FROM characters WHERE hanzi IN (${placeholders})`,
            characters
        );

        // Order by appearance in word
        const charMap = new Map(rows.map(r => [r.hanzi, r]));
        const result = characters.map(c => {
            const char = charMap.get(c);
            if (!char) return { hanzi: c, found: false };

            return {
                hanzi: char.hanzi,
                pinyinMain: char.pinyin_main,
                hanViet: char.han_viet,
                meaningVi: char.meaning_vi,
                strokeCount: char.stroke_count,
                radical: char.radical,
                found: true
            };
        });

        res.json({ characters: result });
    } catch (err) {
        console.error('Get word characters error:', err);
        res.status(500).json({ error: 'Failed to get characters' });
    }
});

module.exports = router;
