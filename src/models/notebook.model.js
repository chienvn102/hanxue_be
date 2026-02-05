const db = require('../config/database');

const Notebook = {
    // Get all notebooks for a user
    findAllByUser: async (userId) => {
        const sql = `
            SELECT n.*, 
                   (SELECT COUNT(*) FROM notebook_items ni WHERE ni.notebook_id = n.id) as word_count
            FROM notebooks n
            WHERE n.user_id = ?
            ORDER BY n.is_default DESC, n.created_at DESC
        `;
        const [rows] = await db.execute(sql, [userId]);
        return rows;
    },

    // Get or create default notebook for user
    getOrCreateDefault: async (userId) => {
        // Try to find existing default
        const [existing] = await db.execute(
            'SELECT * FROM notebooks WHERE user_id = ? AND is_default = TRUE',
            [userId]
        );

        if (existing.length > 0) {
            return existing[0];
        }

        // Create default notebook
        const [result] = await db.execute(
            `INSERT INTO notebooks (user_id, name, is_default, color) VALUES (?, ?, TRUE, ?)`,
            [userId, 'Sổ tay mặc định', '#EF7B7B']
        );

        return {
            id: result.insertId,
            user_id: userId,
            name: 'Sổ tay mặc định',
            is_default: true,
            color: '#EF7B7B',
            word_count: 0
        };
    },

    // Create new notebook
    create: async ({ user_id, name, color }) => {
        const [result] = await db.execute(
            `INSERT INTO notebooks (user_id, name, color) VALUES (?, ?, ?)`,
            [user_id, name, color || '#EF7B7B']
        );
        return result.insertId;
    },

    // Update notebook
    update: async (id, userId, { name, color }) => {
        const [result] = await db.execute(
            `UPDATE notebooks SET name = ?, color = ? WHERE id = ? AND user_id = ?`,
            [name, color, id, userId]
        );
        return result.affectedRows;
    },

    // Delete notebook (not default)
    delete: async (id, userId) => {
        const [result] = await db.execute(
            `DELETE FROM notebooks WHERE id = ? AND user_id = ? AND is_default = FALSE`,
            [id, userId]
        );
        return result.affectedRows;
    },

    // Get items in a notebook
    getItems: async (notebookId, userId) => {
        const sql = `
            SELECT ni.notebook_id, ni.vocabulary_id, ni.vocab_id, ni.note, 
                   ni.mastery_level, ni.review_count, ni.last_reviewed_at, ni.added_at,
                   v.simplified, v.pinyin, v.meaning_vi, v.hsk_level, v.word_type
            FROM notebook_items ni
            JOIN vocabulary v ON ni.vocabulary_id = v.id
            JOIN notebooks n ON ni.notebook_id = n.id
            WHERE ni.notebook_id = ? AND n.user_id = ?
            ORDER BY ni.added_at DESC
        `;
        const [rows] = await db.execute(sql, [notebookId, userId]);
        return rows;
    },

    // Add vocab to notebook
    addItem: async (notebookId, vocabId, note = null) => {
        try {
            const [result] = await db.execute(
                `INSERT INTO notebook_items (notebook_id, vocabulary_id, vocab_id, note) VALUES (?, ?, ?, ?)`,
                [notebookId, vocabId, vocabId, note]
            );
            return { success: true, id: result.insertId };
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return { success: false, message: 'Từ đã có trong sổ tay' };
            }
            throw error;
        }
    },

    // Remove vocab from notebook
    removeItem: async (notebookId, vocabId, userId) => {
        const sql = `
            DELETE ni FROM notebook_items ni
            JOIN notebooks n ON ni.notebook_id = n.id
            WHERE ni.notebook_id = ? AND ni.vocab_id = ? AND n.user_id = ?
        `;
        const [result] = await db.execute(sql, [notebookId, vocabId, userId]);
        return result.affectedRows;
    },

    // Check if vocab is saved in any notebook
    isVocabSaved: async (userId, vocabId) => {
        const sql = `
            SELECT ni.notebook_id FROM notebook_items ni
            JOIN notebooks n ON ni.notebook_id = n.id
            WHERE n.user_id = ? AND ni.vocab_id = ?
            LIMIT 1
        `;
        const [rows] = await db.execute(sql, [userId, vocabId]);
        return rows.length > 0;
    },

    // Get all saved vocab IDs for user (for quick checking)
    getSavedVocabIds: async (userId) => {
        const sql = `
            SELECT DISTINCT ni.vocabulary_id FROM notebook_items ni
            JOIN notebooks n ON ni.notebook_id = n.id
            WHERE n.user_id = ?
        `;
        const [rows] = await db.execute(sql, [userId]);
        return rows.map(r => r.vocabulary_id);
    },

    // Update mastery level
    updateMastery: async (itemId, userId, masteryLevel) => {
        const sql = `
            UPDATE notebook_items ni
            JOIN notebooks n ON ni.notebook_id = n.id
            SET ni.mastery_level = ?, ni.review_count = ni.review_count + 1, ni.last_reviewed_at = NOW()
            WHERE ni.id = ? AND n.user_id = ?
        `;
        const [result] = await db.execute(sql, [masteryLevel, itemId, userId]);
        return result.affectedRows;
    }
};

module.exports = Notebook;
