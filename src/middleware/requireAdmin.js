/**
 * requireAdmin — guard endpoints that operate on user-side auth but require
 * the caller to have role='admin' or 'super_admin' in the users table.
 *
 * Different from src/middleware/admin.middleware.js, which validates a
 * separate admin token (from the admins table). This middleware reuses the
 * user JWT so admin replies live under valid users.id FKs.
 *
 * Use AFTER authMiddleware.
 */

const db = require('../config/database');

module.exports = async (req, res, next) => {
    try {
        if (!req.user?.userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập' });
        }
        const [rows] = await db.execute(
            'SELECT role FROM users WHERE id = ?',
            [req.user.userId]
        );
        const role = rows[0]?.role || 'user';
        if (role !== 'admin' && role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Cần quyền admin' });
        }
        req.user.role = role;
        next();
    } catch (error) {
        console.error('requireAdmin error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
