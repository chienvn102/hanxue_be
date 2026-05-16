const db = require('../config/database');

const ORDER_MAP = {
    created_at_desc: 'u.created_at DESC',
    created_at_asc: 'u.created_at ASC',
    xp_desc: 'u.total_xp DESC',
    streak_desc: 'u.current_streak DESC',
    last_active_desc: 'u.last_study_date DESC',
    email_asc: 'u.email ASC',
};

exports.listUsers = async (req, res) => {
    try {
        const {
            search = '',
            hsk,
            role,
            xpMin,
            xpMax,
            registeredAfter,
            sort = 'created_at_desc',
            page = 1,
            limit = 20,
        } = req.query;

        const where = ['1=1'];
        const params = [];

        if (search && String(search).trim()) {
            const like = `%${String(search).trim()}%`;
            where.push('(u.email LIKE ? OR u.display_name LIKE ?)');
            params.push(like, like);
        }
        if (hsk) { where.push('u.target_hsk = ?'); params.push(parseInt(hsk, 10)); }
        if (role === 'user' || role === 'admin') { where.push('u.role = ?'); params.push(role); }
        if (xpMin !== undefined && xpMin !== '') { where.push('u.total_xp >= ?'); params.push(parseInt(xpMin, 10) || 0); }
        if (xpMax !== undefined && xpMax !== '') { where.push('u.total_xp <= ?'); params.push(parseInt(xpMax, 10) || 0); }
        if (registeredAfter) { where.push('u.created_at >= ?'); params.push(registeredAfter); }

        const orderBy = ORDER_MAP[sort] || ORDER_MAP.created_at_desc;
        const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const pg = Math.max(1, parseInt(page, 10) || 1);
        const offset = (pg - 1) * lim;

        const whereSql = where.join(' AND ');

        const [rows] = await db.execute(
            `SELECT u.id, u.email, u.display_name, u.avatar_url, u.role, u.target_hsk,
                    u.total_xp, u.current_streak, u.longest_streak, u.total_study_days,
                    u.last_study_date, u.created_at, u.is_premium, u.email_verified,
                    u.is_active
               FROM users u
              WHERE ${whereSql}
              ORDER BY ${orderBy}
              LIMIT ? OFFSET ?`,
            [...params, lim, offset]
        );

        const [[countRow]] = await db.execute(
            `SELECT COUNT(*) AS total FROM users u WHERE ${whereSql}`,
            params
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                page: pg,
                limit: lim,
                total: Number(countRow?.total || 0),
                totalPages: Math.ceil(Number(countRow?.total || 0) / lim),
            },
        });
    } catch (err) {
        console.error('admin listUsers error:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách người dùng' });
    }
};

exports.getUserStats = async (req, res) => {
    try {
        const [[stats]] = await db.execute(`
            SELECT
              COUNT(*) AS total_users,
              SUM(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS new_7d,
              SUM(CASE WHEN created_at >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS new_30d,
              SUM(CASE WHEN last_study_date >= CURDATE() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS active_7d,
              SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_count,
              SUM(CASE WHEN is_premium = TRUE THEN 1 ELSE 0 END) AS premium_count
              FROM users
        `);
        const [byHsk] = await db.execute(
            'SELECT target_hsk, COUNT(*) AS cnt FROM users WHERE target_hsk IS NOT NULL GROUP BY target_hsk ORDER BY target_hsk'
        );
        res.json({
            success: true,
            data: {
                total_users: Number(stats?.total_users || 0),
                new_7d: Number(stats?.new_7d || 0),
                new_30d: Number(stats?.new_30d || 0),
                active_7d: Number(stats?.active_7d || 0),
                admin_count: Number(stats?.admin_count || 0),
                premium_count: Number(stats?.premium_count || 0),
                byHsk: byHsk.map(r => ({ target_hsk: r.target_hsk, count: Number(r.cnt) })),
            },
        });
    } catch (err) {
        console.error('admin getUserStats error:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi tải thống kê người dùng' });
    }
};
