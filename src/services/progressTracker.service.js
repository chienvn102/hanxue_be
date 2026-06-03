/**
 * Progress Tracker — single sink for vocabulary progress writes.
 *
 * Previously only POST /api/progress/review (flashcard) updated
 * user_vocabulary_progress + SRS. Match, Writing, Translate, Speech etc.
 * awarded XP but skipped progress → users felt "chưa đồng bộ" because
 * mastery / next_review never advanced from those activities.
 *
 * All practice paths now funnel into `recordVocabAttempt(...)` so that:
 *   - times_seen / times_correct / times_wrong stay accurate across sources
 *   - mastery_level rolls up consistently
 *   - SRS (ease_factor / interval_days / repetitions / next_review) advances
 *     no matter which game touched the vocab
 *
 * Pure DB I/O — no HTTP / no auth checks (caller already authed user).
 */

const ProgressModel = require('../models/progress.model');
const { nextSrs } = require('./srs.service');

/** Mirrors deriveMastery in progress.controller (kept in sync). */
function deriveMastery(timesSeen, timesCorrect) {
    if (timesSeen === 0) return 0;
    const acc = timesCorrect / timesSeen;
    if (timesSeen < 2) return 1;
    if (acc >= 0.9 && timesSeen >= 5) return 5;
    if (acc >= 0.8 && timesSeen >= 4) return 4;
    if (acc >= 0.7 && timesSeen >= 3) return 3;
    if (acc >= 0.5) return 2;
    return 1;
}

/** SM-2 quality clamp + sanity guard. */
function clampQuality(q) {
    const n = Number(q);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, Math.round(n)));
}

/**
 * UPSERT one attempt on a vocab. Quality 0..5 (>=3 counts as correct).
 *
 * @param {number} userId
 * @param {number} vocabId
 * @param {number} quality 0..5
 * @param {{source?: 'flashcard'|'match'|'writing'|'translate'|'speech'|string,
 *          responseMs?: number}} [meta]
 * @returns {Promise<{created: boolean, source: string}>}
 */
async function recordVocabAttempt(userId, vocabId, quality, meta = {}) {
    const userIdInt = Number.parseInt(userId, 10);
    const vocabIdInt = Number.parseInt(vocabId, 10);
    if (!Number.isFinite(userIdInt) || !Number.isFinite(vocabIdInt)) return { created: false, source: meta.source || 'unknown' };

    const q = clampQuality(quality);
    const isCorrect = q >= 3;

    // Verify the vocab exists — silently skip on unknown id (best-effort hooks
    // like translate match against AI-generated text and may pass stale ids).
    const exists = await ProgressModel.vocabExists(vocabIdInt).catch(() => false);
    if (!exists) return { created: false, source: meta.source || 'unknown' };

    const current = await ProgressModel.getProgress(userIdInt, vocabIdInt);
    const srs = nextSrs({
        ease_factor: current?.ease_factor,
        interval_days: current?.interval_days,
        repetitions: current?.repetitions,
    }, q);

    if (!current) {
        await ProgressModel.createProgress(userIdInt, vocabIdInt, {
            masteryLevel: deriveMastery(1, isCorrect ? 1 : 0),
            isCorrect,
            responseMs: meta.responseMs ?? null,
            srs,
        });
        return { created: true, source: meta.source || 'unknown' };
    }

    const newSeen = (current.times_seen || 0) + 1;
    const newCorrect = (current.times_correct || 0) + (isCorrect ? 1 : 0);
    const newAvgMs = meta.responseMs && current.avg_response_ms
        ? Math.round((current.avg_response_ms + meta.responseMs) / 2)
        : (meta.responseMs ?? current.avg_response_ms);

    await ProgressModel.updateProgress(userIdInt, vocabIdInt, {
        masteryLevel: deriveMastery(newSeen, newCorrect),
        isCorrect,
        avgResponseMs: newAvgMs,
        srs,
    });
    return { created: false, source: meta.source || 'unknown' };
}

/**
 * Sequential batch — keeps lock contention bounded for short pair lists
 * (match game ≤ 16 pairs). Errors per-item are caught + logged so 1 bad
 * vocab doesn't tank the whole batch.
 *
 * @param {number} userId
 * @param {Array<{vocabId: number, quality: number, responseMs?: number}>} attempts
 * @param {{source?: string}} [meta]
 */
async function recordVocabAttemptsBatch(userId, attempts = [], meta = {}) {
    for (const a of attempts) {
        try {
            await recordVocabAttempt(userId, a.vocabId, a.quality, {
                source: meta.source,
                responseMs: a.responseMs,
            });
        } catch (err) {
            console.error(`[progressTracker] vocab ${a.vocabId} batch err (${meta.source}):`, err.message);
        }
    }
}

/** Map AI/scoring percentage (0..100) to SM-2 quality buckets. */
function qualityFromScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return 1;
    if (n >= 80) return 5;
    if (n >= 50) return 3;
    return 1;
}

module.exports = {
    recordVocabAttempt,
    recordVocabAttemptsBatch,
    qualityFromScore,
    deriveMastery,
};
