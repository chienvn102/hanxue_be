const db = require('../config/database');

const SOURCE_TYPES = new Set(['manual', 'notebook', 'theme', 'lesson', 'hsk']);

async function listByUser(userId) {
    const [rows] = await db.execute(
        `SELECT id, name, description, source_type, source_ref, card_count,
                created_at, last_studied_at
           FROM flashcard_decks
          WHERE user_id = ?
          ORDER BY COALESCE(last_studied_at, created_at) DESC`,
        [userId]
    );
    return rows;
}

async function sourceVocabIds(conn, userId, sourceType, sourceRef) {
    if (sourceType === 'manual') return [];

    if (sourceType === 'notebook') {
        const [rows] = await conn.execute(
            `SELECT DISTINCT COALESCE(ni.vocab_id, ni.vocabulary_id) AS vocab_id
               FROM notebook_items ni
               JOIN notebooks n ON n.id = ni.notebook_id
              WHERE n.user_id = ? AND ni.notebook_id = ?`,
            [userId, sourceRef]
        );
        return rows.map(row => row.vocab_id).filter(Boolean);
    }

    if (sourceType === 'theme') {
        const [rows] = await conn.execute(
            `SELECT DISTINCT vtm.vocab_id
               FROM vocabulary_theme_map vtm
               JOIN vocabulary_themes vt ON vt.id = vtm.theme_id
              WHERE vt.slug = ?`,
            [sourceRef]
        );
        return rows.map(row => row.vocab_id);
    }

    if (sourceType === 'lesson') {
        const [rows] = await conn.execute(
            `SELECT DISTINCT vocabulary_id AS vocab_id FROM lesson_vocabulary WHERE lesson_id = ?`,
            [sourceRef]
        );
        return rows.map(row => row.vocab_id);
    }

    if (sourceType === 'hsk') {
        const level = Math.min(6, Math.max(1, parseInt(sourceRef, 10) || 1));
        const [rows] = await conn.execute(
            `SELECT id AS vocab_id FROM vocabulary WHERE hsk_level = ? ORDER BY frequency_rank ASC LIMIT 500`,
            [level]
        );
        return rows.map(row => row.vocab_id);
    }

    return [];
}

async function create({ userId, name, description = null, sourceType = 'manual', sourceRef = null }) {
    if (!SOURCE_TYPES.has(sourceType)) {
        const err = new Error('Invalid source_type');
        err.status = 400;
        throw err;
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [result] = await conn.execute(
            `INSERT INTO flashcard_decks (user_id, name, description, source_type, source_ref)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, name, description, sourceType, sourceRef]
        );
        const deckId = result.insertId;
        const vocabIds = await sourceVocabIds(conn, userId, sourceType, sourceRef);

        for (const vocabId of vocabIds) {
            await conn.execute(
                `INSERT IGNORE INTO flashcard_deck_items (deck_id, vocab_id) VALUES (?, ?)`,
                [deckId, vocabId]
            );
        }

        await conn.execute(
            `UPDATE flashcard_decks
                SET card_count = (SELECT COUNT(*) FROM flashcard_deck_items WHERE deck_id = ?)
              WHERE id = ?`,
            [deckId, deckId]
        );

        await conn.commit();
        return deckId;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function assertOwner(deckId, userId) {
    const [rows] = await db.execute(
        'SELECT id FROM flashcard_decks WHERE id = ? AND user_id = ?',
        [deckId, userId]
    );
    return rows.length > 0;
}

async function addItem(deckId, userId, vocabId) {
    if (!await assertOwner(deckId, userId)) return false;
    await db.execute(
        `INSERT IGNORE INTO flashcard_deck_items (deck_id, vocab_id) VALUES (?, ?)`,
        [deckId, vocabId]
    );
    await db.execute(
        `UPDATE flashcard_decks
            SET card_count = (SELECT COUNT(*) FROM flashcard_deck_items WHERE deck_id = ?)
          WHERE id = ?`,
        [deckId, deckId]
    );
    return true;
}

async function removeItem(deckId, userId, vocabId) {
    if (!await assertOwner(deckId, userId)) return false;
    await db.execute(
        'DELETE FROM flashcard_deck_items WHERE deck_id = ? AND vocab_id = ?',
        [deckId, vocabId]
    );
    await db.execute(
        `UPDATE flashcard_decks
            SET card_count = (SELECT COUNT(*) FROM flashcard_deck_items WHERE deck_id = ?)
          WHERE id = ?`,
        [deckId, deckId]
    );
    return true;
}

/**
 * Update tên/mô tả của 1 deck. Chỉ chấp nhận field hợp lệ.
 * Trả về số row affected (0 nếu deck không thuộc user).
 */
async function updateDeck(deckId, userId, { name, description }) {
    const updates = [];
    const params = [];
    if (typeof name === 'string') {
        const trimmed = name.trim();
        if (!trimmed) { const e = new Error('name không được rỗng'); e.status = 400; throw e; }
        updates.push('name = ?');
        params.push(trimmed.slice(0, 100));
    }
    if (description !== undefined) {
        updates.push('description = ?');
        params.push(description ? String(description).slice(0, 2000) : null);
    }
    if (updates.length === 0) return 0;
    params.push(deckId, userId);
    const [result] = await db.execute(
        `UPDATE flashcard_decks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        params
    );
    return result.affectedRows;
}

/**
 * Liệt kê tất cả vocab trong deck (KHÔNG random, KHÔNG limit). Dùng cho trang
 * quản lý items của deck. Trả null nếu deck không thuộc user.
 */
async function listItems(deckId, userId) {
    if (!await assertOwner(deckId, userId)) return null;
    const [rows] = await db.execute(
        `SELECT v.id, v.simplified, v.traditional, v.pinyin, v.han_viet,
                v.meaning_vi, v.meaning_en, v.hsk_level, v.audio_url,
                fdi.added_at
           FROM flashcard_deck_items fdi
           JOIN vocabulary v ON v.id = fdi.vocab_id
          WHERE fdi.deck_id = ?
          ORDER BY fdi.added_at DESC, v.id DESC`,
        [deckId]
    );
    return rows;
}

async function deleteDeck(deckId, userId) {
    const [result] = await db.execute(
        'DELETE FROM flashcard_decks WHERE id = ? AND user_id = ?',
        [deckId, userId]
    );
    return result.affectedRows;
}

async function getSession(deckId, userId, limit = 20) {
    if (!await assertOwner(deckId, userId)) return null;
    const wordLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const [rows] = await db.execute(
        `SELECT v.id, v.simplified, v.traditional, v.pinyin, v.han_viet,
                v.meaning_vi, v.meaning_en, v.hsk_level
           FROM flashcard_deck_items fdi
           JOIN vocabulary v ON v.id = fdi.vocab_id
          WHERE fdi.deck_id = ?
          ORDER BY RAND()
          LIMIT ?`,
        [deckId, wordLimit]
    );
    await db.execute('UPDATE flashcard_decks SET last_studied_at = NOW() WHERE id = ?', [deckId]);
    return rows;
}

module.exports = {
    listByUser,
    create,
    addItem,
    removeItem,
    deleteDeck,
    updateDeck,
    listItems,
    getSession,
};
