/**
 * Grammar Quiz Model
 * Reads seeded MCQ questions (grammar_quiz_questions) and tracks per-user
 * grammar mastery (user_grammar_progress). Source-of-truth for grammar
 * practice progress that later feeds weak-point context to the AI tutor.
 */

const db = require('../config/database');

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

            await db.execute(
                `INSERT INTO user_grammar_progress
                   (user_id, grammar_pattern_id, mastery_level, times_seen, times_correct, times_wrong, last_practiced)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                   times_seen    = times_seen + VALUES(times_seen),
                   times_correct = times_correct + VALUES(times_correct),
                   times_wrong   = times_wrong + VALUES(times_wrong),
                   mastery_level = LEAST(5, mastery_level + ?),
                   last_practiced = NOW()`,
                [userId, grammarId, masteryDelta, seen, correct, wrong, masteryDelta]
            );
        }
    },
};

module.exports = GrammarQuiz;
