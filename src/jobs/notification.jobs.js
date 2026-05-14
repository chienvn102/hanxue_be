const db = require('../config/database');
const pushService = require('../services/push.service');

async function runDailyReminder() {
    const [rows] = await db.execute(
        `SELECT u.id, COALESCE(u.daily_goal_mins, 15) AS daily_goal_mins
           FROM users u
           JOIN notification_preferences np ON np.user_id = u.id
           LEFT JOIN daily_activity da
                  ON da.user_id = u.id AND da.activity_date = CURDATE()
          WHERE u.is_active = TRUE
            AND np.daily_reminder_enabled = TRUE
            AND COALESCE(da.study_mins, 0) < COALESCE(u.daily_goal_mins, 15)
          LIMIT 500`
    );

    await Promise.allSettled(rows.map(row => pushService.pushToUser(row.id, {
        title: 'Toi gio hoc roi',
        body: `Hoan thanh muc tieu ${row.daily_goal_mins} phut hom nay nhe.`,
        url: '/practice',
        tag: 'daily-reminder',
    })));
}

async function runStreakWarning() {
    const [rows] = await db.execute(
        `SELECT u.id, u.current_streak
           FROM users u
           JOIN notification_preferences np ON np.user_id = u.id
          WHERE u.is_active = TRUE
            AND np.streak_warning_enabled = TRUE
            AND u.current_streak >= 3
            AND (u.last_study_date IS NULL OR u.last_study_date < CURDATE())
          LIMIT 500`
    );

    await Promise.allSettled(rows.map(row => pushService.pushToUser(row.id, {
        title: `Streak ${row.current_streak} ngay sap dut`,
        body: 'Hoc 5 phut de giu streak hom nay.',
        url: '/practice',
        tag: 'streak-warning',
    })));
}

module.exports = {
    runDailyReminder,
    runStreakWarning,
};
