/**
 * Flashcard Model
 * Handles database operations for flashcard sessions
 */

const db = require('../config/database');

/**
 * Get random flashcards for study session
 */
async function getRandomFlashcards({ hsk, limit = 20 }) {
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

    sql += ' ORDER BY RAND() LIMIT ?';
    params.push(wordLimit);

    const [rows] = await db.execute(sql, params);
    return rows;
}

/**
 * Get wrong answer choices for multiple choice mode
 */
async function getChoices({ excludeIds = [], count = 3, hsk }) {
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
    return rows;
}

module.exports = {
    getRandomFlashcards,
    getChoices
};
