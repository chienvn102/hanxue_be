/**
 * Activity log read endpoints.
 * Writes happen inline in other services via activityLog.service.log().
 */

const activityLog = require('../services/activityLog.service');

exports.recent = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const eventType = typeof req.query.type === 'string' ? req.query.type : null;
        const items = await activityLog.recent(req.user.userId, { limit, eventType });
        res.json({ success: true, data: items });
    } catch (error) {
        console.error('activity.recent error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
