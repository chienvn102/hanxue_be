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
 * Insert first progress row. SRS payload (ease_factor / interval_days /
 * repetitions / next_review) is optional — caller computes via srs.service.
 */
async function createProgress(userId, vocabId, { masteryLevel, isCorrect, responseMs, srs }) {
    await db.execute(`
        INSERT INTO user_vocabulary_progress
        (user_id, vocabulary_id, mastery_level, times_seen, times_correct,
         times_wrong, avg_response_ms, last_reviewed,
         ease_factor, interval_days, repetitions, next_review)
        VALUES (?, ?, ?, 1, ?, ?, ?, NOW(), ?, ?, ?, ?)
    `, [
        userId, vocabId,
        masteryLevel,
        isCorrect ? 1 : 0,
        isCorrect ? 0 : 1,
        responseMs,
        srs?.ease_factor ?? 2.50,
        srs?.interval_days ?? 0,
        srs?.repetitions ?? 0,
        srs?.next_review_at ?? null,
    ]);
}

async function updateProgress(userId, vocabId, { masteryLevel, isCorrect, avgResponseMs, srs }) {
    await db.execute(`
        UPDATE user_vocabulary_progress SET
            mastery_level = ?,
            times_seen = times_seen + 1,
            times_correct = times_correct + ?,
            times_wrong = times_wrong + ?,
            avg_response_ms = ?,
            last_reviewed = NOW(),
            ease_factor = ?,
            interval_days = ?,
            repetitions = ?,
            next_review = ?
        WHERE user_id = ? AND vocabulary_id = ?
    `, [
        masteryLevel,
        isCorrect ? 1 : 0,
        isCorrect ? 0 : 1,
        avgResponseMs,
        srs?.ease_factor ?? 2.50,
        srs?.interval_days ?? 0,
        srs?.repetitions ?? 0,
        srs?.next_review_at ?? null,
        userId, vocabId
    ]);
}

async function getRecentMistakes(userId, days = 7) {
    const cappedDays = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
    const [rows] = await db.execute(
        `SELECT ua.question_id, ua.user_answer, q.correct_answer, q.question_text,
                q.question_type, e.hsk_level, ua.answered_at
           FROM hsk_user_answers ua
           JOIN hsk_exam_attempts a ON a.id = ua.attempt_id
           JOIN hsk_questions q ON q.id = ua.question_id
           JOIN hsk_sections s ON s.id = q.section_id
           JOIN hsk_exams e ON e.id = s.exam_id
          WHERE a.user_id = ?
            AND ua.is_correct = FALSE
            AND ua.answered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          ORDER BY ua.answered_at DESC
          LIMIT 20`,
        [userId, cappedDays]
    );
    return rows;
}

/**
 * Lay tu user da hoc nhung con yeu (hay sai, chua mastered). Chinh xac hon
 * findNotMasteredByUser vi chi lay tu user DA gap (times_seen > 0), khong lan
 * tu chua hoc. Dung de tiem vao chat prompt (小明 bam diem yeu cua user).
 */
async function getWeakVocab(userId, limit = 8) {
    const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);
    const [rows] = await db.execute(
        `SELECT v.simplified, v.pinyin, v.meaning_vi, p.times_wrong, p.mastery_level
           FROM user_vocabulary_progress p
           JOIN vocabulary v ON v.id = p.vocabulary_id
          WHERE p.user_id = ? AND p.mastery_level < 3 AND p.times_seen > 0
          ORDER BY p.times_wrong DESC, p.times_seen DESC
          LIMIT ?`,
        [userId, cappedLimit]
    );
    return rows;
}

module.exports = {
    getNewVocab,
    getStats,
    vocabExists,
    getProgress,
    getProgressWithVocab,
    createProgress,
    updateProgress,
    getRecentMistakes,
    getWeakVocab
};
