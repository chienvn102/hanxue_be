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

/**
 * Create new vocabulary
 */
async function create(data) {
    const {
        simplified, traditional, pinyin, pinyin_no_tone,
        han_viet, meaning_vi, meaning_en, hsk_level,
        word_type, audio_url, frequency_rank, examples
    } = data;

    const [result] = await db.execute(
        `INSERT INTO vocabulary 
        (simplified, traditional, pinyin, pinyin_no_tone, han_viet, meaning_vi, meaning_en, hsk_level, word_type, audio_url, frequency_rank, examples)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            simplified,
            traditional || null,
            pinyin,
            pinyin_no_tone || pinyin?.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, c =>
                'āáǎà'.includes(c) ? 'a' : 'ēéěè'.includes(c) ? 'e' : 'īíǐì'.includes(c) ? 'i' :
                    'ōóǒò'.includes(c) ? 'o' : 'ūúǔù'.includes(c) ? 'u' : 'ǖǘǚǜ'.includes(c) ? 'v' : c
            ) || null,
            han_viet || null,
            meaning_vi,
            meaning_en || null,
            hsk_level || 1,
            word_type || null,
            audio_url || null,
            frequency_rank || 99999,
            examples ? JSON.stringify(examples) : null
        ]
    );
    return result.insertId;
}

/**
 * Update vocabulary by ID
 */
async function update(id, data) {
    const allowedFields = [
        'simplified', 'traditional', 'pinyin', 'pinyin_no_tone',
        'han_viet', 'meaning_vi', 'meaning_en', 'hsk_level',
        'word_type', 'audio_url', 'frequency_rank', 'examples'
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            if (field === 'examples' && typeof data[field] === 'object') {
                values.push(JSON.stringify(data[field]));
            } else {
                values.push(data[field]);
            }
        }
    }

    if (updates.length === 0) return 0;

    values.push(id);
    const [result] = await db.execute(
        `UPDATE vocabulary SET ${updates.join(', ')} WHERE id = ?`,
        values
    );
    return result.affectedRows;
}

/**
 * Delete vocabulary by ID (hard delete)
 */
async function deleteById(id) {
    const [result] = await db.execute(
        'DELETE FROM vocabulary WHERE id = ?',
        [id]
    );
    return result.affectedRows;
}

module.exports = {
    getList,
    getById,
    searchFulltext,
    getWithExamples,
    create,
    update,
    deleteById
};
