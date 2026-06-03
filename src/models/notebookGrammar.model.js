/**
 * Notebook Grammar Model
 * Saved grammar points ("Ngu phap" tab in so tay). Kept separate from
 * vocab notebook_items (which is vocab-only). Flat list keyed by user_id.
 */

const db = require('../config/database');

const NotebookGrammar = {
    // Saved grammar ids only — for quick bookmark-state checks on the FE.
    getSavedGrammarIds: async (userId) => {
        const [rows] = await db.execute(
            'SELECT grammar_pattern_id FROM notebook_grammar_items WHERE user_id = ?',
            [userId]
        );
        return rows.map(r => r.grammar_pattern_id);
    },

    // Full saved-grammar list with labels for the notebook tab.
    getSaved: async (userId) => {
        const [rows] = await db.execute(
            `SELECT ngi.grammar_pattern_id, ngi.note, ngi.created_at,
                    g.grammar_point, g.pattern_formula, g.hsk_level, g.explanation
               FROM notebook_grammar_items ngi
               JOIN grammar_patterns g ON g.id = ngi.grammar_pattern_id
              WHERE ngi.user_id = ?
              ORDER BY ngi.created_at DESC`,
            [userId]
        );
        return rows;
    },

    // Add (or update note). Verifies the grammar exists first.
    addGrammar: async (userId, grammarId, note = null) => {
        const [g] = await db.execute('SELECT id FROM grammar_patterns WHERE id = ?', [grammarId]);
        if (g.length === 0) return { success: false, notFound: true };
        await db.execute(
            `INSERT INTO notebook_grammar_items (user_id, grammar_pattern_id, note)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE note = VALUES(note)`,
            [userId, grammarId, note]
        );
        return { success: true };
    },

    removeGrammar: async (userId, grammarId) => {
        const [result] = await db.execute(
            'DELETE FROM notebook_grammar_items WHERE user_id = ? AND grammar_pattern_id = ?',
            [userId, grammarId]
        );
        return result.affectedRows;
    },
};

module.exports = NotebookGrammar;
