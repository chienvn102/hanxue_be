/**
 * Progress Model
 * Handles database operations for user vocabulary learning progress
 */

const db = require('../config/database');

/**
 * Get vocabulary due for review
 */
async function getDueVocab(userId, { limit = 20, hsk }) {
    const wordLimit = Math.min(parseInt(limit) || 20, 100);

    let sql = `
        SELECT 
            v.id, v.simplified, v.traditional, v.pinyin, v.han_viet,
            v.meaning_vi, v.meaning_en, v.hsk_level, v.audio_url,
            p.mastery_level, p.ease_factor, p.interval_days, 
            p.repetitions, p.next_review, p.times_seen, p.times_correct
        FROM user_vocabulary_progress p
        JOIN vocabulary v ON p.vocabulary_id = v.id
        WHERE p.user_id = ? 
          AND p.next_review <= NOW()
    `;
    const params = [userId];

    if (hsk) {
        sql += ' AND v.hsk_level = ?';
        params.push(parseInt(hsk));
    }

    sql += ' ORDER BY p.next_review ASC, p.mastery_level ASC LIMIT ?';
    params.push(wordLimit);

    const [rows] = await db.execute(sql, params);
    return rows;
}

/**
 * Get new vocabulary to learn
 */
async function getNewVocab(userId, { limit = 10, hsk }) {
    const wordLimit = Math.min(parseInt(limit) || 10, 50);

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

    if (hsk) {
        sql += ' AND v.hsk_level = ?';
        params.push(parseInt(hsk));
    }

    sql += ' ORDER BY v.frequency_rank ASC, v.hsk_level ASC LIMIT ?';
    params.push(wordLimit);

    const [rows] = await db.execute(sql, params);
    return rows;
}

/**
 * Get user learning statistics
 */
async function getStats(userId) {
    // Get overall stats
    const [statsResult] = await db.execute(`
        SELECT 
            COUNT(*) as total_learned,
            SUM(CASE WHEN mastery_level >= 3 THEN 1 ELSE 0 END) as mastered,
            SUM(CASE WHEN next_review <= NOW() THEN 1 ELSE 0 END) as due_today,
            AVG(mastery_level) as avg_mastery,
            SUM(times_seen) as total_reviews,
            SUM(times_correct) as total_correct
        FROM user_vocabulary_progress
        WHERE user_id = ?
    `, [userId]);

    // Get mastery distribution
    const [masteryResult] = await db.execute(`
        SELECT mastery_level, COUNT(*) as count
        FROM user_vocabulary_progress
        WHERE user_id = ?
        GROUP BY mastery_level
        ORDER BY mastery_level
    `, [userId]);

    // Get HSK level distribution
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

/**
 * Check if vocabulary exists
 */
async function vocabExists(vocabId) {
    const [rows] = await db.execute(
        'SELECT id FROM vocabulary WHERE id = ?',
        [vocabId]
    );
    return rows.length > 0;
}

/**
 * Get current progress for a vocab
 */
async function getProgress(userId, vocabId) {
    const [rows] = await db.execute(
        'SELECT * FROM user_vocabulary_progress WHERE user_id = ? AND vocabulary_id = ?',
        [userId, vocabId]
    );
    return rows[0] || null;
}

/**
 * Get progress with vocab details
 */
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
 * Insert new progress record
 */
async function createProgress(userId, vocabId, newValues, isCorrect, responseMs) {
    await db.execute(`
        INSERT INTO user_vocabulary_progress 
        (user_id, vocabulary_id, mastery_level, ease_factor, interval_days, 
         repetitions, next_review, times_seen, times_correct, times_wrong, 
         avg_response_ms, last_reviewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NOW())
    `, [
        userId, vocabId,
        newValues.mastery_level,
        newValues.ease_factor,
        newValues.interval_days,
        newValues.repetitions,
        newValues.next_review,
        isCorrect ? 1 : 0,
        isCorrect ? 0 : 1,
        responseMs || null
    ]);
}

/**
 * Update existing progress
 */
async function updateProgress(userId, vocabId, newValues, isCorrect, newAvgMs) {
    await db.execute(`
        UPDATE user_vocabulary_progress SET
            mastery_level = ?,
            ease_factor = ?,
            interval_days = ?,
            repetitions = ?,
            next_review = ?,
            times_seen = times_seen + 1,
            times_correct = times_correct + ?,
            times_wrong = times_wrong + ?,
            avg_response_ms = ?,
            last_reviewed = NOW()
        WHERE user_id = ? AND vocabulary_id = ?
    `, [
        newValues.mastery_level,
        newValues.ease_factor,
        newValues.interval_days,
        newValues.repetitions,
        newValues.next_review,
        isCorrect ? 1 : 0,
        isCorrect ? 0 : 1,
        newAvgMs,
        userId, vocabId
    ]);
}

module.exports = {
    getDueVocab,
    getNewVocab,
    getStats,
    vocabExists,
    getProgress,
    getProgressWithVocab,
    createProgress,
    updateProgress
};
