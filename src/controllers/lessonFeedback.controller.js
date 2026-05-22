/**
 * Lesson feedback endpoints (user + admin).
 *
 * User:
 *   POST   /api/lessons/:id/feedback
 *   GET    /api/lessons/:id/feedback
 *   PUT    /api/lessons/feedback/:fid
 *   DELETE /api/lessons/feedback/:fid
 *
 * Admin (mounted under /api/admin/feedback):
 *   GET    /api/admin/feedback?status=pending&kind=bug
 *   PUT    /api/admin/feedback/:fid/resolve
 *   PUT    /api/admin/feedback/:fid/hide
 *   POST   /api/admin/feedback/:fid/reply   { content }
 *   GET    /api/admin/feedback/bug-count
 */

const model = require('../models/lessonFeedback.model');
const pushService = require('../services/push.service');
const activityLog = require('../services/activityLog.service');
const db = require('../config/database');

async function getUserRole(userId) {
    try {
        const [rows] = await db.execute('SELECT role FROM users WHERE id = ?', [userId]);
        return rows[0]?.role || 'user';
    } catch { return 'user'; }
}

async function notifyAdminsOfBug({ feedbackId, lessonId, preview }) {
    try {
        const [rows] = await db.execute(
            `SELECT id FROM users WHERE role IN ('admin','super_admin') AND is_active = 1`
        );
        await Promise.allSettled(rows.map(r => pushService.pushToUser(r.id, {
            title: 'Báo lỗi bài học mới',
            body: preview.slice(0, 100),
            url: `/admin/feedback`,
            tag: `bug-${feedbackId}`,
            type: 'bug_report',
            icon: 'bug_report',
        })));
    } catch (e) {
        console.error('[feedback] notifyAdminsOfBug failed:', e.message);
    }
}

exports.create = async (req, res) => {
    try {
        const lessonId = parseInt(req.params.id, 10);
        if (!Number.isFinite(lessonId)) {
            return res.status(400).json({ success: false, message: 'lesson id không hợp lệ' });
        }
        const userId = req.user.userId;
        const { kind, sectionType, content, rating, parentId } = req.body || {};

        const fid = await model.create({
            lessonId,
            userId,
            kind,
            sectionType,
            content,
            rating,
            parentId: parentId ? parseInt(parentId, 10) : null,
            isAdminReply: false,
        });

        // Activity log (best-effort)
        activityLog.log(userId, 'feedback_posted', {
            title: 'Bạn đã đăng phản hồi bài học',
            icon: 'forum',
            payload: { lessonId, feedbackId: fid, kind },
        }).catch(() => {});

        // Notify admins on bug reports (fire-and-forget)
        if (kind === 'bug') {
            notifyAdminsOfBug({ feedbackId: fid, lessonId, preview: String(content || '') });
        }

        // If this is a reply, ping the parent's author
        if (parentId) {
            const parent = await model.findById(parentId);
            if (parent && parent.user_id !== userId) {
                pushService.pushToUser(parent.user_id, {
                    title: 'Có người trả lời bình luận của bạn',
                    body: String(content || '').slice(0, 100),
                    url: `/lessons/${lessonId}#feedback-${fid}`,
                    tag: `reply-${fid}`,
                    type: 'feedback_reply',
                    icon: 'forum',
                }).catch(() => {});
            }
        }

        return res.status(201).json({ success: true, data: { id: fid } });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({ success: false, message: 'Tính năng phản hồi chưa được kích hoạt.' });
        }
        console.error('feedback.create error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
};

exports.listByLesson = async (req, res) => {
    try {
        const lessonId = parseInt(req.params.id, 10);
        if (!Number.isFinite(lessonId)) {
            return res.status(400).json({ success: false, message: 'lesson id không hợp lệ' });
        }
        const items = await model.listByLesson(lessonId);
        return res.json({ success: true, data: items });
    } catch (error) {
        console.error('feedback.listByLesson error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.update = async (req, res) => {
    try {
        const fid = parseInt(req.params.fid, 10);
        const userId = req.user.userId;
        const fb = await model.findById(fid);
        if (!fb) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        const role = await getUserRole(userId);
        if (fb.user_id !== userId && role !== 'admin' && role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Không có quyền sửa' });
        }
        await model.updateContent(fid, req.body?.content || '');
        return res.json({ success: true });
    } catch (error) {
        console.error('feedback.update error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
};

exports.remove = async (req, res) => {
    try {
        const fid = parseInt(req.params.fid, 10);
        const userId = req.user.userId;
        const fb = await model.findById(fid);
        if (!fb) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        const role = await getUserRole(userId);
        if (fb.user_id !== userId && role !== 'admin' && role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Không có quyền xoá' });
        }
        await model.softDelete(fid);
        return res.json({ success: true });
    } catch (error) {
        console.error('feedback.remove error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

/* ----------------------- Admin moderation ----------------------- */

exports.adminList = async (req, res) => {
    try {
        const { status = 'pending', kind = null, limit } = req.query;
        const items = await model.listForAdmin({ status, kind, limit });
        return res.json({ success: true, data: items });
    } catch (error) {
        console.error('feedback.adminList error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.adminResolve = async (req, res) => {
    try {
        const fid = parseInt(req.params.fid, 10);
        const resolved = req.body?.resolved !== false;
        await model.setResolved(fid, resolved);
        return res.json({ success: true });
    } catch (error) {
        console.error('feedback.adminResolve error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.adminHide = async (req, res) => {
    try {
        const fid = parseInt(req.params.fid, 10);
        const hidden = req.body?.hidden !== false;
        await model.setHidden(fid, hidden);
        return res.json({ success: true });
    } catch (error) {
        console.error('feedback.adminHide error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Admin reply — creates a new lesson_feedback row as a reply to `fid`.
 * Uses the calling admin's user_id, marks `is_admin_reply = 1`.
 * Notifies the original author via push.
 */
exports.adminReply = async (req, res) => {
    try {
        const fid = parseInt(req.params.fid, 10);
        // Admin endpoints use user authMiddleware + role check (see route file).
        // req.user.userId is a valid users.id, safe to use as FK author.
        const adminUserId = req.user?.userId;
        if (!adminUserId) return res.status(401).json({ success: false, message: 'Cần đăng nhập' });
        const content = String(req.body?.content || '').trim();
        if (!content) return res.status(400).json({ success: false, message: 'Nội dung trả lời trống' });

        const parent = await model.findById(fid);
        if (!parent) return res.status(404).json({ success: false, message: 'Không tìm thấy phản hồi gốc' });

        const replyId = await model.create({
            lessonId: parent.lesson_id,
            userId: adminUserId,
            kind: 'comment',
            sectionType: parent.section_type,
            content,
            parentId: fid,
            isAdminReply: true,
        });

        // Auto-mark parent as resolved when admin replies
        await model.setResolved(fid, true);

        // Notify the original author
        pushService.pushToUser(parent.user_id, {
            title: 'Admin trả lời phản hồi của bạn',
            body: content.slice(0, 100),
            url: `/lessons/${parent.lesson_id}#feedback-${replyId}`,
            tag: `admin-reply-${replyId}`,
            type: 'feedback_reply',
            icon: 'forum',
        }).catch(() => {});

        return res.status(201).json({ success: true, data: { id: replyId } });
    } catch (error) {
        console.error('feedback.adminReply error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
};

exports.bugCount = async (req, res) => {
    try {
        const cnt = await model.pendingBugCount();
        return res.json({ success: true, data: { count: cnt } });
    } catch (error) {
        console.error('feedback.bugCount error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
