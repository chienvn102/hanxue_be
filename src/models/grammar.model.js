/**
 * Grammar Model
 * Handles database operations for grammar patterns
 */

const db = require('../config/database');

/**
 * Get paginated grammar list with optional filters
 */
async function getList({ hsk, q, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;

    let sql = `SELECT id, pattern, pattern_pinyin, pattern_formula, 
                      grammar_point, explanation, examples, hsk_level, 
                      audio_url, created_at
               FROM grammar_patterns WHERE 1=1`;
    const params = [];

    if (hsk) {
        sql += ' AND hsk_level = ?';
        params.push(parseInt(hsk));
    }

    if (q) {
        sql += ` AND (grammar_point LIKE ? OR pattern_formula LIKE ? OR explanation LIKE ?)`;
        const searchTerm = `%${q}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ' ORDER BY hsk_level ASC, id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [rows] = await db.execute(sql, params);

    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM grammar_patterns WHERE 1=1';
    const countParams = [];

    if (hsk) {
        countSql += ' AND hsk_level = ?';
        countParams.push(parseInt(hsk));
    }

    if (q) {
        countSql += ` AND (grammar_point LIKE ? OR pattern_formula LIKE ? OR explanation LIKE ?)`;
        const searchTerm = `%${q}%`;
        countParams.push(searchTerm, searchTerm, searchTerm);
    }

    const [countResult] = await db.execute(countSql, countParams);

    return {
        rows,
        total: countResult[0].total
    };
}

/**
 * Get single grammar by ID
 */
async function getById(id) {
    const [rows] = await db.execute(
        'SELECT * FROM grammar_patterns WHERE id = ?',
        [id]
    );
    return rows[0] || null;
}

/**
 * Create new grammar pattern
 */
async function create(data) {
    const {
        pattern, pattern_pinyin, pattern_formula,
        grammar_point, explanation, examples,
        hsk_level, audio_url
    } = data;

    const [result] = await db.execute(
        `INSERT INTO grammar_patterns 
        (pattern, pattern_pinyin, pattern_formula, grammar_point, explanation, examples, hsk_level, audio_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            typeof pattern === 'string' ? pattern : JSON.stringify(pattern),
            pattern_pinyin ? (typeof pattern_pinyin === 'string' ? pattern_pinyin : JSON.stringify(pattern_pinyin)) : null,
            pattern_formula || null,
            grammar_point,
            explanation,
            examples ? (typeof examples === 'string' ? examples : JSON.stringify(examples)) : null,
            hsk_level || 1,
            audio_url || null
        ]
    );
    return result.insertId;
}

/**
 * Update grammar pattern by ID
 */
async function update(id, data) {
    const allowedFields = [
        'pattern', 'pattern_pinyin', 'pattern_formula',
        'grammar_point', 'explanation', 'examples',
        'hsk_level', 'audio_url'
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            // Handle JSON fields
            if (['pattern', 'pattern_pinyin', 'examples'].includes(field) && typeof data[field] === 'object') {
                values.push(JSON.stringify(data[field]));
            } else {
                values.push(data[field]);
            }
        }
    }

    if (updates.length === 0) return 0;

    values.push(id);
    const [result] = await db.execute(
        `UPDATE grammar_patterns SET ${updates.join(', ')} WHERE id = ?`,
        values
    );
    return result.affectedRows;
}

/**
 * Delete grammar pattern by ID
 */
async function deleteById(id) {
    const [result] = await db.execute(
        'DELETE FROM grammar_patterns WHERE id = ?',
        [id]
    );
    return result.affectedRows;
}

/**
 * Get grammar patterns linked to a lesson
 */
async function getByLessonId(lessonId) {
    const [rows] = await db.execute(
        `SELECT gp.*, lg.order_index
         FROM grammar_patterns gp
         JOIN lesson_grammar lg ON gp.id = lg.grammar_pattern_id
         WHERE lg.lesson_id = ?
         ORDER BY lg.order_index ASC`,
        [lessonId]
    );
    return rows;
}

module.exports = {
    getList,
    getById,
    create,
    update,
    deleteById,
    getByLessonId
};
