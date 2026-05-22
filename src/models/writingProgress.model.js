/**
 * writing_progress model.
 *
 * Pre-migration safety: every query swallows ER_NO_SUCH_TABLE and returns a
 * sane default. This means the endpoint stays callable before the operator
 * runs 021_writing_progress.sql.
 */

const db = require('../config/database');
const writingSrs = require('../services/writingSrs.service');

/**
 * Get progress rows for one user + a list of characters.
 * Missing rows are NOT auto-created here — the caller decides whether to seed.
 * @returns {Promise<Map<string, RowObj>>}
 */
async function findByCharacters(userId, chars) {
    if (!chars.length) return new Map();
    try {
        const placeholders = chars.map(() => '?').join(',');
        const [rows] = await db.execute(
            `SELECT id, \`character\`, current_stage, mastery_level,
                    ease_factor, interval_days, next_review_at,
                    total_attempts, total_mistakes, last_attempt_at
               FROM writing_progress
              WHERE user_id = ? AND \`character\` IN (${placeholders})`,
            [userId, ...chars]
        );
        return new Map(rows.map(r => [r.character, r]));
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return new Map();
        throw error;
    }
}

/**
 * Insert a fresh row at stage 1 if the (user, character) pair has none yet.
 * Returns the row (existing or newly created).
 */
async function ensureRow(userId, character) {
    try {
        await db.execute(
            `INSERT IGNORE INTO writing_progress (user_id, \`character\`, current_stage)
             VALUES (?, ?, 1)`,
            [userId, character]
        );
        const [rows] = await db.execute(
            `SELECT id, \`character\`, current_stage, mastery_level,
                    ease_factor, interval_days, next_review_at,
                    total_attempts, total_mistakes, last_attempt_at
               FROM writing_progress
              WHERE user_id = ? AND \`character\` = ?`,
            [userId, character]
        );
        return rows[0] || null;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return null;
        throw error;
    }
}

/**
 * Characters due for review (next_review_at <= NOW) — ordered by oldest first.
 */
async function findDue(userId, limit = 10) {
    const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    try {
        const [rows] = await db.execute(
            `SELECT \`character\`, current_stage, mastery_level, next_review_at,
                    interval_days, total_attempts, total_mistakes
               FROM writing_progress
              WHERE user_id = ?
                AND next_review_at IS NOT NULL
                AND next_review_at <= NOW()
              ORDER BY next_review_at ASC
              LIMIT ${safeLimit}`,
            [userId]
        );
        return rows;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return [];
        throw error;
    }
}

/**
 * Apply an attempt: compute new SRS state via service and UPDATE the row.
 * Always reads the row first (or creates it) so the SRS update is grounded.
 * @returns {Promise<{ before: RowObj|null, after: object, srs: object }>}
 */
async function recordAttempt(userId, character, { stage, mistakes, strokeCount }) {
    const row = await ensureRow(userId, character);
    if (!row) {
        // Table missing — synthesize a stateless answer so the route still works
        const srs = writingSrs.nextSrs(
            { currentStage: stage || 1, masteryLevel: 0, easeFactor: 2.5, intervalDays: 0 },
            { stage, mistakes, strokeCount }
        );
        return { before: null, after: { ...srs, character }, srs };
    }

    const srs = writingSrs.nextSrs(
        {
            currentStage: row.current_stage,
            masteryLevel: row.mastery_level,
            easeFactor: Number(row.ease_factor),
            intervalDays: row.interval_days,
        },
        { stage, mistakes, strokeCount }
    );

    await db.execute(
        `UPDATE writing_progress
            SET current_stage = ?,
                mastery_level = ?,
                ease_factor = ?,
                interval_days = ?,
                next_review_at = ?,
                total_attempts = total_attempts + 1,
                total_mistakes = total_mistakes + ?,
                last_attempt_at = NOW()
          WHERE id = ?`,
        [
            srs.currentStage,
            srs.masteryLevel,
            srs.easeFactor,
            srs.intervalDays,
            srs.nextReviewAt,
            mistakes,
            row.id,
        ]
    );

    return {
        before: row,
        after: {
            character,
            currentStage: srs.currentStage,
            masteryLevel: srs.masteryLevel,
            easeFactor: srs.easeFactor,
            intervalDays: srs.intervalDays,
            nextReviewAt: srs.nextReviewAt,
        },
        srs,
    };
}

module.exports = {
    findByCharacters,
    ensureRow,
    findDue,
    recordAttempt,
};
