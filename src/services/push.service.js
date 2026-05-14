const webpush = require('web-push');
const db = require('../config/database');

function isConfigured() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureWebPush() {
    if (!isConfigured()) return false;
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@hanxue.io.vn',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    return true;
}

async function createNotification(userId, { title, body, url = '/', tag = null }) {
    try {
        const [result] = await db.execute(
            `INSERT INTO notification_events (user_id, title, body, url, tag)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, title, body, url, tag]
        );
        return result.insertId;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return null;
        throw error;
    }
}

async function pushToUser(userId, payload) {
    const eventId = await createNotification(userId, payload);
    if (!configureWebPush()) return { configured: false, sent: 0, failed: 0, eventId };

    let rows = [];
    try {
        [rows] = await db.execute(
            'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
            [userId]
        );
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return { configured: true, sent: 0, failed: 0, eventId };
        throw error;
    }

    let sent = 0;
    let failed = 0;
    await Promise.allSettled(rows.map(async (sub) => {
        try {
            await webpush.sendNotification(
                {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth },
                },
                JSON.stringify({
                    title: payload.title,
                    body: payload.body,
                    url: payload.url || '/',
                    tag: payload.tag,
                    icon: payload.icon || '/icon.svg',
                })
            );
            sent += 1;
            await db.execute(
                'UPDATE push_subscriptions SET last_used_at = NOW(), failure_count = 0 WHERE id = ?',
                [sub.id]
            );
        } catch (error) {
            failed += 1;
            if (error.statusCode === 404 || error.statusCode === 410) {
                await db.execute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
            } else {
                await db.execute(
                    'UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?',
                    [sub.id]
                );
            }
        }
    }));

    if (sent > 0 && eventId) {
        await db.execute('UPDATE notification_events SET pushed_at = NOW() WHERE id = ?', [eventId]);
    }

    return { configured: true, sent, failed, eventId };
}

async function notifyLevelUp(userId, level) {
    return pushToUser(userId, {
        title: `Mo khoa HSK ${level}`,
        body: `Ban da du dieu kien hoc tiep HSK ${level + 1}.`,
        url: '/profile',
        tag: `level-up-${level}`,
    });
}

async function notifyCourseLessonAdded(courseId) {
    try {
        const [rows] = await db.execute(
            `SELECT cc.user_id, c.title
               FROM course_completions cc
               JOIN courses c ON c.id = cc.course_id
              WHERE cc.course_id = ? AND cc.completed_at IS NOT NULL`,
            [courseId]
        );
        await Promise.allSettled(rows.map(row => pushToUser(row.user_id, {
            title: 'Khoa hoc co bai moi',
            body: `Khoa "${row.title}" co bai moi. Hoc tiep de giu tien do.`,
            url: `/courses/${courseId}`,
            tag: `course-${courseId}-new-lesson`,
        })));
    } catch (error) {
        if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    }
}

module.exports = {
    isConfigured,
    pushToUser,
    notifyLevelUp,
    notifyCourseLessonAdded,
};
