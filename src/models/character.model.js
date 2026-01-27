/**
 * Character Model
 * Handles database operations for Chinese characters
 */

const db = require('../config/database');

/**
 * Get character by hanzi
 */
async function getByHanzi(hanzi) {
    const [rows] = await db.execute(
        'SELECT * FROM characters WHERE hanzi = ?',
        [hanzi]
    );
    return rows[0] || null;
}

/**
 * Get stroke order data for a character
 */
async function getStrokeOrder(hanzi) {
    const [rows] = await db.execute(
        'SELECT hanzi, stroke_count, stroke_order FROM characters WHERE hanzi = ?',
        [hanzi]
    );
    return rows[0] || null;
}

/**
 * Get characters by list of hanzi
 */
async function getByHanziList(characters) {
    if (characters.length === 0) return [];

    const placeholders = characters.map(() => '?').join(',');
    const [rows] = await db.execute(
        `SELECT * FROM characters WHERE hanzi IN (${placeholders})`,
        characters
    );
    return rows;
}

module.exports = {
    getByHanzi,
    getStrokeOrder,
    getByHanziList
};
