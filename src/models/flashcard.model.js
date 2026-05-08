/**
 * Flashcard Model
 * Handles database operations for flashcard sessions
 */

const db = require('../config/database');

/**
 * Parse the `hsk` query param into a clean int 1..6, or null if invalid/missing.
 * (Empty string, "abc", "0", "99" all become null → no filter applied.)
 */
function normalizeHsk(hsk) {
    if (hsk === undefined || hsk === null || hsk === '') return null;
    const n = Number.parseInt(hsk, 10);
    if (!Number.isFinite(n) || n < 1 || n > 6) return null;
    return n;
}

/**
 * Get random flashcards for study session
 */
async function getRandomFlashcards({ hsk, limit = 20 }) {
    const wordLimit = Math.min(parseInt(limit) || 20, 100);
    const hskInt = normalizeHsk(hsk);

    let sql = `
        SELECT id, simplified, traditional, pinyin, han_viet,
               meaning_vi, meaning_en, hsk_level
        FROM vocabulary
        WHERE meaning_vi IS NOT NULL AND meaning_vi != ''
    `;
    const params = [];

    if (hskInt !== null) {
        sql += ' AND hsk_level = ?';
        params.push(hskInt);
    }

    sql += ' ORDER BY RAND() LIMIT ?';
    params.push(wordLimit);

    const [rows] = await db.execute(sql, params);
    return rows;
}

/**
 * Get wrong answer choices for multiple choice mode.
 * Distractors filtered to cùng HSK level → tránh hiển thị HSK 5 trong list HSK 1.
 */
async function getChoices({ excludeIds = [], count = 3, hsk }) {
    const choiceCount = Math.min(parseInt(count) || 3, 10);
    const hskInt = normalizeHsk(hsk);

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

    if (hskInt !== null) {
        sql += ' AND hsk_level = ?';
        params.push(hskInt);
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
