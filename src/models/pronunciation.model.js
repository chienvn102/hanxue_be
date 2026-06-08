/**
 * Pronunciation Lab DAO — tracks per-attempt history and SRS state per syllable.
 *
 * Tables (created in migration 028):
 *   - pronunciation_attempts
 *   - pronunciation_srs
 *   - minimal_pairs
 */

const db = require('../config/database');

async function logAttempt({
    userId,
    drillType,
    syllable,
    pinyinWithTone = null,
    referenceAudioUrl = null,
    userAudioUrl = null,
    score = null,
    isCorrect = null,
    details = null,
}) {
    await db.execute(
        `INSERT INTO pronunciation_attempts
            (user_id, drill_type, syllable, pinyin_with_tone, reference_audio_url,
             user_audio_url, score, is_correct, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            drillType,
            syllable,
            pinyinWithTone,
            referenceAudioUrl,
            userAudioUrl,
            score,
            isCorrect === null ? null : (isCorrect ? 1 : 0),
            details ? JSON.stringify(details).slice(0, 60000) : null,
        ]
    );
}

async function getSrs(userId, syllable) {
    const [rows] = await db.execute(
        'SELECT * FROM pronunciation_srs WHERE user_id = ? AND syllable = ?',
        [userId, syllable]
    );
    return rows[0] || null;
}

async function upsertSrs(userId, syllable, {
    isCorrect,
    score = null,
    srs,                              // result from srs.service.nextSrs
}) {
    const correctDelta = isCorrect ? 1 : 0;
    const scoreNum = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
    await db.execute(
        `INSERT INTO pronunciation_srs
            (user_id, syllable, times_seen, times_correct, best_score,
             ease_factor, interval_days, repetitions, next_review, last_reviewed)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
            times_seen = times_seen + 1,
            times_correct = times_correct + VALUES(times_correct),
            best_score = GREATEST(best_score, VALUES(best_score)),
            ease_factor = VALUES(ease_factor),
            interval_days = VALUES(interval_days),
            repetitions = VALUES(repetitions),
            next_review = VALUES(next_review),
            last_reviewed = NOW()`,
        [
            userId,
            syllable,
            correctDelta,
            scoreNum,
            srs?.ease_factor ?? 2.50,
            srs?.interval_days ?? 0,
            srs?.repetitions ?? 0,
            srs?.next_review_at ?? null,
        ]
    );
}

async function getDueSyllables(userId, limit = 20) {
    const capped = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const [rows] = await db.execute(
        `SELECT syllable, times_seen, times_correct, best_score,
                interval_days, repetitions, next_review, last_reviewed
           FROM pronunciation_srs
          WHERE user_id = ?
            AND (next_review IS NULL OR next_review <= NOW())
          ORDER BY COALESCE(next_review, '1970-01-01') ASC, last_reviewed DESC
          LIMIT ?`,
        [userId, capped]
    );
    return rows;
}

async function getMinimalPairs({ level, limit = 30 } = {}) {
    const capped = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const params = [];
    let sql = `SELECT id, group_label, syllable_a, syllable_b, char_a, char_b,
                       audio_a, audio_b, difficulty, hint_vi
                  FROM minimal_pairs
                 WHERE is_active = 1`;
    if (Number.isFinite(Number(level))) {
        sql += ' AND difficulty <= ?';
        params.push(Number(level));
    }
    sql += ' ORDER BY RAND() LIMIT ?';
    params.push(capped);
    const [rows] = await db.execute(sql, params);
    return rows;
}

async function getMinimalPair(id) {
    const [rows] = await db.execute(
        `SELECT id, group_label, syllable_a, syllable_b, char_a, char_b,
                audio_a, audio_b, difficulty, hint_vi
           FROM minimal_pairs WHERE id = ? AND is_active = 1`,
        [id]
    );
    return rows[0] || null;
}

async function getUserStats(userId) {
    const [overall] = await db.execute(
        `SELECT COUNT(*) AS total_syllables,
                SUM(CASE WHEN best_score >= 80 THEN 1 ELSE 0 END) AS mastered,
                AVG(best_score) AS avg_best_score
           FROM pronunciation_srs WHERE user_id = ?`,
        [userId]
    );
    const [byDrill] = await db.execute(
        `SELECT drill_type, COUNT(*) AS attempts,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
                AVG(score) AS avg_score
           FROM pronunciation_attempts
          WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY drill_type`,
        [userId]
    );
    return { overall: overall[0] || {}, byDrill };
}

module.exports = {
    logAttempt,
    getSrs,
    upsertSrs,
    getDueSyllables,
    getMinimalPairs,
    getMinimalPair,
    getUserStats,
};
