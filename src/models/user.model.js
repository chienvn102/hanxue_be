/**
 * User Model
 * Handles database operations for user authentication
 */

const db = require('../config/database');

/**
 * Find user by email
 */
async function findByEmail(email) {
    const [rows] = await db.execute(
        'SELECT id, email, password_hash, display_name, role, is_active, google_id, avatar_url FROM users WHERE email = ?',
        [email]
    );
    return rows[0] || null;
}

/**
 * Find user by email with full auth info
 */
async function findByEmailForLogin(email) {
    const [rows] = await db.execute(
        'SELECT id, email, password_hash, display_name, role, is_active, target_hsk, is_premium FROM users WHERE email = ?',
        [email]
    );
    return rows[0] || null;
}

/**
 * Find user by ID
 */
async function findById(id) {
    const [rows] = await db.execute(
        `SELECT id, email, display_name, avatar_url, role, is_active, target_hsk, 
                total_xp, current_streak, longest_streak, total_study_days, 
                last_study_date, native_language, is_premium, created_at
         FROM users WHERE id = ?`,
        [id]
    );
    return rows[0] || null;
}

// ... (findByIdForRefresh, create, updateRefreshToken, findByGoogleId remain unchanged)

/**
 * Update user profile
 */
async function updateProfile(userId, { displayName, targetHsk, nativeLanguage }) {
    const params = [];
    let sql = 'UPDATE users SET ';

    if (displayName !== undefined) {
        sql += 'display_name = ?, ';
        params.push(displayName);
    }
    if (targetHsk !== undefined) {
        sql += 'target_hsk = ?, ';
        params.push(targetHsk);
    }
    if (nativeLanguage !== undefined) {
        sql += 'native_language = ?, ';
        params.push(nativeLanguage);
    }

    if (params.length === 0) return false;

    // Remove trailing comma
    sql = sql.slice(0, -2);
    sql += ' WHERE id = ?';
    params.push(userId);

    const [result] = await db.execute(sql, params);
    return result.affectedRows > 0;
}

/**
 * Find user by ID with password (for password change)
 */
async function findByIdWithPassword(id) {
    const [rows] = await db.execute(
        'SELECT id, password_hash FROM users WHERE id = ?',
        [id]
    );
    return rows[0] || null;
}

/**
 * Update password
 */
async function updatePassword(userId, newHash) {
    await db.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [newHash, userId]
    );
}

module.exports = {
    findByEmail,
    findByEmailForLogin,
    findById,
    findByIdForRefresh,
    create,
    updateRefreshToken,
    findByGoogleId,
    updateProfile,
    findByIdWithPassword,
    updatePassword
};
