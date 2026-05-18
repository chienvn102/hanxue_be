/**
 * activity_log writer + reader.
 *
 * Other services (streak, xp, course completion, exam submit) call `log(...)`
 * after their primary side-effect succeeds. Failures here MUST NOT propagate —
 * activity log is an audit/timeline, not a transactional concern.
 *
 * Recognised event_type values (kept in sync with EVENT_DEFS):
 *   lesson_complete, exam_submit, vocab_mastered, streak_milestone,
 *   xp_milestone, level_up, notebook_add, pronunciation_session,
 *   achievement_unlocked
 */

const db = require('../config/database');

const EVENT_DEFS = {
    lesson_complete: { icon: 'school' },
    exam_submit: { icon: 'quiz' },
    vocab_mastered: { icon: 'auto_stories' },
    streak_milestone: { icon: 'local_fire_department' },
    xp_milestone: { icon: 'bolt' },
    level_up: { icon: 'workspace_premium' },
    notebook_add: { icon: 'bookmark_add' },
    pronunciation_session: { icon: 'mic' },
    achievement_unlocked: { icon: 'emoji_events' },
};

/**
 * Best-effort insert. Returns inserted id or null on any failure.
 * @param {number} userId
 * @param {string} eventType
 * @param {{ title?: string, icon?: string, payload?: object }} opts
 */
async function log(userId, eventType, { title = null, icon = null, payload = null } = {}) {
    try {
        const def = EVENT_DEFS[eventType] || {};
        const finalIcon = icon || def.icon || null;
        const json = payload && typeof payload === 'object' ? JSON.stringify(payload) : null;
        const [result] = await db.execute(
            `INSERT INTO activity_log (user_id, event_type, title, icon, payload)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, eventType, title, finalIcon, json]
        );
        return result.insertId;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return null; // pre-migration
        console.error('[activityLog] insert failed:', error.message);
        return null;
    }
}

/**
 * Fetch recent activity for a user.
 * @returns {Promise<Array<{id, eventType, title, icon, payload, createdAt}>>}
 */
async function recent(userId, { limit = 20, eventType = null } = {}) {
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    try {
        let query = `SELECT id, event_type, title, icon, payload, created_at
                       FROM activity_log
                      WHERE user_id = ?`;
        const params = [userId];
        if (eventType) {
            query += ' AND event_type = ?';
            params.push(eventType);
        }
        query += ` ORDER BY created_at DESC LIMIT ${safeLimit}`;
        const [rows] = await db.execute(query, params);
        return rows.map(r => ({
            id: r.id,
            eventType: r.event_type,
            title: r.title,
            icon: r.icon,
            payload: parsePayload(r.payload),
            createdAt: r.created_at,
        }));
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return [];
        throw error;
    }
}

function parsePayload(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw; // mysql2 may parse JSON columns
    try { return JSON.parse(raw); } catch { return null; }
}

module.exports = { log, recent };
