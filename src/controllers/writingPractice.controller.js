/**
 * Writing practice endpoints.
 *
 *   GET  /api/writing/word?simplified=XX
 *     → For each unique character in `simplified`, return stroke data +
 *       per-character current SRS stage. Also returns vocab meta (pinyin,
 *       meaning_vi, audio_url) so the practice UI doesn't need a 2nd round-trip.
 *
 *   GET  /api/writing/due?limit=10
 *     → Top-N characters due for review.
 *
 *   POST /api/writing/submit  {character, stage, mistakes, strokeCount}
 *     → Record attempt, advance SRS, award XP, return new state.
 */

const characterModel = require('../models/character.model');
const vocabModel = require('../models/vocab.model');
const writingProgress = require('../models/writingProgress.model');
const xpService = require('../services/xp.service');
const streakService = require('../services/streak.service');
const activityLog = require('../services/activityLog.service');

function parseStrokeOrder(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw); } catch { return []; }
}

function uniqueChars(str) {
    return Array.from(new Set(Array.from(String(str || ''))));
}

function isCjkChar(ch) {
    if (!ch) return false;
    const c = ch.codePointAt(0);
    // Basic CJK Unified Ideographs + Extension A. Sufficient for HSK 1–6.
    return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf);
}

exports.getWord = async (req, res) => {
    try {
        const simplified = String(req.query.simplified || '').trim();
        if (!simplified) {
            return res.status(400).json({ success: false, message: 'Thiếu tham số simplified' });
        }
        const userId = req.user.userId;

        const allChars = uniqueChars(simplified).filter(isCjkChar);
        if (!allChars.length) {
            return res.status(400).json({ success: false, message: 'Không có ký tự Hán hợp lệ' });
        }

        // Parallel fetch: vocab meta + character strokes + progress
        const [vocab, charRows, progressMap] = await Promise.all([
            vocabModel.findBySimplified(simplified).catch(() => null),
            characterModel.getByHanziList(allChars),
            writingProgress.findByCharacters(userId, allChars),
        ]);

        const charMap = new Map(charRows.map(r => [r.hanzi, r]));
        const characters = allChars.map(hanzi => {
            const ch = charMap.get(hanzi);
            const prog = progressMap.get(hanzi);
            return {
                hanzi,
                strokeCount: ch?.stroke_count || 0,
                strokeOrder: parseStrokeOrder(ch?.stroke_order),
                pinyin: ch?.pinyin || '',
                meaningVi: ch?.meaning_vi || '',
                currentStage: prog?.current_stage || 1,
                masteryLevel: prog?.mastery_level || 0,
                totalAttempts: prog?.total_attempts || 0,
                nextReviewAt: prog?.next_review_at || null,
            };
        });

        // Pull full vocab meta if we found it
        let wordMeta = null;
        if (vocab) {
            const [fullRows] = await require('../config/database').execute(
                `SELECT simplified, traditional, pinyin, meaning_vi, audio_url
                   FROM vocabulary WHERE id = ?`,
                [vocab.id]
            );
            wordMeta = fullRows[0] ? {
                simplified: fullRows[0].simplified,
                traditional: fullRows[0].traditional,
                pinyin: fullRows[0].pinyin,
                meaningVi: fullRows[0].meaning_vi,
                audioUrl: fullRows[0].audio_url,
                vocabId: vocab.id,
            } : null;
        }

        return res.json({
            success: true,
            data: {
                simplified,
                wordMeta,
                characters,
            },
        });
    } catch (error) {
        console.error('writing.getWord error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

exports.getDue = async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = parseInt(req.query.limit, 10) || 10;
        const rows = await writingProgress.findDue(userId, limit);
        if (!rows.length) return res.json({ success: true, data: [] });

        // Enrich with stroke meta for picker UI (skip strokeOrder for size)
        const chars = rows.map(r => r.character);
        const charRows = await characterModel.getByHanziList(chars);
        const charMap = new Map(charRows.map(r => [r.hanzi, r]));

        const data = rows.map(r => ({
            hanzi: r.character,
            pinyin: charMap.get(r.character)?.pinyin || '',
            meaningVi: charMap.get(r.character)?.meaning_vi || '',
            currentStage: r.current_stage,
            masteryLevel: r.mastery_level,
            nextReviewAt: r.next_review_at,
            totalAttempts: r.total_attempts,
            totalMistakes: r.total_mistakes,
        }));

        return res.json({ success: true, data });
    } catch (error) {
        console.error('writing.getDue error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

exports.submit = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { character, stage, mistakes, strokeCount } = req.body || {};

        if (!character || typeof character !== 'string' || character.length > 8) {
            return res.status(400).json({ success: false, message: 'character không hợp lệ' });
        }
        const stageInt = parseInt(stage, 10);
        if (![1, 2, 3].includes(stageInt)) {
            return res.status(400).json({ success: false, message: 'stage phải là 1, 2 hoặc 3' });
        }
        const mistakesInt = Math.max(0, Math.min(50, parseInt(mistakes, 10) || 0));
        const strokeCountInt = Math.max(1, Math.min(50, parseInt(strokeCount, 10) || 1));

        const result = await writingProgress.recordAttempt(userId, character, {
            stage: stageInt,
            mistakes: mistakesInt,
            strokeCount: strokeCountInt,
        });

        // XP: 5 XP perfect stage, 3 XP pass, 0 fail. Bonus +5 nếu vừa tốt nghiệp lên mastery.
        let xpEarned = 0;
        const { scoreLabel } = result.srs;
        if (scoreLabel === 'perfect') xpEarned = 5;
        else if (scoreLabel === 'pass') xpEarned = 3;

        const graduated = result.before && result.before.current_stage === 3
            && result.after.currentStage === 3
            && result.after.masteryLevel > (result.before.mastery_level || 0);
        if (graduated) xpEarned += 5;

        if (xpEarned > 0) {
            try {
                await xpService.awardXp(userId, 'manual', {
                    amount: xpEarned,
                    refType: 'writing_practice',
                    skipLevelUnlock: true,
                });
            } catch (e) { console.error('writing xp error:', e.message); }
        }

        // Streak + activity (fire-and-forget)
        streakService.updateStreak(userId).catch(() => {});
        activityLog.log(userId, 'pronunciation_session', {
            title: `Luyện viết ${character}`,
            icon: 'edit',
            payload: { character, stage: stageInt, mistakes: mistakesInt, score: scoreLabel },
        }).catch(() => {});

        return res.json({
            success: true,
            data: {
                ...result.after,
                scoreLabel,
                graduated,
                xpEarned,
            },
        });
    } catch (error) {
        console.error('writing.submit error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};
