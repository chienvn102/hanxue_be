/**
 * Vocabulary Model
 * Handles all database operations for vocabulary
 */

const db = require('../config/database');

/**
 * Get paginated vocabulary list with optional filters
 */
async function getList({ hsk, q, page = 1, limit = 20 }) {
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

    return {
        rows,
        total: countResult[0].total
    };
}

/**
 * Get single vocabulary by ID
 */
async function getById(id) {
    const [rows] = await db.execute(
        'SELECT * FROM vocabulary WHERE id = ?',
        [id]
    );
    return rows[0] || null;
}

/**
 * Fulltext search vocabulary
 */
async function searchFulltext(query) {
    const [rows] = await db.execute(
        `SELECT id, simplified, traditional, pinyin, han_viet, 
                meaning_vi, hsk_level
         FROM vocabulary 
         WHERE MATCH(simplified, traditional, pinyin, meaning_vi, han_viet) 
         AGAINST(? IN NATURAL LANGUAGE MODE)
         LIMIT 20`,
        [query]
    );
    return rows;
}

/**
 * Get vocabulary with examples field
 */
async function getWithExamples(id) {
    const [rows] = await db.execute(
        'SELECT simplified, pinyin, meaning_vi, examples FROM vocabulary WHERE id = ?',
        [id]
    );
    return rows[0] || null;
}

module.exports = {
    getList,
    getById,
    searchFulltext,
    getWithExamples
};
