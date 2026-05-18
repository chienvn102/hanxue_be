/**
 * Notification scheduler.
 *
 * Runs daily cron jobs that:
 *   20:00 (Asia/Ho_Chi_Minh) — streak reminder for users with active streak
 *                              who haven't studied today.
 *   22:30                    — last-chance streak save for the same cohort.
 *   21:00                    — SRS-overdue alert (≥10 cards due).
 *
 * The cron is started by src/index.js on boot. Safe to no-op if node-cron
 * isn't installed yet (logged warning, no crash).
 */

const db = require('../config/database');
const pushService = require('./push.service');

let cron;
try {
    cron = require('node-cron');
} catch {
    cron = null;
}

const TIMEZONE = process.env.SCHEDULER_TIMEZONE || 'Asia/Ho_Chi_Minh';

/** Users with active streak who haven't studied today. */
async function getStreakAtRiskUsers() {
    try {
        const [rows] = await db.execute(
            `SELECT id, current_streak FROM users
              WHERE is_active = 1
                AND current_streak >= 1
                AND (last_study_date IS NULL OR last_study_date < CURDATE())`
        );
        return rows;
    } catch (error) {
        console.error('[scheduler] getStreakAtRiskUsers failed:', error.message);
        return [];
    }
}

async function pushStreakReminder({ urgent } = {}) {
    const users = await getStreakAtRiskUsers();
    if (!users.length) return;
    console.log(`[scheduler] streak${urgent ? '-save' : '-reminder'}: ${users.length} users`);

    const title = urgent ? 'Streak sắp mất!' : 'Đừng để mất streak nhé!';
    await Promise.allSettled(users.map(u => pushService.pushToUser(u.id, {
        title,
        body: urgent
            ? `Còn vài phút nữa thôi — học 1 bài ngắn để giữ chuỗi ${u.current_streak} ngày của bạn.`
            : `Bạn đang có chuỗi ${u.current_streak} ngày — học 5 phút ngay để giữ chuỗi.`,
        url: '/practice',
        tag: urgent ? 'streak-save' : 'streak-reminder',
        type: urgent ? 'streak_save' : 'streak_reminder',
        icon: 'local_fire_department',
    })));
}

async function pushSrsOverdueReminder() {
    try {
        // Reuse SRS schema if available. If srs_reviews table missing, no-op.
        const [rows] = await db.execute(
            `SELECT user_id, COUNT(*) AS due_cnt
               FROM srs_reviews
              WHERE next_review_at <= NOW()
              GROUP BY user_id
             HAVING due_cnt >= 10`
        );
        console.log(`[scheduler] SRS overdue reminder: ${rows.length} users`);
        await Promise.allSettled(rows.map(r => pushService.pushToUser(r.user_id, {
            title: `Có ${r.due_cnt} từ chờ ôn`,
            body: 'Ôn ngay để củng cố trí nhớ — chỉ 5 phút là xong.',
            url: '/flashcard',
            tag: 'srs-overdue',
            type: 'srs_overdue',
            icon: 'replay',
        })));
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return;
        console.error('[scheduler] SRS overdue failed:', error.message);
    }
}

let started = false;

function start() {
    if (started) return;
    if (!cron) {
        console.warn('[scheduler] node-cron not installed — scheduled notifications disabled. Run: npm install');
        return;
    }
    started = true;

    const opts = { timezone: TIMEZONE };

    // 20:00 — gentle streak reminder
    cron.schedule('0 20 * * *', () => {
        pushStreakReminder({ urgent: false }).catch(e =>
            console.error('[scheduler] 20:00 job failed:', e.message)
        );
    }, opts);

    // 22:30 — last-chance save
    cron.schedule('30 22 * * *', () => {
        pushStreakReminder({ urgent: true }).catch(e =>
            console.error('[scheduler] 22:30 job failed:', e.message)
        );
    }, opts);

    // 21:00 — SRS overdue
    cron.schedule('0 21 * * *', () => {
        pushSrsOverdueReminder().catch(e =>
            console.error('[scheduler] 21:00 job failed:', e.message)
        );
    }, opts);

    console.log(`[scheduler] Cron jobs started (tz=${TIMEZONE})`);
}

module.exports = {
    start,
    // Exposed for manual triggers / testing
    pushStreakReminder,
    pushSrsOverdueReminder,
};
