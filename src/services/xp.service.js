const db = require('../config/database');

const XP_RULES = {
    flashcard_review: { 0: 0, 1: 0, 2: 0, 3: 5, 4: 8, 5: 10 },
    lesson_complete: 20,
    lesson_perfect: 30,
    hsk_exam_pass: 50,
    hsk_exam_fail: 10,
    hsk_exam_perfect: 100,
    practice_match_pair: 5,
    practice_translate: { high: 10, mid: 5, low: 1 },
    ai_chat: 2,
    streak_day_3: 10,
    streak_day_7: 25,
    streak_day_30: 100,
    vocab_master: 5,
    level_up: 200,
    write_complete: 5,
};

function calculateAmount(action, params = {}) {
    if (typeof params.amount === 'number') return Math.max(0, Math.round(params.amount));

    if (action === 'flashcard_review') {
        const quality = Number(params.quality || 0);
        return XP_RULES.flashcard_review[quality] || 0;
    }

    if (action === 'practice_translate') {
        const score = Number(params.score || 0);
        if (score >= 80) return XP_RULES.practice_translate.high;
        if (score >= 50) return XP_RULES.practice_translate.mid;
        return XP_RULES.practice_translate.low;
    }

    return XP_RULES[action] || 0;
}

async function logXp({ userId, amount, action, refId = null, refType = null }) {
    try {
        await db.execute(
            `INSERT INTO xp_history (user_id, amount, action, ref_id, ref_type)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, amount, action, refId, refType]
        );
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.warn('[xp] xp_history table missing; run migration 010_xp_history.sql');
            return;
        }
        throw error;
    }
}

async function awardXp(userId, action, params = {}) {
    const amount = calculateAmount(action, params);
    if (!userId || amount <= 0) return 0;

    await db.execute(
        'UPDATE users SET total_xp = COALESCE(total_xp, 0) + ? WHERE id = ?',
        [amount, userId]
    );

    try {
        await db.execute(
            `INSERT INTO daily_activity (user_id, activity_date, xp_earned)
             VALUES (?, CURDATE(), ?)
             ON DUPLICATE KEY UPDATE xp_earned = COALESCE(xp_earned, 0) + VALUES(xp_earned)`,
            [userId, amount]
        );
    } catch (error) {
        if (error.code !== 'ER_BAD_FIELD_ERROR' && error.code !== 'ER_NO_SUCH_TABLE') throw error;
    }

    await logXp({
        userId,
        amount,
        action,
        refId: params.refId || null,
        refType: params.refType || null,
    });

    if (!params.skipLevelUnlock && action !== 'level_up') {
        setImmediate(() => {
            try {
                require('./levelUnlock.service').checkLevelUnlock(userId);
            } catch (error) {
                console.error('[xp] level unlock check failed:', error.message);
            }
        });
    }

    // Check XP-based achievement milestones (fire-and-forget)
    setImmediate(async () => {
        try {
            const [rows] = await db.execute(
                'SELECT total_xp FROM users WHERE id = ?',
                [userId]
            );
            const totalXp = rows[0]?.total_xp || 0;
            await require('./achievements.service').checkXpAchievements(userId, totalXp);
        } catch (error) {
            console.error('[xp] achievement check failed:', error.message);
        }
    });

    return amount;
}

function calculateXP(quality) {
    return calculateAmount('flashcard_review', { quality });
}

module.exports = {
    XP_RULES,
    awardXp,
    calculateAmount,
    calculateXP,
};
