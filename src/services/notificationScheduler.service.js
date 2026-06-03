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
const emailService = require('./email.service');

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

/**
 * SRS due reminder — unions 3 progress sources (vocab + grammar + writing),
 * filters by per-user preference flags, then dispatches push + (optional)
 * email. Threshold: ≥5 items combined.
 */
async function pushSrsOverdueReminder() {
    try {
        const [rows] = await db.execute(
            `SELECT t.user_id,
                    SUM(t.c) AS due_cnt,
                    SUM(IF(t.src='vocab',   t.c, 0)) AS vocab_due,
                    SUM(IF(t.src='grammar', t.c, 0)) AS grammar_due,
                    SUM(IF(t.src='writing', t.c, 0)) AS writing_due,
                    COALESCE(p.srs_review_push_enabled,  1) AS push_enabled,
                    COALESCE(p.srs_review_email_enabled, 0) AS email_enabled,
                    u.email, u.display_name
               FROM (
                 SELECT user_id, COUNT(*) c, 'vocab' AS src
                   FROM user_vocabulary_progress
                  WHERE next_review IS NOT NULL AND next_review <= NOW()
                  GROUP BY user_id
                 UNION ALL
                 SELECT user_id, COUNT(*) c, 'grammar' AS src
                   FROM user_grammar_progress
                  WHERE next_review_at IS NOT NULL AND next_review_at <= NOW()
                  GROUP BY user_id
                 UNION ALL
                 SELECT user_id, COUNT(*) c, 'writing' AS src
                   FROM writing_progress
                  WHERE next_review_at IS NOT NULL AND next_review_at <= NOW()
                  GROUP BY user_id
               ) t
               JOIN users u ON u.id = t.user_id AND u.is_active = 1
          LEFT JOIN notification_preferences p ON p.user_id = t.user_id
              GROUP BY t.user_id
             HAVING due_cnt >= 5`
        );

        console.log(`[scheduler] SRS due reminder: ${rows.length} users`);

        await Promise.allSettled(rows.map(async (r) => {
            const dueCnt = Number(r.due_cnt);
            const breakdown = {
                vocab: Number(r.vocab_due) || 0,
                grammar: Number(r.grammar_due) || 0,
                writing: Number(r.writing_due) || 0,
            };
            const parts = [];
            if (breakdown.vocab)   parts.push(`${breakdown.vocab} từ`);
            if (breakdown.grammar) parts.push(`${breakdown.grammar} ngữ pháp`);
            if (breakdown.writing) parts.push(`${breakdown.writing} chữ`);
            const body = parts.length
                ? `${parts.join(' + ')} chờ ôn — vào ôn 5 phút để giữ trí nhớ.`
                : 'Có mục chờ ôn — vào ôn 5 phút để giữ trí nhớ.';

            const jobs = [];
            if (Number(r.push_enabled) === 1) {
                jobs.push(pushService.pushToUser(r.user_id, {
                    title: `Có ${dueCnt} mục chờ ôn tập`,
                    body,
                    url: '/practice',
                    tag: 'srs-review-reminder',
                    type: 'srs_review',
                    icon: 'replay',
                }));
            }
            if (Number(r.email_enabled) === 1 && r.email) {
                jobs.push(emailService.sendSrsDueEmail({
                    email: r.email,
                    displayName: r.display_name,
                }, { dueCount: dueCnt, breakdown }).catch(e =>
                    console.error(`[scheduler] SRS email failed user=${r.user_id}:`, e.message)
                ));
            }
            await Promise.allSettled(jobs);
        }));
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return;
        console.error('[scheduler] SRS due failed:', error.message);
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
