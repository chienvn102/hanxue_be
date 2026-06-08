/**
 * Achievement unlocker.
 *
 * Schema (deployed):
 *   achievements(id, code UNIQUE, title_vi, icon, ...)
 *   user_achievements(user_id FK, achievement_id FK, unlocked_at)
 *
 * The catalog below mirrors what's available; on first access we resolve each
 * catalog `key` → `achievements.id`, auto-seeding rows that don't exist yet so
 * unlock writes don't fail with FK errors. Keys are chosen to MATCH existing
 * DB rows where present (vd `words_100` not `vocab_100`, `hsk1_pass` not
 * `hsk_1_pass`) to avoid duplicating data.
 */

const db = require('../config/database');
const pushService = require('./push.service');
const activityLog = require('./activityLog.service');

const STREAK_BADGES = [
    { key: 'streak_3',   target: 3,   name: 'Khởi động',          icon: 'local_fire_department' },
    { key: 'streak_7',   target: 7,   name: 'Tuần đầu tiên',      icon: 'local_fire_department' },
    { key: 'streak_30',  target: 30,  name: 'Tháng vàng',         icon: 'local_fire_department' },
    { key: 'streak_100', target: 100, name: 'Trăm ngày',          icon: 'local_fire_department' },
    { key: 'streak_365', target: 365, name: 'Một năm bền bỉ',     icon: 'local_fire_department' },
];

const XP_BADGES = [
    { key: 'xp_100',   target: 100,   name: '100 XP đầu tiên',  icon: 'bolt' },
    { key: 'xp_1000',  target: 1000,  name: '1000 XP',           icon: 'bolt' },
    { key: 'xp_5000',  target: 5000,  name: '5000 XP',           icon: 'bolt' },
    { key: 'xp_10000', target: 10000, name: '10K XP',            icon: 'bolt' },
];

// Match existing DB codes `words_100`, `words_500` (not the older `vocab_*`).
const VOCAB_BADGES = [
    { key: 'words_100',  target: 100,  name: '100 từ đầu tiên', icon: 'auto_stories' },
    { key: 'words_500',  target: 500,  name: '500 từ vựng',     icon: 'auto_stories' },
    { key: 'words_1000', target: 1000, name: '1000 từ vựng',    icon: 'auto_stories' },
    { key: 'words_2500', target: 2500, name: '2500 từ vựng',    icon: 'auto_stories' },
];

// Match existing DB codes `hsk1_pass`, `hsk2_pass`, `hsk3_pass` (no underscore between digit and "pass").
const HSK_BADGES = [
    { key: 'hsk1_pass', target: 1, name: 'Vượt qua HSK 1', icon: 'workspace_premium' },
    { key: 'hsk2_pass', target: 2, name: 'Vượt qua HSK 2', icon: 'workspace_premium' },
    { key: 'hsk3_pass', target: 3, name: 'Vượt qua HSK 3', icon: 'workspace_premium' },
    { key: 'hsk4_pass', target: 4, name: 'Vượt qua HSK 4', icon: 'workspace_premium' },
    { key: 'hsk5_pass', target: 5, name: 'Vượt qua HSK 5', icon: 'workspace_premium' },
    { key: 'hsk6_pass', target: 6, name: 'Vượt qua HSK 6', icon: 'workspace_premium' },
];

const ALL = [...STREAK_BADGES, ...XP_BADGES, ...VOCAB_BADGES, ...HSK_BADGES];
const BY_KEY = Object.fromEntries(ALL.map(b => [b.key, b]));

// Cache: catalog code → achievements.id. Populated lazily on first call;
// auto-seeds rows for codes the DB doesn't yet have so FK INSERTs succeed.
let codeToIdCache = null;

async function loadCatalogIds() {
    if (codeToIdCache) return codeToIdCache;
    try {
        const [rows] = await db.execute('SELECT id, code FROM achievements');
        const map = new Map(rows.map(r => [r.code, r.id]));

        // Seed any catalog code missing from DB so unlock() never fails on FK.
        const missing = ALL.filter(b => !map.has(b.key));
        for (const b of missing) {
            try {
                const [r] = await db.execute(
                    `INSERT IGNORE INTO achievements (code, title_vi, icon)
                     VALUES (?, ?, ?)`,
                    [b.key, b.name, b.icon]
                );
                if (r.insertId) {
                    map.set(b.key, r.insertId);
                } else {
                    // INSERT IGNORE'd a race — fetch the existing id.
                    const [row2] = await db.execute(
                        'SELECT id FROM achievements WHERE code = ?',
                        [b.key]
                    );
                    if (row2[0]) map.set(b.key, row2[0].id);
                }
            } catch (seedErr) {
                console.error(`[achievements] seed "${b.key}" failed:`, seedErr.message);
            }
        }
        codeToIdCache = map;
        return map;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            codeToIdCache = new Map();
            return codeToIdCache;
        }
        throw error;
    }
}

async function unlock(userId, key, metricValue = null) {
    const badge = BY_KEY[key];
    if (!badge) return false;
    try {
        const ids = await loadCatalogIds();
        const achievementId = ids.get(key);
        if (!achievementId) return false; // seed failed earlier

        const [result] = await db.execute(
            `INSERT IGNORE INTO user_achievements (user_id, achievement_id)
             VALUES (?, ?)`,
            [userId, achievementId]
        );
        if (result.affectedRows === 0) return false; // already had it

        // Notify + log (metricValue kept in payload only — no DB column for it).
        await Promise.allSettled([
            activityLog.log(userId, 'achievement_unlocked', {
                title: `Mở khoá huy hiệu: ${badge.name}`,
                icon: badge.icon,
                payload: { key, name: badge.name, metricValue },
            }),
            pushService.pushToUser(userId, {
                title: 'Mở khoá huy hiệu mới!',
                body: badge.name,
                url: '/achievements',
                tag: `achievement-${key}`,
                type: 'achievement_unlocked',
                icon: badge.icon,
            }),
        ]);
        return true;
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return false;
        console.error('[achievements] unlock failed:', error.message);
        return false;
    }
}

async function checkStreakAchievements(userId, currentStreak) {
    const eligible = STREAK_BADGES.filter(b => currentStreak >= b.target);
    for (const b of eligible) {
        await unlock(userId, b.key, currentStreak);
    }
}

async function checkXpAchievements(userId, totalXp) {
    const eligible = XP_BADGES.filter(b => totalXp >= b.target);
    for (const b of eligible) {
        await unlock(userId, b.key, totalXp);
    }
}

async function checkVocabAchievements(userId, masteredCount) {
    const eligible = VOCAB_BADGES.filter(b => masteredCount >= b.target);
    for (const b of eligible) {
        await unlock(userId, b.key, masteredCount);
    }
}

async function checkHskAchievement(userId, hskLevel) {
    const key = `hsk_${hskLevel}_pass`;
    if (!BY_KEY[key]) return;
    await unlock(userId, key, hskLevel);
}

async function getUnlocked(userId) {
    try {
        // `key` is a reserved word in MariaDB — alias as `code` to avoid quoting.
        const [rows] = await db.execute(
            `SELECT a.code, ua.unlocked_at
               FROM user_achievements ua
               JOIN achievements a ON a.id = ua.achievement_id
              WHERE ua.user_id = ?
              ORDER BY ua.unlocked_at DESC`,
            [userId]
        );
        // metricValue isn't stored in DB; controller maps null defensively.
        return rows.map(r => ({ key: r.code, earnedAt: r.unlocked_at, metricValue: null }));
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') return [];
        throw error;
    }
}

module.exports = {
    unlock,
    checkStreakAchievements,
    checkXpAchievements,
    checkVocabAchievements,
    checkHskAchievement,
    getUnlocked,
    catalog: ALL,
};
