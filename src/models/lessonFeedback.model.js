/**
 * lesson_feedback model.
 *
 * All queries swallow ER_NO_SUCH_TABLE so the app keeps booting before the
 * operator runs 020_lesson_feedback.sql.
 *
 * `depth` is computed at insert time from parent.depth + 1 (or 0 if root).
 */

const db = require('../config/database');

const MAX_CONTENT_LEN = 2000;

function sanitizeContent(raw) {
    return String(raw || '').trim().slice(0, MAX_CONTENT_LEN);
}

async function create({ lessonId, userId, kind, sectionType, content, rating, parentId, isAdminReply }) {
    const safeKind = ['comment', 'feedback', 'bug'].includes(kind) ? kind : 'comment';
    const safeSection = ['vocab', 'passage', 'grammar', 'writing'].includes(sectionType) ? sectionType : null;
    const safeContent = sanitizeContent(content);
    if (!safeContent) throw new Error('Nội dung không được để trống');
    const safeRating = (rating == null) ? null : Math.max(1, Math.min(5, parseInt(rating, 10) || 1));
    const adminFlag = isAdminReply ? 1 : 0;

    let depth = 0;
    let validParentId = null;
    if (parentId) {
        const [parentRows] = await db.execute(
            'SELECT id, lesson_id, depth FROM lesson_feedback WHERE id = ?',
            [parentId]
        );
        const parent = parentRows[0];
        if (parent && parent.lesson_id === lessonId) {
            validParentId = parent.id;
            depth = Math.min(20, (parent.depth || 0) + 1);
        }
    }

    const [result] = await db.execute(
        `INSERT INTO lesson_feedback
           (lesson_id, user_id, kind, section_type, content, rating, parent_id, depth, is_admin_reply)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lessonId, userId, safeKind, safeSection, safeContent, safeRating, validParentId, depth, adminFlag]
    );
    return result.insertId;
}

async function listByLesson(lessonId, { limit = 200, includeHidden = false } = {}) {
    const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
    const hiddenClause = includeHidden ? '' : 'AND lf.is_hidden = 0';
    try {
        const [rows] = await db.execute(
            `SELECT lf.id, lf.lesson_id, lf.user_id, lf.kind, lf.section_type, lf.content,
                    lf.rating, lf.parent_id, lf.depth, lf.is_resolved, lf.is_hidden,
                    lf.is_admin_reply, lf.created_at, lf.updated_at,
                    u.display_name, u.avatar_url, u.role
               FROM lesson_feedback lf
               JOIN users u ON u.id = lf.user_id
              WHERE lf.lesson_id = ?
                ${hiddenClause}
              ORDER BY lf.parent_id ASC, lf.created_at ASC
              LIMIT ${safeLimit}`,
            [lessonId]
        );
        return rows;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return [];
        throw error;
    }
}

async function listForAdmin({ status = 'pending', kind = null, limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 100));
    const conds = ['lf.is_hidden = 0'];
    if (status === 'pending') conds.push('lf.is_resolved = 0');
    else if (status === 'resolved') conds.push('lf.is_resolved = 1');
    const params = [];
    if (kind && ['comment', 'feedback', 'bug'].includes(kind)) {
        conds.push('lf.kind = ?');
        params.push(kind);
    }
    try {
        const [rows] = await db.execute(
            `SELECT lf.id, lf.lesson_id, lf.user_id, lf.kind, lf.section_type, lf.content,
                    lf.rating, lf.parent_id, lf.is_resolved, lf.created_at,
                    u.display_name, u.avatar_url, u.role,
                    l.title AS lesson_title
               FROM lesson_feedback lf
               JOIN users u ON u.id = lf.user_id
               JOIN lessons l ON l.id = lf.lesson_id
              WHERE ${conds.join(' AND ')}
              ORDER BY lf.created_at DESC
              LIMIT ${safeLimit}`,
            params
        );
        return rows;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return [];
        throw error;
    }
}

async function findById(id) {
    try {
        const [rows] = await db.execute(
            'SELECT * FROM lesson_feedback WHERE id = ?',
            [id]
        );
        return rows[0] || null;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return null;
        throw error;
    }
}

async function updateContent(id, content) {
    const safe = sanitizeContent(content);
    if (!safe) throw new Error('Nội dung không được để trống');
    await db.execute(
        'UPDATE lesson_feedback SET content = ? WHERE id = ?',
        [safe, id]
    );
}

async function softDelete(id) {
    await db.execute(
        `UPDATE lesson_feedback SET is_hidden = 1, content = '[đã xoá]' WHERE id = ?`,
        [id]
    );
}

async function setResolved(id, resolved) {
    await db.execute(
        'UPDATE lesson_feedback SET is_resolved = ? WHERE id = ?',
        [resolved ? 1 : 0, id]
    );
}

async function setHidden(id, hidden) {
    await db.execute(
        'UPDATE lesson_feedback SET is_hidden = ? WHERE id = ?',
        [hidden ? 1 : 0, id]
    );
}

async function pendingBugCount() {
    try {
        const [rows] = await db.execute(
            `SELECT COUNT(*) AS cnt
               FROM lesson_feedback
              WHERE is_resolved = 0 AND is_hidden = 0 AND kind = 'bug'`
        );
        return rows[0]?.cnt || 0;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return 0;
        throw error;
    }
}

module.exports = {
    create,
    listByLesson,
    listForAdmin,
    findById,
    updateContent,
    softDelete,
    setResolved,
    setHidden,
    pendingBugCount,
};
