/**
 * Flashcard Controller
 * Handles HTTP request/response for flashcard endpoints
 */

const FlashcardModel = require('../models/flashcard.model');

/**
 * GET /api/flashcard
 * Get random flashcards for study session
 */
async function getSession(req, res) {
    try {
        const { hsk, limit = 20 } = req.query;

        const rows = await FlashcardModel.getRandomFlashcards({
            hsk,
            limit: parseInt(limit)
        });

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
}

/**
 * GET /api/flashcard/choices
 * Get wrong answer choices for multiple choice mode
 */
async function getChoices(req, res) {
    try {
        const { exclude = '', count = 3, hsk } = req.query;
        const excludeIds = exclude.split(',').filter(Boolean).map(Number);

        const rows = await FlashcardModel.getChoices({
            excludeIds,
            count: parseInt(count),
            hsk
        });

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
}

module.exports = {
    getSession,
    getChoices
};
