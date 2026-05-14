const db = require('../config/database');

const Course = {
    // List all courses with lesson count
    findAll: async (userId = null) => {
        const sql = `
            SELECT c.*, 
                   COUNT(l.id) as lesson_count,
                   (SELECT COUNT(*) FROM user_lesson_progress ulp
                    JOIN lessons l2 ON ulp.lesson_id = l2.id
                    WHERE l2.course_id = c.id AND ulp.user_id = ? AND ulp.status = 'completed') as completed_lessons
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

    getProgressForUser: async (userId, courseId) => {
        let rows;
        try {
            [rows] = await db.execute(
                `SELECT
                        c.id AS course_id,
                        c.title AS prerequisite_title,
                        COUNT(l.id) AS total_lessons,
                        SUM(CASE WHEN ulp.status = 'completed' THEN 1 ELSE 0 END) AS completed_lessons,
                        MAX(cc.is_complete) AS completion_recorded
                 FROM courses c
                 LEFT JOIN lessons l ON l.course_id = c.id AND l.is_active = TRUE
                 LEFT JOIN user_lesson_progress ulp
                        ON ulp.lesson_id = l.id AND ulp.user_id = ?
                 LEFT JOIN course_completions cc
                        ON cc.user_id = ? AND cc.course_id = c.id
                 WHERE c.id = ?
                 GROUP BY c.id`,
                [userId, userId, courseId]
            );
        } catch (error) {
            if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
            [rows] = await db.execute(
                `SELECT
                        c.id AS course_id,
                        c.title AS prerequisite_title,
                        COUNT(l.id) AS total_lessons,
                        SUM(CASE WHEN ulp.status = 'completed' THEN 1 ELSE 0 END) AS completed_lessons,
                        0 AS completion_recorded
                 FROM courses c
                 LEFT JOIN lessons l ON l.course_id = c.id AND l.is_active = TRUE
                 LEFT JOIN user_lesson_progress ulp
                        ON ulp.lesson_id = l.id AND ulp.user_id = ?
                 WHERE c.id = ?
                 GROUP BY c.id`,
                [userId, courseId]
            );
        }
        const row = rows[0];
        if (!row) return null;
        const totalLessons = Number(row.total_lessons || 0);
        const completedLessons = Number(row.completed_lessons || 0);
        return {
            ...row,
            total_lessons: totalLessons,
            completed_lessons: completedLessons,
            is_complete: Boolean(row.completion_recorded) || completedLessons >= totalLessons,
        };
    },

    getUnlockStatus: async (userId, courseId) => {
        const course = await Course.findById(courseId);
        if (!course) return { unlocked: false, course: null, prerequisiteProgress: null };
        if (!course.prerequisite_course_id) return { unlocked: true, course, prerequisiteProgress: null };

        const prerequisiteProgress = await Course.getProgressForUser(userId, course.prerequisite_course_id);
        return {
            unlocked: Boolean(prerequisiteProgress?.is_complete),
            course,
            prerequisiteProgress,
        };
    },

    markCompletionIfDone: async (userId, courseId) => {
        const progress = await Course.getProgressForUser(userId, courseId);
        if (!progress) return false;

        const isComplete = Number(progress.total_lessons || 0) > 0
            && Number(progress.completed_lessons || 0) >= Number(progress.total_lessons || 0);

        try {
            await db.execute(
                `INSERT INTO course_completions (user_id, course_id, completed_at, is_complete)
                 VALUES (?, ?, IF(?, NOW(), NULL), ?)
                 ON DUPLICATE KEY UPDATE
                   completed_at = IF(VALUES(is_complete), COALESCE(completed_at, NOW()), completed_at),
                   is_complete = VALUES(is_complete)`,
                [userId, courseId, isComplete, isComplete]
            );
        } catch (error) {
            if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
        }
        return isComplete;
    },

    reopenCompletionsForCourse: async (courseId) => {
        try {
            const [result] = await db.execute(
                `UPDATE course_completions
                 SET is_complete = FALSE
                 WHERE course_id = ? AND completed_at IS NOT NULL`,
                [courseId]
            );
            return result.affectedRows;
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return 0;
            throw error;
        }
    },

    create: async ({ hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index }) => {
        const [result] = await db.execute(
            `INSERT INTO courses 
            (hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [hsk_level, title, description, thumbnail_url, prerequisite_course_id || null, order_index || 0]
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
