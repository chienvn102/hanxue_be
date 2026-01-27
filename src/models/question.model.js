const db = require('../config/database');

const Question = {
    // Get all questions for a lesson
    findByLessonId: async (lessonId) => {
        const [rows] = await db.execute(
            'SELECT * FROM questions WHERE lesson_id = ? ORDER BY order_index ASC',
            [lessonId]
        );
        return rows;
    },

    create: async (data) => {
        const { lesson_id, question_type, data: jsonData, order_index } = data;
        const [result] = await db.execute(
            `INSERT INTO questions 
            (lesson_id, question_type, data, order_index) 
            VALUES (?, ?, ?, ?)`,
            [lesson_id, question_type, JSON.stringify(jsonData), order_index || 0]
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
            `UPDATE questions SET ${setClause} WHERE id = ?`,
            values
        );
        return result.affectedRows;
    },

    delete: async (id) => {
        const [result] = await db.execute(
            'DELETE FROM questions WHERE id = ?',
            [id]
        );
        return result.affectedRows;
    }
};

module.exports = Question;
