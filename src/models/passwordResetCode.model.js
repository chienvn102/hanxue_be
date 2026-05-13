const db = require('../config/database');

async function consumeActiveForUser(userId) {
    await db.execute(
        `UPDATE password_reset_codes
         SET consumed_at = NOW()
         WHERE user_id = ? AND consumed_at IS NULL`,
        [userId]
    );
}

async function create({ userId, codeHash, expiresAt }) {
    const [result] = await db.execute(
        `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
         VALUES (?, ?, ?)`,
        [userId, codeHash, expiresAt]
    );
    return result.insertId;
}

async function findLatestActiveByUserId(userId) {
    const [rows] = await db.execute(
        `SELECT id, user_id, code_hash, expires_at, attempts, consumed_at
         FROM password_reset_codes
         WHERE user_id = ?
           AND consumed_at IS NULL
           AND expires_at > NOW()
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

async function incrementAttempts(id) {
    await db.execute(
        `UPDATE password_reset_codes
         SET attempts = attempts + 1
         WHERE id = ?`,
        [id]
    );
}

async function markConsumed(id) {
    await db.execute(
        `UPDATE password_reset_codes
         SET consumed_at = NOW()
         WHERE id = ?`,
        [id]
    );
}

module.exports = {
    consumeActiveForUser,
    create,
    findLatestActiveByUserId,
    incrementAttempts,
    markConsumed
};
