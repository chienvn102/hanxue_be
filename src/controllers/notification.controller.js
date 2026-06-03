const db = require('../config/database');

exports.getVapidPublicKey = async (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
};

exports.subscribe = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { endpoint, keys } = req.body || {};
        const p256dh = keys?.p256dh;
        const auth = keys?.auth;

        if (!endpoint || !p256dh || !auth) {
            return res.status(400).json({ success: false, message: 'Invalid push subscription' });
        }

        await db.execute(
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               p256dh = VALUES(p256dh),
               auth = VALUES(auth),
               user_agent = VALUES(user_agent),
               failure_count = 0`,
            [userId, endpoint, p256dh, auth, req.get('user-agent')?.slice(0, 255) || null]
        );

        await db.execute(
            `INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)`,
            [userId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Subscribe push error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.unsubscribe = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { endpoint } = req.body || {};
        if (!endpoint) return res.status(400).json({ success: false, message: 'endpoint required' });
        await db.execute(
            'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
            [userId, endpoint]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Unsubscribe push error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.pending = async (req, res) => {
    try {
        // Try new schema first; fall back to legacy 6-col select if migration 019 not applied.
        try {
            const [rows] = await db.execute(
                `SELECT id, title, body, url, tag, type, icon, read_at, created_at
                   FROM notification_events
                  WHERE user_id = ?
                    AND created_at >= NOW() - INTERVAL 7 DAY
                  ORDER BY created_at DESC
                  LIMIT 50`,
                [req.user.userId]
            );
            return res.json({ success: true, data: rows });
        } catch (e) {
            if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
            const [rows] = await db.execute(
                `SELECT id, title, body, url, tag, read_at, created_at
                   FROM notification_events
                  WHERE user_id = ?
                    AND created_at >= NOW() - INTERVAL 7 DAY
                  ORDER BY created_at DESC
                  LIMIT 50`,
                [req.user.userId]
            );
            return res.json({ success: true, data: rows });
        }
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json({ success: true, data: [] });
        }
        console.error('Pending notifications error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.markAllRead = async (req, res) => {
    try {
        await db.execute(
            `UPDATE notification_events SET read_at = NOW()
              WHERE user_id = ? AND read_at IS NULL`,
            [req.user.userId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Mark all notifications read error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.unreadCount = async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT COUNT(*) AS cnt FROM notification_events
              WHERE user_id = ? AND read_at IS NULL
                AND created_at >= NOW() - INTERVAL 7 DAY`,
            [req.user.userId]
        );
        res.json({ success: true, data: { count: rows[0]?.cnt || 0 } });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: { count: 0 } });
        console.error('Unread count error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.markRead = async (req, res) => {
    try {
        await db.execute(
            `UPDATE notification_events
                SET read_at = NOW()
              WHERE id = ? AND user_id = ?`,
            [req.params.id, req.user.userId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Allowed columns to update via PUT /preferences. Anything not in this list is
// silently ignored — prevents arbitrary column writes.
const PREF_ALLOWED = [
    'daily_reminder_enabled',
    'daily_reminder_time',
    'streak_warning_enabled',
    'level_up_enabled',
    'course_update_enabled',
    'srs_review_push_enabled',
    'srs_review_email_enabled',
];

exports.getPreferences = async (req, res) => {
    try {
        const userId = req.user.userId;
        // Ensure a row exists (defaults from schema).
        await db.execute(
            `INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)`,
            [userId]
        );
        const [rows] = await db.execute(
            `SELECT daily_reminder_enabled, daily_reminder_time, streak_warning_enabled,
                    level_up_enabled, course_update_enabled, timezone,
                    srs_review_push_enabled, srs_review_email_enabled
               FROM notification_preferences WHERE user_id = ?`,
            [userId]
        );
        res.json({ success: true, data: rows[0] || null });
    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updatePreferences = async (req, res) => {
    try {
        const userId = req.user.userId;
        const body = req.body || {};
        const sets = [];
        const params = [];

        for (const key of PREF_ALLOWED) {
            if (body[key] === undefined) continue;
            sets.push(`${key} = ?`);
            // Coerce booleans → 0/1 for TINYINT flags; leave string fields as-is.
            const value = key.endsWith('_enabled') ? (body[key] ? 1 : 0) : body[key];
            params.push(value);
        }

        if (!sets.length) {
            return res.status(400).json({ success: false, message: 'No allowed fields to update' });
        }

        // Ensure row exists, then update.
        await db.execute(
            `INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)`,
            [userId]
        );
        params.push(userId);
        await db.execute(
            `UPDATE notification_preferences SET ${sets.join(', ')} WHERE user_id = ?`,
            params
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
