/**
 * Character Controller
 * Handles HTTP request/response for character endpoints
 */

const CharacterModel = require('../models/character.model');

/**
 * Format character row to API response
 */
function formatCharacter(char) {
    return {
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
    };
}

/**
 * GET /api/characters/:hanzi
 */
async function getByHanzi(req, res) {
    try {
        const { hanzi } = req.params;
        const char = await CharacterModel.getByHanzi(hanzi);

        if (!char) {
            return res.status(404).json({ error: 'Character not found' });
        }

        res.json(formatCharacter(char));
    } catch (err) {
        console.error('Get character error:', err);
        res.status(500).json({ error: 'Failed to get character' });
    }
}

/**
 * GET /api/characters/:hanzi/stroke
 */
async function getStroke(req, res) {
    try {
        const { hanzi } = req.params;
        const char = await CharacterModel.getStrokeOrder(hanzi);

        if (!char) {
            return res.status(404).json({ error: 'Character not found' });
        }

        res.json({
            hanzi: char.hanzi,
            strokeCount: char.stroke_count,
            strokeOrder: char.stroke_order ? JSON.parse(char.stroke_order) : []
        });
    } catch (err) {
        console.error('Get stroke error:', err);
        res.status(500).json({ error: 'Failed to get stroke order' });
    }
}

/**
 * GET /api/characters/word/:word
 */
async function getByWord(req, res) {
    try {
        const { word } = req.params;
        const characters = [...word];

        if (characters.length === 0) {
            return res.status(400).json({ error: 'Word required' });
        }

        const rows = await CharacterModel.getByHanziList(characters);

        // Order by appearance in word
        const charMap = new Map(rows.map(r => [r.hanzi, r]));
        const result = characters.map(c => {
            const char = charMap.get(c);
            if (!char) return { hanzi: c, found: false };

            return {
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
                components: char.components ? JSON.parse(char.components) : [],
                found: true
            };
        });

        res.json({ characters: result });
    } catch (err) {
        console.error('Get word characters error:', err);
        res.status(500).json({ error: 'Failed to get characters' });
    }
}

module.exports = {
    getByHanzi,
    getStroke,
    getByWord
};
