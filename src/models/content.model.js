const db = require('../config/database');

const Content = {
    // Get all contents for a lesson
    findByLessonId: async (lessonId) => {
        const [rows] = await db.execute(
            'SELECT * FROM contents WHERE lesson_id = ? ORDER BY `timestamp` ASC, order_index ASC',
            [lessonId]
        );
        return rows;
    },

    create: async (data) => {
        const { lesson_id, type, timestamp, data: jsonData, order_index } = data;
        const [result] = await db.execute(
            `INSERT INTO contents 
            (lesson_id, type, timestamp, data, order_index) 
            VALUES (?, ?, ?, ?, ?)`,
            [lesson_id, type, timestamp || 0, JSON.stringify(jsonData), order_index || 0]
        );
        return result.insertId;
    },

    update: async (id, data) => {
        const keys = Object.keys(data);
        if (keys.length === 0) return 0;

        // Handle JSON data specific serialization
        const values = [];
        const setClause = keys.map(key => {
            if (key === 'data') {
                values.push(JSON.stringify(data[key]));
            } else {
                values.push(data[key]);
            }
            return `${key} = ?`;
        }).join(', ');

        values.push(id);

        const [result] = await db.execute(
            `UPDATE contents SET ${setClause} WHERE id = ?`,
            values
        );
        return result.affectedRows;
    },

    delete: async (id) => {
        const [result] = await db.execute(
            'DELETE FROM contents WHERE id = ?',
            [id]
        );
        return result.affectedRows;
    }
};

module.exports = Content;
