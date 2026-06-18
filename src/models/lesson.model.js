const db = require('../config/database');

const Lesson = {
    // List lessons by course ID (with optional user progress).
    // includeInactive=true: trả cả bài soft-deleted (admin context).
    findByCourseId: async (courseId, userId = null, includeInactive = false) => {
        const activeFilter = includeInactive ? '' : 'AND l.is_active = TRUE';
        const [rows] = await db.execute(
            `SELECT l.*,
                    (SELECT COUNT(*) FROM contents WHERE lesson_id = l.id) as content_count,
                    (SELECT COUNT(*) FROM questions WHERE lesson_id = l.id) as question_count,
                    (SELECT ulp.status FROM user_lesson_progress ulp
                     WHERE ulp.lesson_id = l.id AND ulp.user_id = ?
                     ORDER BY FIELD(ulp.status, 'completed', 'in_progress', 'not_started')
                     LIMIT 1) as progress_status
             FROM lessons l
             WHERE l.course_id = ? ${activeFilter}
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

    /**
     * Lesson-level gating: a lesson is unlocked for a user when it is the first
     * active lesson of its course (by order_index, id) OR the immediately
     * previous active lesson has been completed (status='completed').
     */
    isUnlockedForUser: async (userId, lessonId) => {
        const [[lesson]] = await db.execute(
            'SELECT id, course_id, order_index FROM lessons WHERE id = ? AND is_active = TRUE',
            [lessonId]
        );
        if (!lesson) return true; // unknown/inactive → let the route handle 404

        const [[prev]] = await db.execute(
            `SELECT id FROM lessons
              WHERE course_id = ? AND is_active = TRUE
                AND (order_index < ? OR (order_index = ? AND id < ?))
              ORDER BY order_index DESC, id DESC LIMIT 1`,
            [lesson.course_id, lesson.order_index, lesson.order_index, lesson.id]
        );
        if (!prev) return true; // first lesson of the course

        const [[prog]] = await db.execute(
            'SELECT status FROM user_lesson_progress WHERE user_id = ? AND lesson_id = ? LIMIT 1',
            [userId, prev.id]
        );
        return prog?.status === 'completed';
    },

    /**
     * Lightweight metadata for FE practice headers ("Từ vựng bài <title> · HSK <n>").
     * Joins the course title so the FE can render a single breadcrumb.
     */
    getMeta: async (id) => {
        const [rows] = await db.execute(
            `SELECT l.id, l.title, l.hsk_level, l.course_id, c.title AS course_title
               FROM lessons l
          LEFT JOIN courses c ON c.id = l.course_id
              WHERE l.id = ? AND l.is_active = TRUE`,
            [id]
        );
        return rows[0] || null;
    },

    create: async (data) => {
        // After migration 004, lessons no longer carry youtube_id/duration; the
        // textbook fields are populated via TextbookLesson.createTextbook().
        const { course_id, title, description, order_index, hsk_level } = data;
        const [result] = await db.execute(
            `INSERT INTO lessons (course_id, title, description, order_index, hsk_level, is_active)
             VALUES (?, ?, ?, ?, ?, TRUE)`,
            [course_id, title, description || null, order_index || 0, hsk_level || 1]
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
