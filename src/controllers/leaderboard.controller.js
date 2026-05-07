/**
 * Leaderboard Controller
 *
 * GET /api/leaderboard?period=all|week|month&hsk=&limit=
 *
 * Period filter hiện chỉ "all" được hỗ trợ chính xác — week/month yêu cầu
 * activity log per-day (chưa có table riêng). Nếu period=week|month, BE vẫn
 * trả về toàn bộ ranking (all-time) kèm cờ `period: 'all_fallback'` để FE
 * hiển thị note. Khi nào có table user_daily_activity thì plugin vào.
 */

const db = require('../config/database');

async function getLeaderboard(req, res) {
    try {
        const period = ['all', 'week', 'month'].includes(req.query.period) ? req.query.period : 'all';
        const hsk = req.query.hsk ? parseInt(req.query.hsk) : null;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const me = req.user?.userId || null;

        // Ranking metric: total_xp (đã được streak.service.addXP cộng từ flashcard
        // reviews + lesson completion). Mở rộng sau bằng cách aggregate từ activity log.
        let sql = `
            SELECT
                id, display_name, avatar_url, target_hsk,
                COALESCE(total_xp, 0) AS total_xp,
                COALESCE(current_streak, 0) AS current_streak,
                COALESCE(longest_streak, 0) AS longest_streak,
                COALESCE(total_study_days, 0) AS total_study_days
            FROM users
            WHERE is_active = TRUE
              AND COALESCE(total_xp, 0) > 0
        `;
        const params = [];

        if (hsk && hsk >= 1 && hsk <= 6) {
            sql += ' AND target_hsk = ?';
            params.push(hsk);
        }

        sql += ' ORDER BY total_xp DESC, longest_streak DESC, id ASC LIMIT ?';
        params.push(limit);

        const [rows] = await db.execute(sql, params);

        const ranked = rows.map((r, i) => ({
            rank: i + 1,
            id: r.id,
            displayName: r.display_name || 'Học viên',
            avatarUrl: r.avatar_url || null,
            targetHsk: r.target_hsk || null,
            totalXp: Number(r.total_xp),
            currentStreak: Number(r.current_streak),
            longestStreak: Number(r.longest_streak),
            totalStudyDays: Number(r.total_study_days),
            isMe: me !== null && r.id === me,
        }));

        // Nếu user gọi authenticated nhưng không nằm trong top → trả thêm
        // entry "me" để FE hiển thị vị trí riêng phía dưới.
        let mePosition = null;
        if (me !== null && !ranked.some(r => r.isMe)) {
            const [meRows] = await db.execute(
                `SELECT id, display_name, avatar_url, target_hsk,
                        COALESCE(total_xp, 0) AS total_xp,
                        COALESCE(current_streak, 0) AS current_streak,
                        COALESCE(longest_streak, 0) AS longest_streak,
                        COALESCE(total_study_days, 0) AS total_study_days
                   FROM users WHERE id = ?`,
                [me]
            );
            if (meRows[0]) {
                const u = meRows[0];
                // Rank consistent với list sort: total_xp DESC, longest_streak DESC, id ASC.
                // Cùng filter (hsk, is_active) như query chính. Cho user lọc HSK 3
                // mà user "me" có target_hsk khác → mePosition = null (không có rank
                // trong context filter đó).
                const includeMe = !hsk || (hsk >= 1 && hsk <= 6 && Number(u.target_hsk) === hsk);
                if (includeMe) {
                    let rankSql = `
                        SELECT COUNT(*) + 1 AS my_rank
                          FROM users
                         WHERE is_active = TRUE
                           AND COALESCE(total_xp, 0) > 0
                           AND (
                                COALESCE(total_xp, 0) > ?
                             OR (COALESCE(total_xp, 0) = ? AND COALESCE(longest_streak, 0) > ?)
                             OR (COALESCE(total_xp, 0) = ? AND COALESCE(longest_streak, 0) = ? AND id < ?)
                           )
                    `;
                    const rankParams = [
                        u.total_xp,
                        u.total_xp, u.longest_streak,
                        u.total_xp, u.longest_streak, u.id,
                    ];
                    if (hsk && hsk >= 1 && hsk <= 6) {
                        rankSql += ' AND target_hsk = ?';
                        rankParams.push(hsk);
                    }
                    const [rankCountRows] = await db.execute(rankSql, rankParams);
                    mePosition = {
                        rank: Number(rankCountRows[0]?.my_rank || 0),
                        id: u.id,
                        displayName: u.display_name || 'Bạn',
                        avatarUrl: u.avatar_url,
                        targetHsk: u.target_hsk,
                        totalXp: Number(u.total_xp),
                        currentStreak: Number(u.current_streak),
                        longestStreak: Number(u.longest_streak),
                        totalStudyDays: Number(u.total_study_days),
                        isMe: true,
                    };
                }
            }
        }

        res.json({
            success: true,
            data: {
                period,
                periodIsFallback: period !== 'all',
                ranking: ranked,
                me: mePosition,
            },
        });
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch leaderboard' });
    }
}

module.exports = { getLeaderboard };
