const db = require('../config/database');

function parseLevels(value) {
    if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
    } catch {
        return [];
    }
}

async function getCompletedLevels(userId) {
    try {
        const [rows] = await db.execute(
            'SELECT completed_hsk_levels FROM users WHERE id = ?',
            [userId]
        );
        return parseLevels(rows[0]?.completed_hsk_levels);
    } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR') return [];
        throw error;
    }
}

async function hasPassedExam(userId, hskLevel) {
    const [rows] = await db.execute(
        `SELECT 1
           FROM hsk_exam_attempts a
           JOIN hsk_exams e ON a.exam_id = e.id
          WHERE a.user_id = ?
            AND e.hsk_level = ?
            AND a.is_passed = TRUE
            AND a.status = 'completed'
          LIMIT 1`,
        [userId, hskLevel]
    );
    return rows.length > 0;
}

async function getMasteryRatio(userId, hskLevel) {
    const [[totalRows], [masteredRows]] = await Promise.all([
        db.execute('SELECT COUNT(*) AS total FROM vocabulary WHERE hsk_level = ?', [hskLevel]),
        db.execute(
            `SELECT COUNT(DISTINCT v.id) AS mastered
               FROM vocabulary v
               JOIN notebook_items ni ON ni.vocabulary_id = v.id
               JOIN notebooks n ON n.id = ni.notebook_id
              WHERE v.hsk_level = ?
                AND n.user_id = ?
                AND ni.mastery_level = 'mastered'`,
            [hskLevel, userId]
        ),
    ]);

    const total = Number(totalRows[0]?.total || 0);
    const mastered = Number(masteredRows[0]?.mastered || 0);
    return {
        total,
        mastered,
        ratio: total > 0 ? mastered / total : 0,
    };
}

async function saveCompletedLevels(userId, levels) {
    const normalized = [...new Set(levels.map(Number).filter(n => n >= 1 && n <= 6))].sort((a, b) => a - b);
    await db.execute(
        'UPDATE users SET completed_hsk_levels = ? WHERE id = ?',
        [JSON.stringify(normalized), userId]
    );
    return normalized;
}

async function checkLevelUnlock(userId) {
    try {
        const levels = await getCompletedLevels(userId);
        let currentMax = levels.length ? Math.max(...levels) : 0;
        const unlocked = [];

        for (let level = currentMax + 1; level <= 6; level++) {
            const mastery = await getMasteryRatio(userId, level);
            if (mastery.total === 0 || mastery.ratio < 0.70) break;

            const passed = await hasPassedExam(userId, level);
            if (!passed) break;

            levels.push(level);
            currentMax = level;
            unlocked.push({ level, mastery });
        }

        if (unlocked.length > 0) {
            await saveCompletedLevels(userId, levels);
            const xpService = require('./xp.service');
            const pushService = require('./push.service');
            for (const item of unlocked) {
                await xpService.awardXp(userId, 'level_up', {
                    refType: 'hsk_level',
                    refId: item.level,
                    skipLevelUnlock: true,
                });
                pushService.notifyLevelUp(userId, item.level).catch(error => {
                    console.error('Level-up push failed (non-blocking):', error);
                });
            }
        }

        return { unlocked, completedLevels: levels };
    } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR' || error.code === 'ER_NO_SUCH_TABLE') {
            return { unlocked: [], completedLevels: [] };
        }
        console.error('checkLevelUnlock error:', error);
        return { unlocked: [], completedLevels: [] };
    }
}

module.exports = {
    checkLevelUnlock,
    getCompletedLevels,
    getMasteryRatio,
};
