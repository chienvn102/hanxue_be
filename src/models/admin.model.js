const db = require('../config/database');

const Admin = {
    findByUsername: async (username) => {
        const [rows] = await db.execute(
            'SELECT * FROM admins WHERE username = ?',
            [username]
        );
        return rows[0];
    },

    findById: async (id) => {
        const [rows] = await db.execute(
            'SELECT id, username, role, created_at FROM admins WHERE id = ?',
            [id]
        );
        return rows[0];
    },

    create: async (username, passwordHash, role = 'editor') => {
        const [result] = await db.execute(
            'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
            [username, passwordHash, role]
        );
        return result.insertId;
    }
};

module.exports = Admin;
