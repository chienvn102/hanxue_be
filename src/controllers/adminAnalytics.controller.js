/**
 * Admin Analytics — số liệu hoạt động & kết quả học của người dùng.
 *
 * Trang quản lý RIÊNG (/admin/analytics), tách khỏi dashboard "Tổng quan"
 * (vốn chỉ đếm nội dung). Endpoint này tổng hợp:
 *   - users   : tổng, mới (7/30d), hoạt động (7/30d), theo cấp HSK, đăng ký 14 ngày.
 *   - courses : completions + theo từng khóa (số người học, hoàn thành, tỉ lệ).
 *   - lessons : số lượt bài hoàn thành / đang học.
 *   - exams   : lượt làm, tỉ lệ đạt, điểm TB%, thời gian TB, 14 ngày + theo từng đề.
 *
 * Read-only, admin-only. Mỗi truy vấn bọc safeRows() để 1 bảng thiếu không làm
 * sập toàn bộ endpoint.
 */

const db = require('../config/database');

async function safeRows(sql, params = []) {
    try {
        const [rows] = await db.execute(sql, params);
        return rows;
    } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') return [];
        throw err;
    }
}

const num = (v) => Number(v || 0);

exports.getAnalytics = async (req, res) => {
    try {
        const [
            userAgg,
            usersByHsk,
            registrations,
            lessonAgg,
            courseCompletionsAgg,
            perCourse,
            examAgg,
            examSeries,
            perExam,
        ] = await Promise.all([
            // --- users aggregate ---
            safeRows(`
                SELECT
                  COUNT(*) AS total,
                  SUM(created_at >= NOW() - INTERVAL 7 DAY)  AS new_7d,
                  SUM(created_at >= NOW() - INTERVAL 30 DAY) AS new_30d,
                  SUM(last_study_date >= CURDATE() - INTERVAL 7 DAY)  AS active_7d,
                  SUM(last_study_date >= CURDATE() - INTERVAL 30 DAY) AS active_30d
                FROM users`),
            safeRows(`
                SELECT target_hsk AS hsk, COUNT(*) AS cnt
                  FROM users WHERE target_hsk IS NOT NULL
                 GROUP BY target_hsk ORDER BY target_hsk`),
            safeRows(`
                SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
                  FROM users WHERE created_at >= CURDATE() - INTERVAL 13 DAY
                 GROUP BY d ORDER BY d`),

            // --- lessons ---
            safeRows(`
                SELECT
                  SUM(status = 'completed')   AS completed,
                  SUM(status = 'in_progress') AS in_progress
                FROM user_lesson_progress`),

            // --- courses ---
            safeRows(`SELECT COUNT(*) AS c FROM course_completions WHERE is_complete = 1`),
            safeRows(`
                SELECT c.id, c.title, c.hsk_level,
                  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND l.is_active = 1) AS lesson_count,
                  (SELECT COUNT(DISTINCT ulp.user_id)
                     FROM user_lesson_progress ulp
                     JOIN lessons l ON l.id = ulp.lesson_id
                    WHERE l.course_id = c.id) AS learners,
                  (SELECT COUNT(*)
                     FROM user_lesson_progress ulp
                     JOIN lessons l ON l.id = ulp.lesson_id
                    WHERE l.course_id = c.id AND ulp.status = 'completed') AS lesson_completions,
                  (SELECT COUNT(*) FROM course_completions cc
                    WHERE cc.course_id = c.id AND cc.is_complete = 1) AS completed
                FROM courses c
               WHERE c.is_active = 1
               ORDER BY c.hsk_level ASC, c.order_index ASC`),

            // --- exams aggregate ---
            safeRows(`
                SELECT
                  COUNT(*) AS attempts,
                  SUM(status = 'completed') AS completed,
                  SUM(is_passed = 1) AS passed,
                  AVG(CASE WHEN status = 'completed' AND max_score > 0
                           THEN total_score / max_score * 100 END) AS avg_pct,
                  AVG(CASE WHEN status = 'completed' THEN time_spent_seconds END) AS avg_time
                FROM hsk_exam_attempts`),
            safeRows(`
                SELECT DATE_FORMAT(started_at, '%Y-%m-%d') AS d, COUNT(*) AS c
                  FROM hsk_exam_attempts WHERE started_at >= CURDATE() - INTERVAL 13 DAY
                 GROUP BY d ORDER BY d`),
            safeRows(`
                SELECT e.id, e.title, e.hsk_level, e.format_version,
                  COUNT(a.id) AS attempts,
                  SUM(a.status = 'completed') AS completed,
                  SUM(a.is_passed = 1) AS passed,
                  AVG(CASE WHEN a.status = 'completed' AND a.max_score > 0
                           THEN a.total_score / a.max_score * 100 END) AS avg_pct,
                  AVG(CASE WHEN a.status = 'completed' THEN a.time_spent_seconds END) AS avg_time
                FROM hsk_exams e
                JOIN hsk_exam_attempts a ON a.exam_id = e.id
               GROUP BY e.id, e.title, e.hsk_level, e.format_version
               ORDER BY attempts DESC
               LIMIT 50`),
        ]);

        const u = userAgg[0] || {};
        const l = lessonAgg[0] || {};
        const ex = examAgg[0] || {};

        res.json({
            success: true,
            data: {
                users: {
                    total: num(u.total),
                    new7d: num(u.new_7d),
                    new30d: num(u.new_30d),
                    active7d: num(u.active_7d),
                    active30d: num(u.active_30d),
                    byHsk: usersByHsk.map((r) => ({ hsk: num(r.hsk), count: num(r.cnt) })),
                    registrations: registrations.map((r) => ({ date: r.d, count: num(r.c) })),
                },
                lessons: {
                    completed: num(l.completed),
                    inProgress: num(l.in_progress),
                },
                courses: {
                    totalCompletions: num(courseCompletionsAgg[0]?.c),
                    perCourse: perCourse.map((r) => ({
                        id: r.id,
                        title: r.title,
                        hskLevel: num(r.hsk_level),
                        lessonCount: num(r.lesson_count),
                        learners: num(r.learners),
                        lessonCompletions: num(r.lesson_completions),
                        completed: num(r.completed),
                    })),
                },
                exams: {
                    attempts: num(ex.attempts),
                    completed: num(ex.completed),
                    passed: num(ex.passed),
                    avgPct: ex.avg_pct === null || ex.avg_pct === undefined ? null : Math.round(num(ex.avg_pct) * 10) / 10,
                    avgTime: ex.avg_time === null || ex.avg_time === undefined ? null : Math.round(num(ex.avg_time)),
                    series: examSeries.map((r) => ({ date: r.d, count: num(r.c) })),
                    perExam: perExam.map((r) => ({
                        id: r.id,
                        title: r.title,
                        hskLevel: num(r.hsk_level),
                        formatVersion: num(r.format_version),
                        attempts: num(r.attempts),
                        completed: num(r.completed),
                        passed: num(r.passed),
                        avgPct: r.avg_pct === null || r.avg_pct === undefined ? null : Math.round(num(r.avg_pct) * 10) / 10,
                        avgTime: r.avg_time === null || r.avg_time === undefined ? null : Math.round(num(r.avg_time)),
                    })),
                },
            },
        });
    } catch (error) {
        console.error('admin getAnalytics error:', error);
        res.status(500).json({ success: false, message: 'Lỗi khi tải thống kê' });
    }
};
