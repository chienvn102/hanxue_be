/**
 * Writing practice SRS — pure functions, no DB I/O.
 *
 * Inputs:
 *   current  : { currentStage, masteryLevel, easeFactor, intervalDays }
 *   attempt  : { stage, mistakes, strokeCount }
 *
 * Outputs:
 *   next     : { currentStage, masteryLevel, easeFactor, intervalDays, nextReviewAt, scoreLabel }
 *
 * Scoring rule (per-attempt):
 *   - perfect: mistakes === 0
 *   - pass:    mistakes <= strokeCount  (a single retry on each stroke is OK)
 *   - fail:    mistakes >  strokeCount
 *
 * Stage progression:
 *   - perfect: advance stage by 1 (clamp at 3). When already at 3 and pass/perfect
 *              → graduate (mastery_level + 1) and schedule via SM-2 interval.
 *   - pass:    advance stage by 1 (clamp 3). Ease nudges slightly down.
 *   - fail:    keep stage, mastery_level = max(0, ml - 1), interval = 0,
 *              next_review_at = NOW() (retry immediately).
 *
 * Interval schedule when graduating from stage 3:
 *   mastery 0 → 1 day, 1 → 3, 2 → 7, 3 → 14, 4 → 30, 5+ → 60.
 *   Subsequent passes multiply by ease_factor.
 */

const STAGE_MIN = 1;
const STAGE_MAX = 3;
const EASE_MIN = 1.30;
const EASE_MAX = 3.00;

const GRADUATION_BASE_DAYS = [1, 3, 7, 14, 30, 60];

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function classify(mistakes, strokeCount) {
    if (mistakes === 0) return 'perfect';
    if (mistakes <= strokeCount) return 'pass';
    return 'fail';
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

/**
 * @param {{currentStage:number, masteryLevel:number, easeFactor:number, intervalDays:number}} current
 * @param {{stage:number, mistakes:number, strokeCount:number}} attempt
 */
function nextSrs(current, attempt) {
    const now = new Date();
    const score = classify(attempt.mistakes, attempt.strokeCount);

    let stage = clamp(current.currentStage || 1, STAGE_MIN, STAGE_MAX);
    let mastery = clamp(current.masteryLevel || 0, 0, 5);
    let ease = clamp(Number(current.easeFactor) || 2.5, EASE_MIN, EASE_MAX);
    let intervalDays = current.intervalDays || 0;
    let nextReviewAt = now;

    if (score === 'fail') {
        // Keep stage, demote mastery, retry now
        mastery = Math.max(0, mastery - 1);
        intervalDays = 0;
        ease = clamp(ease - 0.20, EASE_MIN, EASE_MAX);
        nextReviewAt = now;
    } else if (score === 'pass') {
        // Pass: advance stage if not at max; if at max, graduate +mastery
        ease = clamp(ease - 0.05, EASE_MIN, EASE_MAX);
        if (stage < STAGE_MAX) {
            stage += 1;
            intervalDays = 0;
            nextReviewAt = now;
        } else {
            // graduated
            mastery = Math.min(5, mastery + 1);
            const base = GRADUATION_BASE_DAYS[Math.min(mastery, GRADUATION_BASE_DAYS.length - 1)];
            intervalDays = Math.round(base * ease / 2.5);
            nextReviewAt = addDays(now, intervalDays);
        }
    } else {
        // perfect — same advancement as pass but ease goes up
        ease = clamp(ease + 0.10, EASE_MIN, EASE_MAX);
        if (stage < STAGE_MAX) {
            stage += 1;
            intervalDays = 0;
            nextReviewAt = now;
        } else {
            mastery = Math.min(5, mastery + 1);
            const base = GRADUATION_BASE_DAYS[Math.min(mastery, GRADUATION_BASE_DAYS.length - 1)];
            intervalDays = Math.round(base * ease / 2.5);
            nextReviewAt = addDays(now, intervalDays);
        }
    }

    return {
        currentStage: stage,
        masteryLevel: mastery,
        easeFactor: Number(ease.toFixed(2)),
        intervalDays,
        nextReviewAt,
        scoreLabel: score,
    };
}

module.exports = {
    classify,
    nextSrs,
    STAGE_MIN,
    STAGE_MAX,
};
