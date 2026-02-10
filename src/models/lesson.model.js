const db = require('../config/database');

const Lesson = {
    // List lessons by course ID (with optional user progress)
    findByCourseId: async (courseId, userId = null) => {
        const [rows] = await db.execute(
            `SELECT l.*,
                    (SELECT COUNT(*) FROM contents WHERE lesson_id = l.id) as content_count,
                    (SELECT COUNT(*) FROM questions WHERE lesson_id = l.id) as question_count,
                    (SELECT ulp.status FROM user_lesson_progress ulp
                     WHERE ulp.lesson_id = l.id AND ulp.user_id = ?
                     ORDER BY FIELD(ulp.status, 'completed', 'in_progress', 'not_started')
                     LIMIT 1) as progress_status
             FROM lessons l
             WHERE l.course_id = ? AND l.is_active = TRUE
             ORDER BY l.order_index ASC`,
            [userId, courseId]
        );
        return rows;
    },

    // Get simplified lesson list for navigation
    findSimpleByCourseId: async (courseId) => {
        const [rows] = await db.execute(
            'SELECT id, title, order_index FROM lessons WHERE course_id = ? AND is_active = TRUE ORDER BY order_index ASC',
            [courseId]
        );
        return rows;
    },

    findById: async (id) => {
        const [rows] = await db.execute(
            'SELECT * FROM lessons WHERE id = ?',
            [id]
        );
        return rows[0];
    },

    create: async (data) => {
        const { course_id, title, description, youtube_id, duration, order_index } = data;
        const [result] = await db.execute(
            `INSERT INTO lessons 
            (course_id, title, description, youtube_id, duration, order_index) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [course_id, title, description || null, youtube_id, duration || 0, order_index || 0]
        );
        return result.insertId;
    },

    update: async (id, data) => {
        const keys = Object.keys(data);
        if (keys.length === 0) return 0;

        const setClause = keys.map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(data), id];

        const [result] = await db.execute(
            `UPDATE lessons SET ${setClause} WHERE id = ?`,
            values
        );
        return result.affectedRows;
    },

    delete: async (id) => {
        // Soft delete
        const [result] = await db.execute(
            'UPDATE lessons SET is_active = FALSE WHERE id = ?',
            [id]
        );
        return result.affectedRows;
    }
};

module.exports = Lesson;
