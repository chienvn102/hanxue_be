/**
 * Vocabulary Model
 * Handles all database operations for vocabulary
 */

const db = require('../config/database');
const { normalizeAudioRef } = require('../services/audioUrl.service');

/**
 * Get paginated vocabulary list with optional filters
 */
async function getList({ hsk, q, theme, lesson, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;

    // theme filter requires JOIN; do it via subquery so frequency_rank ORDER still works
    const themeJoin = theme
        ? `JOIN vocabulary_theme_map vtm ON vtm.vocab_id = v.id
           JOIN vocabulary_themes vt ON vt.id = vtm.theme_id AND vt.slug = ?`
        : '';
    const lessonJoin = lesson
        ? 'JOIN lesson_vocabulary lv ON lv.vocabulary_id = v.id AND lv.lesson_id = ?'
        : '';

    let sql = `SELECT v.id, v.simplified, v.traditional, v.pinyin, v.han_viet,
                      v.meaning_vi, v.meaning_en, v.hsk_level, v.word_type,
                      v.audio_url, v.frequency_rank
               FROM vocabulary v
               ${themeJoin}
               ${lessonJoin}
               WHERE 1=1`;
    const params = [];
    if (theme) params.push(theme);
    if (lesson) params.push(parseInt(lesson, 10));

    if (hsk) {
        sql += ' AND v.hsk_level = ?';
        params.push(parseInt(hsk));
    }

    if (q) {
        sql += ` AND (v.simplified LIKE ? OR v.traditional LIKE ?
                 OR v.pinyin LIKE ? OR v.pinyin_no_tone LIKE ?
                 OR v.meaning_vi LIKE ? OR v.han_viet LIKE ?)`;
        const searchTerm = `%${q}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    sql += ' ORDER BY v.frequency_rank ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [rows] = await db.execute(sql, params);

    // Get total count (mirror filter set)
    let countSql = `SELECT COUNT(*) as total FROM vocabulary v ${themeJoin} ${lessonJoin} WHERE 1=1`;
    const countParams = [];
    if (theme) countParams.push(theme);
    if (lesson) countParams.push(parseInt(lesson, 10));

    if (hsk) {
        countSql += ' AND v.hsk_level = ?';
        countParams.push(parseInt(hsk));
    }

    if (q) {
        countSql += ` AND (v.simplified LIKE ? OR v.traditional LIKE ?
                     OR v.pinyin LIKE ? OR v.pinyin_no_tone LIKE ?
                     OR v.meaning_vi LIKE ? OR v.han_viet LIKE ?)`;
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
 * List all canonical themes (15 rows, ordered by sort_order).
 */
async function listThemes() {
    const [rows] = await db.execute(
        `SELECT id, slug, name_vi, name_en, icon, color, sort_order
         FROM vocabulary_themes ORDER BY sort_order ASC, id ASC`
    );
    return rows;
}

/**
 * Get themes assigned to a single vocab (for detail page badge).
 */
async function getThemesForVocab(vocabId) {
    const [rows] = await db.execute(
        `SELECT vt.id, vt.slug, vt.name_vi, vt.icon, vt.color
         FROM vocabulary_theme_map vtm
         JOIN vocabulary_themes vt ON vt.id = vtm.theme_id
         WHERE vtm.vocab_id = ?
         ORDER BY vt.sort_order ASC`,
        [vocabId]
    );
    return rows;
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
 * Tìm vocab theo simplified (sau khi trim). Dùng để pre-check duplicate
 * trước khi INSERT/UPDATE. Trả về row hoặc null.
 *   excludeId: bỏ qua bản ghi này (cho update — không tự coi mình là dup).
 */
async function findBySimplified(simplified, excludeId = null) {
    const trimmed = String(simplified || '').trim();
    if (!trimmed) return null;
    const sql = excludeId
        ? 'SELECT id, simplified, pinyin, hsk_level FROM vocabulary WHERE simplified = ? AND id <> ? LIMIT 1'
        : 'SELECT id, simplified, pinyin, hsk_level FROM vocabulary WHERE simplified = ? LIMIT 1';
    const params = excludeId ? [trimmed, excludeId] : [trimmed];
    const [rows] = await db.execute(sql, params);
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

    const trimmedSimplified = String(simplified || '').trim();

    const [result] = await db.execute(
        `INSERT INTO vocabulary
        (simplified, traditional, pinyin, pinyin_no_tone, han_viet, meaning_vi, meaning_en, hsk_level, word_type, audio_url, frequency_rank, examples)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            trimmedSimplified,
            traditional ? String(traditional).trim() : null,
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
            // Normalize: signed/public GCS URL → gs:// để khỏi vượt VARCHAR limit
            normalizeAudioRef(audio_url) || null,
            frequency_rank || 99999,
            examples && Array.isArray(examples) && examples.length > 0 ? JSON.stringify(examples) : null
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
            } else if (field === 'audio_url') {
                // Normalize signed URL → gs:// để khỏi vượt VARCHAR limit
                values.push(normalizeAudioRef(data[field]));
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

async function findNotMasteredByUser(userId, hskLevel, limit = 10) {
    const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 20);
    const [rows] = await db.execute(
        `SELECT v.id, v.simplified, v.pinyin, v.meaning_vi, v.hsk_level
           FROM vocabulary v
          WHERE v.hsk_level = ?
            AND NOT EXISTS (
                SELECT 1
                  FROM notebook_items ni
                  JOIN notebooks n ON n.id = ni.notebook_id
                 WHERE n.user_id = ?
                   AND ni.vocabulary_id = v.id
                   AND ni.mastery_level = 'mastered'
            )
          ORDER BY RAND()
          LIMIT ?`,
        [hskLevel, userId, cappedLimit]
    );
    return rows;
}

module.exports = {
    getList,
    getById,
    findBySimplified,
    searchFulltext,
    getWithExamples,
    create,
    update,
    deleteById,
    listThemes,
    getThemesForVocab,
    findNotMasteredByUser
};
