const db = require('../config/database');

const Course = {
    // List all courses with lesson count
    findAll: async (userId = null) => {
        const sql = `
            SELECT c.*, 
                   COUNT(l.id) as lesson_count,
                   (SELECT COUNT(*) FROM user_lesson_progress ulp 
                    JOIN lessons l2 ON ulp.lesson_id = l2.id 
                    WHERE l2.course_id = c.id AND ulp.user_id = ?) as completed_lessons
            FROM courses c
            LEFT JOIN lessons l ON c.id = l.course_id AND l.is_active = TRUE
            WHERE c.is_active = TRUE
            GROUP BY c.id
            ORDER BY c.hsk_level ASC, c.order_index ASC
        `;
        const [rows] = await db.execute(sql, [userId]);
        return rows;
    },

    findById: async (id) => {
        const [rows] = await db.execute(
            'SELECT * FROM courses WHERE id = ?',
            [id]
        );
        return rows[0];
    },

    create: async ({ hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index }) => {
        const [result] = await db.execute(
            `INSERT INTO courses 
            (hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index || 0]
        );
        return result.insertId;
    },

    update: async (id, data) => {
        const keys = Object.keys(data);
        if (keys.length === 0) return 0;

        const setClause = keys.map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(data), id];

        const [result] = await db.execute(
            `UPDATE courses SET ${setClause} WHERE id = ?`,
            values
        );
        return result.affectedRows;
    },

    delete: async (id) => {
        const [result] = await db.execute(
            'UPDATE courses SET is_active = FALSE WHERE id = ?',
            [id]
        );
        return result.affectedRows;
    }
};

module.exports = Course;
