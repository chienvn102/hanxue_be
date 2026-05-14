/**
 * Leaderboard Controller
 *
 * GET /api/leaderboard?period=all|week|month&hsk=&limit=
 */

const db = require('../config/database');

const PERIOD_DAYS = {
    week: 7,
    month: 30,
};

function formatRank(row, rank, me) {
    return {
        rank,
        id: row.id,
        displayName: row.display_name || 'Hoc vien',
        avatarUrl: row.avatar_url || null,
        targetHsk: row.target_hsk || null,
        totalXp: Number(row.total_xp || 0),
        currentStreak: Number(row.current_streak || 0),
        longestStreak: Number(row.longest_streak || 0),
        totalStudyDays: Number(row.total_study_days || 0),
        isMe: me !== null && row.id === me,
    };
}

async function getPeriodXp(userId, period) {
    const days = PERIOD_DAYS[period];
    if (!days) return null;
    const [rows] = await db.execute(
        `SELECT COALESCE(SUM(amount), 0) AS xp
           FROM xp_history
          WHERE user_id = ?
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [userId, days]
    );
    return Number(rows[0]?.xp || 0);
}

async function getUserRow(userId) {
    const [rows] = await db.execute(
        `SELECT id, display_name, avatar_url, target_hsk,
                COALESCE(total_xp, 0) AS total_xp,
                COALESCE(current_streak, 0) AS current_streak,
                COALESCE(longest_streak, 0) AS longest_streak,
                COALESCE(total_study_days, 0) AS total_study_days
           FROM users
          WHERE id = ?`,
        [userId]
    );
    return rows[0] || null;
}

async function getUserRank({ userId, period, hsk, totalXp, longestStreak }) {
    const params = [totalXp, totalXp, longestStreak, totalXp, longestStreak, userId];
    let sql;

    if (period === 'all') {
        sql = `
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
        if (hsk && hsk >= 1 && hsk <= 6) {
            sql += ' AND target_hsk = ?';
            params.push(hsk);
        }
    } else {
        const days = PERIOD_DAYS[period];
        sql = `
            SELECT COUNT(*) + 1 AS my_rank
              FROM (
                SELECT u.id, u.target_hsk,
                       COALESCE(SUM(xh.amount), 0) AS total_xp,
                       COALESCE(u.longest_streak, 0) AS longest_streak
                  FROM users u
                  JOIN xp_history xh ON xh.user_id = u.id
                   AND xh.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 WHERE u.is_active = TRUE
                 GROUP BY u.id
              ) ranked_users
             WHERE (
                    total_xp > ?
                 OR (total_xp = ? AND longest_streak > ?)
                 OR (total_xp = ? AND longest_streak = ? AND id < ?)
               )
        `;
        params.unshift(days);
        if (hsk && hsk >= 1 && hsk <= 6) {
            sql += ' AND target_hsk = ?';
            params.push(hsk);
        }
    }

    const [rows] = await db.execute(sql, params);
    return Number(rows[0]?.my_rank || 0);
}

async function getLeaderboard(req, res) {
    try {
        const period = ['all', 'week', 'month'].includes(req.query.period) ? req.query.period : 'all';
        const hsk = req.query.hsk ? parseInt(req.query.hsk, 10) : null;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const me = req.user?.userId || null;
        const params = [];
        let sql;

        if (period === 'all') {
            sql = `
                SELECT id, display_name, avatar_url, target_hsk,
                       COALESCE(total_xp, 0) AS total_xp,
                       COALESCE(current_streak, 0) AS current_streak,
                       COALESCE(longest_streak, 0) AS longest_streak,
                       COALESCE(total_study_days, 0) AS total_study_days
                  FROM users
                 WHERE is_active = TRUE
                   AND COALESCE(total_xp, 0) > 0
            `;
            if (hsk && hsk >= 1 && hsk <= 6) {
                sql += ' AND target_hsk = ?';
                params.push(hsk);
            }
            sql += ' ORDER BY total_xp DESC, longest_streak DESC, id ASC LIMIT ?';
            params.push(limit);
        } else {
            const days = PERIOD_DAYS[period];
            sql = `
                SELECT u.id, u.display_name, u.avatar_url, u.target_hsk,
                       COALESCE(SUM(xh.amount), 0) AS total_xp,
                       COALESCE(u.current_streak, 0) AS current_streak,
                       COALESCE(u.longest_streak, 0) AS longest_streak,
                       COALESCE(u.total_study_days, 0) AS total_study_days
                  FROM users u
                  JOIN xp_history xh ON xh.user_id = u.id
                   AND xh.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 WHERE u.is_active = TRUE
            `;
            params.push(days);
            if (hsk && hsk >= 1 && hsk <= 6) {
                sql += ' AND u.target_hsk = ?';
                params.push(hsk);
            }
            sql += ' GROUP BY u.id ORDER BY total_xp DESC, longest_streak DESC, u.id ASC LIMIT ?';
            params.push(limit);
        }

        let rows;
        try {
            [rows] = await db.execute(sql, params);
        } catch (error) {
            if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
            return res.status(500).json({
                success: false,
                message: 'xp_history table missing. Run migration 010_xp_history.sql.',
            });
        }

        const ranked = rows.map((row, index) => formatRank(row, index + 1, me));

        let mePosition = null;
        if (me !== null && !ranked.some(r => r.isMe)) {
            const meRow = await getUserRow(me);
            if (meRow) {
                const includeMe = !hsk || (hsk >= 1 && hsk <= 6 && Number(meRow.target_hsk) === hsk);
                if (includeMe) {
                    const meXp = period === 'all' ? Number(meRow.total_xp || 0) : await getPeriodXp(me, period);
                    if (meXp > 0) {
                        meRow.total_xp = meXp;
                        const rank = await getUserRank({
                            userId: me,
                            period,
                            hsk,
                            totalXp: meXp,
                            longestStreak: Number(meRow.longest_streak || 0),
                        });
                        mePosition = formatRank(meRow, rank, me);
                    }
                }
            }
        }

        return res.json({
            success: true,
            data: {
                period,
                periodIsFallback: false,
                ranking: ranked,
                me: mePosition,
            },
        });
    } catch (err) {
        console.error('Leaderboard error:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch leaderboard' });
    }
}

module.exports = { getLeaderboard };
