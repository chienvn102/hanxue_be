const db = require('../config/database');

const Course = {
    // List all courses with lesson count + (per user) completed lessons and
    // whether the chosen final exam has been passed — so the FE can show a
    // final-exam-aware locked/complete state for each course card.
    findAll: async (userId = null) => {
        const sql = `
            SELECT c.*,
                   COUNT(l.id) as lesson_count,
                   (SELECT COUNT(*) FROM user_lesson_progress ulp
                    JOIN lessons l2 ON ulp.lesson_id = l2.id
                    WHERE l2.course_id = c.id AND ulp.user_id = ? AND ulp.status = 'completed') as completed_lessons,
                   (SELECT COUNT(*) FROM hsk_exam_attempts a
                    WHERE a.user_id = ? AND a.exam_id = c.final_exam_id
                      AND a.status = 'completed' AND a.is_passed = 1) as final_exam_passed_cnt
            FROM courses c
            LEFT JOIN lessons l ON c.id = l.course_id AND l.is_active = TRUE
            WHERE c.is_active = TRUE
            GROUP BY c.id
            ORDER BY c.hsk_level ASC, c.order_index ASC
        `;
        const [rows] = await db.execute(sql, [userId, userId]);
        return rows;
    },

    // Has the user passed a given HSK exam (any completed, passed attempt)?
    hasPassedExam: async (userId, examId) => {
        if (!examId) return false;
        const [rows] = await db.execute(
            `SELECT 1 FROM hsk_exam_attempts
              WHERE user_id = ? AND exam_id = ? AND status = 'completed' AND is_passed = 1
              LIMIT 1`,
            [userId, examId]
        );
        return rows.length > 0;
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
                        c.final_exam_id AS final_exam_id,
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
                        c.final_exam_id AS final_exam_id,
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
        const lessonsComplete = totalLessons > 0 && completedLessons >= totalLessons;

        // A course that has a final exam is only "complete" when all lessons are
        // done AND that exam is passed (the end-of-course gate). Courses without
        // a final exam keep the legacy rule (recorded completion OR all lessons).
        const finalExamId = row.final_exam_id ?? null;
        const finalExamPassed = finalExamId != null
            ? await Course.hasPassedExam(userId, finalExamId)
            : true;
        const isComplete = finalExamId != null
            ? (lessonsComplete && finalExamPassed)
            : (Boolean(row.completion_recorded) || lessonsComplete);

        return {
            ...row,
            total_lessons: totalLessons,
            completed_lessons: completedLessons,
            final_exam_id: finalExamId,
            lessons_complete: lessonsComplete,
            final_exam_passed: finalExamPassed,
            is_complete: isComplete,
        };
    },

    /**
     * End-of-course exam status for one user.
     * @returns { examId, exam, allLessonsPassed, examUnlocked, passed } | null
     */
    getFinalExamStatus: async (userId, courseId) => {
        const progress = await Course.getProgressForUser(userId, courseId);
        if (!progress) return null;
        const examId = progress.final_exam_id ?? null;
        const allLessonsPassed = Boolean(progress.lessons_complete);

        let exam = null;
        let passed = false;
        if (examId != null) {
            passed = Boolean(progress.final_exam_passed);
            const [rows] = await db.execute(
                `SELECT id, title, hsk_level, duration_minutes, total_questions
                   FROM hsk_exams WHERE id = ? LIMIT 1`,
                [examId]
            );
            exam = rows[0] || null;
        }
        return {
            examId,
            exam,
            allLessonsPassed,
            examUnlocked: examId != null && allLessonsPassed,
            passed,
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

        // Final-exam-aware: getProgressForUser.is_complete already requires the
        // final exam to be passed when the course has one.
        const isComplete = Boolean(progress.is_complete);

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

    // Called after a final exam attempt is passed: refresh course_completions
    // for every active course that uses this exam as its end-of-course test.
    onFinalExamPassed: async (userId, examId) => {
        if (!examId) return;
        const [courses] = await db.execute(
            'SELECT id FROM courses WHERE final_exam_id = ? AND is_active = TRUE',
            [examId]
        );
        for (const c of courses) {
            await Course.markCompletionIfDone(userId, c.id);
        }
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

    create: async ({ hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index, final_exam_id }) => {
        const [result] = await db.execute(
            `INSERT INTO courses
            (hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index, final_exam_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            // mysql2 cấm bind `undefined` → ép về null cho field optional.
            [hsk_level, title, description ?? null, thumbnail_url ?? null, prerequisite_course_id ?? null, order_index ?? 0, final_exam_id ?? null]
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
