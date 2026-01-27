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
        'SELECT id FROM users WHERE email = ?',
        [email]
    );
    return rows[0] || null;
}

/**
 * Find user by email with full auth info
 */
async function findByEmailForLogin(email) {
    const [rows] = await db.execute(
        'SELECT id, email, password_hash, display_name, target_hsk, is_premium FROM users WHERE email = ?',
        [email]
    );
    return rows[0] || null;
}

/**
 * Find user by ID
 */
async function findById(id) {
    const [rows] = await db.execute(
        `SELECT id, email, display_name, avatar_url, target_hsk, 
                total_xp, current_streak, is_premium, created_at
         FROM users WHERE id = ?`,
        [id]
    );
    return rows[0] || null;
}

/**
 * Find user by ID with refresh token hash
 */
async function findByIdForRefresh(id) {
    const [rows] = await db.execute(
        'SELECT id, email, refresh_token_hash FROM users WHERE id = ?',
        [id]
    );
    return rows[0] || null;
}

/**
 * Create new user
 */
async function create({ email, passwordHash, displayName }) {
    const [result] = await db.execute(
        'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)',
        [email, passwordHash, displayName || null]
    );
    return result.insertId;
}

/**
 * Update user's refresh token hash
 */
async function updateRefreshToken(userId, refreshHash) {
    await db.execute(
        'UPDATE users SET refresh_token_hash = ? WHERE id = ?',
        [refreshHash, userId]
    );
}

module.exports = {
    findByEmail,
    findByEmailForLogin,
    findById,
    findByIdForRefresh,
    create,
    updateRefreshToken
};
