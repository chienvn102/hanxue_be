/**
 * Progress Model — flashcard accuracy tracking (post-HF4 SRS removal).
 */

const db = require('../config/database');

/**
 * Get new vocabulary the user has not started yet.
 */
async function getNewVocab(userId, { limit = 10, hsk }) {
    const wordLimit = Math.min(parseInt(limit) || 10, 50);
    const hskInt = Number.parseInt(hsk, 10);
    const hskValid = Number.isFinite(hskInt) && hskInt >= 1 && hskInt <= 6;

    let sql = `
        SELECT v.id, v.simplified, v.traditional, v.pinyin, v.han_viet,
               v.meaning_vi, v.meaning_en, v.hsk_level, v.audio_url
        FROM vocabulary v
        WHERE v.id NOT IN (
            SELECT vocabulary_id FROM user_vocabulary_progress WHERE user_id = ?
        )
        AND v.meaning_vi IS NOT NULL AND v.meaning_vi != ''
    `;
    const params = [userId];

    if (hskValid) {
        sql += ' AND v.hsk_level = ?';
        params.push(hskInt);
    }

    sql += ' ORDER BY v.frequency_rank ASC, v.hsk_level ASC LIMIT ?';
    params.push(wordLimit);

    const [rows] = await db.execute(sql, params);
    return rows;
}

/**
 * User overall + breakdown stats. KHÔNG có `due_today` (SRS removed).
 */
async function getStats(userId) {
    const [statsResult] = await db.execute(`
        SELECT
            COUNT(*) as total_learned,
            SUM(CASE WHEN mastery_level >= 3 THEN 1 ELSE 0 END) as mastered,
            AVG(mastery_level) as avg_mastery,
            SUM(times_seen) as total_reviews,
            SUM(times_correct) as total_correct
        FROM user_vocabulary_progress
        WHERE user_id = ?
    `, [userId]);

    const [masteryResult] = await db.execute(`
        SELECT mastery_level, COUNT(*) as count
        FROM user_vocabulary_progress
        WHERE user_id = ?
        GROUP BY mastery_level
        ORDER BY mastery_level
    `, [userId]);

    const [hskResult] = await db.execute(`
        SELECT v.hsk_level, COUNT(*) as count
        FROM user_vocabulary_progress p
        JOIN vocabulary v ON p.vocabulary_id = v.id
        WHERE p.user_id = ?
        GROUP BY v.hsk_level
        ORDER BY v.hsk_level
    `, [userId]);

    return {
        overall: statsResult[0],
        masteryDistribution: masteryResult,
        hskDistribution: hskResult
    };
}

async function vocabExists(vocabId) {
    const [rows] = await db.execute(
        'SELECT id FROM vocabulary WHERE id = ?',
        [vocabId]
    );
    return rows.length > 0;
}

async function getProgress(userId, vocabId) {
    const [rows] = await db.execute(
        'SELECT * FROM user_vocabulary_progress WHERE user_id = ? AND vocabulary_id = ?',
        [userId, vocabId]
    );
    return rows[0] || null;
}

async function getProgressWithVocab(userId, vocabId) {
    const [rows] = await db.execute(`
        SELECT p.*, v.simplified, v.pinyin, v.meaning_vi
        FROM user_vocabulary_progress p
        JOIN vocabulary v ON p.vocabulary_id = v.id
        WHERE p.user_id = ? AND p.vocabulary_id = ?
    `, [userId, vocabId]);
    return rows[0] || null;
}

/**
 * Insert first progress row. SRS columns (ease_factor / interval_days /
 * repetitions / next_review) giữ default DB để tương thích schema cũ.
 */
async function createProgress(userId, vocabId, { masteryLevel, isCorrect, responseMs }) {
    await db.execute(`
        INSERT INTO user_vocabulary_progress
        (user_id, vocabulary_id, mastery_level, times_seen, times_correct,
         times_wrong, avg_response_ms, last_reviewed)
        VALUES (?, ?, ?, 1, ?, ?, ?, NOW())
    `, [
        userId, vocabId,
        masteryLevel,
        isCorrect ? 1 : 0,
        isCorrect ? 0 : 1,
        responseMs
    ]);
}

async function updateProgress(userId, vocabId, { masteryLevel, isCorrect, avgResponseMs }) {
    await db.execute(`
        UPDATE user_vocabulary_progress SET
            mastery_level = ?,
            times_seen = times_seen + 1,
            times_correct = times_correct + ?,
            times_wrong = times_wrong + ?,
            avg_response_ms = ?,
            last_reviewed = NOW()
        WHERE user_id = ? AND vocabulary_id = ?
    `, [
        masteryLevel,
        isCorrect ? 1 : 0,
        isCorrect ? 0 : 1,
        avgResponseMs,
        userId, vocabId
    ]);
}

module.exports = {
    getNewVocab,
    getStats,
    vocabExists,
    getProgress,
    getProgressWithVocab,
    createProgress,
    updateProgress
};
