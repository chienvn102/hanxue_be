/**
 * Grammar Quiz Model
 * Reads seeded MCQ questions (grammar_quiz_questions) and tracks per-user
 * grammar mastery (user_grammar_progress). Source-of-truth for grammar
 * practice progress that later feeds weak-point context to the AI tutor.
 */

const db = require('../config/database');
const { nextSrs } = require('../services/srs.service');

function safeParseOptions(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

const GrammarQuiz = {
    /**
     * Pull random questions filtered by grammar ids and/or HSK level.
     * - Mix multiple grammars  => grammarIds: [1,2,3]
     * - Filter by level        => hskLevel: 2
     * Returns rows INCLUDING correct_answer/explanation (server-side only).
     */
    getQuestions: async ({ grammarIds = [], hskLevel = null, limit = 10 } = {}) => {
        const cleanIds = [...new Set((grammarIds || []).map(Number).filter(Number.isFinite))];
        const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 30);

        let sql = `
            SELECT q.id, q.grammar_pattern_id, q.hsk_level, q.question_type,
                   q.question_text, q.options, q.correct_answer, q.explanation, q.points,
                   g.grammar_point
              FROM grammar_quiz_questions q
              JOIN grammar_patterns g ON g.id = q.grammar_pattern_id
             WHERE 1=1`;
        const params = [];

        if (cleanIds.length) {
            sql += ` AND q.grammar_pattern_id IN (${cleanIds.map(() => '?').join(',')})`;
            params.push(...cleanIds);
        }
        const hsk = hskLevel === null || hskLevel === undefined || hskLevel === ''
            ? null
            : parseInt(hskLevel, 10);
        if (Number.isFinite(hsk) && hsk >= 1 && hsk <= 6) {
            sql += ' AND q.hsk_level = ?';
            params.push(hsk);
        }

        sql += ' ORDER BY RAND() LIMIT ?';
        params.push(cappedLimit);

        const [rows] = await db.execute(sql, params);
        return rows.map(r => ({ ...r, options: safeParseOptions(r.options) }));
    },

    /**
     * UPSERT per-grammar progress after a finished session.
     * statsByGrammar: { [grammarPatternId]: { seen, correct, wrong } }
     * mastery_level bumps +1 (capped 5) when a grammar was all-correct this session.
     */
    /**
     * Admin: paginated list with optional filters.
     * Returns { rows, total }. options is parsed to array.
     */
    adminList: async ({ grammarId = null, hskLevel = null, page = 1, limit = 20 } = {}) => {
        const conds = [];
        const params = [];

        const gid = Number(grammarId);
        if (Number.isFinite(gid) && gid > 0) {
            conds.push('q.grammar_pattern_id = ?');
            params.push(gid);
        }
        const hsk = parseInt(hskLevel, 10);
        if (Number.isFinite(hsk) && hsk >= 1 && hsk <= 6) {
            conds.push('q.hsk_level = ?');
            params.push(hsk);
        }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

        const cleanLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const cleanPage = Math.max(parseInt(page, 10) || 1, 1);
        const offset = (cleanPage - 1) * cleanLimit;

        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM grammar_quiz_questions q ${where}`,
            params
        );
        const total = countRows[0]?.total || 0;

        // LIMIT/OFFSET inlined (mysql2 .execute treats them as strings under prepared stmts).
        const [rows] = await db.query(
            `SELECT q.id, q.grammar_pattern_id, q.hsk_level, q.question_type,
                    q.question_text, q.options, q.correct_answer, q.explanation, q.points,
                    q.created_at, g.grammar_point
               FROM grammar_quiz_questions q
               JOIN grammar_patterns g ON g.id = q.grammar_pattern_id
               ${where}
               ORDER BY q.grammar_pattern_id, q.id
               LIMIT ${cleanLimit} OFFSET ${offset}`,
            params
        );

        return {
            rows: rows.map(r => ({ ...r, options: safeParseOptions(r.options) })),
            total,
            page: cleanPage,
            limit: cleanLimit,
        };
    },

    adminGetById: async (id) => {
        const [rows] = await db.execute(
            `SELECT q.id, q.grammar_pattern_id, q.hsk_level, q.question_type,
                    q.question_text, q.options, q.correct_answer, q.explanation, q.points,
                    q.created_at, g.grammar_point
               FROM grammar_quiz_questions q
               JOIN grammar_patterns g ON g.id = q.grammar_pattern_id
              WHERE q.id = ?`,
            [id]
        );
        if (!rows[0]) return null;
        return { ...rows[0], options: safeParseOptions(rows[0].options) };
    },

    /**
     * Admin: create. Auto-fills hsk_level from grammar parent.
     * Returns { id } or { notFound:true } if grammar_pattern_id doesn't exist.
     */
    adminCreate: async ({ grammar_pattern_id, question_type, question_text, options, correct_answer, explanation, points }) => {
        const [g] = await db.execute(
            'SELECT hsk_level FROM grammar_patterns WHERE id = ?',
            [grammar_pattern_id]
        );
        if (!g[0]) return { notFound: true };

        const hskLevel = g[0].hsk_level;
        const [result] = await db.execute(
            `INSERT INTO grammar_quiz_questions
                (grammar_pattern_id, hsk_level, question_type, question_text, options, correct_answer, explanation, points)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                grammar_pattern_id,
                hskLevel,
                question_type,
                question_text,
                JSON.stringify(options),
                correct_answer,
                explanation || null,
                Number.isFinite(parseInt(points, 10)) ? parseInt(points, 10) : 1,
            ]
        );
        return { id: result.insertId };
    },

    /**
     * Admin: partial update. Only sets fields explicitly present in `fields`.
     * If grammar_pattern_id changes, hsk_level is re-synced from new parent.
     */
    adminUpdate: async (id, fields) => {
        const sets = [];
        const params = [];

        if (fields.grammar_pattern_id !== undefined) {
            const [g] = await db.execute(
                'SELECT hsk_level FROM grammar_patterns WHERE id = ?',
                [fields.grammar_pattern_id]
            );
            if (!g[0]) return { notFound: true };
            sets.push('grammar_pattern_id = ?');
            params.push(fields.grammar_pattern_id);
            sets.push('hsk_level = ?');
            params.push(g[0].hsk_level);
        }
        if (fields.question_type !== undefined) { sets.push('question_type = ?'); params.push(fields.question_type); }
        if (fields.question_text !== undefined) { sets.push('question_text = ?'); params.push(fields.question_text); }
        if (fields.options !== undefined)       { sets.push('options = ?');       params.push(JSON.stringify(fields.options)); }
        if (fields.correct_answer !== undefined){ sets.push('correct_answer = ?');params.push(fields.correct_answer); }
        if (fields.explanation !== undefined)   { sets.push('explanation = ?');   params.push(fields.explanation || null); }
        if (fields.points !== undefined) {
            const p = parseInt(fields.points, 10);
            sets.push('points = ?');
            params.push(Number.isFinite(p) ? p : 1);
        }

        if (!sets.length) return { affected: 0 };

        params.push(id);
        const [result] = await db.execute(
            `UPDATE grammar_quiz_questions SET ${sets.join(', ')} WHERE id = ?`,
            params
        );
        return { affected: result.affectedRows };
    },

    adminDelete: async (id) => {
        const [result] = await db.execute(
            'DELETE FROM grammar_quiz_questions WHERE id = ?',
            [id]
        );
        return result.affectedRows;
    },

    upsertProgress: async (userId, statsByGrammar = {}) => {
        const entries = Object.entries(statsByGrammar);
        for (const [gid, s] of entries) {
            const grammarId = Number(gid);
            if (!Number.isFinite(grammarId)) continue;
            const seen = Math.max(0, parseInt(s.seen, 10) || 0);
            if (seen <= 0) continue;
            const correct = Math.max(0, parseInt(s.correct, 10) || 0);
            const wrong = Math.max(0, parseInt(s.wrong, 10) || 0);
            const masteryDelta = wrong === 0 ? 1 : 0;

            // Quality from session outcome (0..5). All correct = 5; mixed = 3;
            // all wrong = 1. Drives SM-2 ease/interval/next_review_at.
            let quality;
            if (correct > 0 && wrong === 0) quality = 5;
            else if (correct > 0 && wrong > 0) quality = 3;
            else quality = 1;

            // Read current SRS state (if any) and compute next.
            const [existing] = await db.execute(
                `SELECT ease_factor, interval_days, repetitions
                   FROM user_grammar_progress
                  WHERE user_id = ? AND grammar_pattern_id = ?`,
                [userId, grammarId]
            );
            const srs = nextSrs(existing[0] || {}, quality);

            await db.execute(
                `INSERT INTO user_grammar_progress
                   (user_id, grammar_pattern_id, mastery_level,
                    ease_factor, interval_days, repetitions, next_review_at,
                    times_seen, times_correct, times_wrong, last_practiced)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                   times_seen     = times_seen + VALUES(times_seen),
                   times_correct  = times_correct + VALUES(times_correct),
                   times_wrong    = times_wrong + VALUES(times_wrong),
                   mastery_level  = LEAST(5, mastery_level + ?),
                   ease_factor    = VALUES(ease_factor),
                   interval_days  = VALUES(interval_days),
                   repetitions    = VALUES(repetitions),
                   next_review_at = VALUES(next_review_at),
                   last_practiced = NOW()`,
                [
                    userId, grammarId, masteryDelta,
                    srs.ease_factor, srs.interval_days, srs.repetitions, srs.next_review_at,
                    seen, correct, wrong,
                    masteryDelta,
                ]
            );
        }
    },
};

module.exports = GrammarQuiz;
