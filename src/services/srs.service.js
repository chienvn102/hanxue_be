/**
 * Shared SRS algorithm (SM-2 simplified) used by vocab + grammar review paths.
 *
 * Writing has its own service (writingSrs.service.js) tuned for stroke-mistake
 * grading and intentionally kept separate.
 *
 * Quality scale 0..5:
 *   0..2 = forgot (resets repetitions, shrinks ease)
 *   3..5 = remembered (advances interval per SM-2)
 *
 * Pure function — does not touch DB.
 */

const MIN_EASE = 1.30;
const DEFAULT_EASE = 2.50;
const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 6;

/**
 * @param {{ease_factor?: number, interval_days?: number, repetitions?: number}} current
 * @param {number} quality 0..5
 * @returns {{ease_factor: number, interval_days: number, repetitions: number, next_review_at: Date}}
 */
function nextSrs(current = {}, quality) {
    const q = Math.max(0, Math.min(5, Number(quality) || 0));
    let ease = Number(current.ease_factor) || DEFAULT_EASE;
    let interval = Number(current.interval_days) || 0;
    let reps = Number(current.repetitions) || 0;

    if (q < 3) {
        // Forgot: restart from short interval, shrink ease.
        reps = 0;
        interval = FIRST_INTERVAL_DAYS;
        ease = Math.max(MIN_EASE, ease - 0.20);
    } else {
        if (reps === 0) {
            interval = FIRST_INTERVAL_DAYS;
        } else if (reps === 1) {
            interval = SECOND_INTERVAL_DAYS;
        } else {
            interval = Math.max(1, Math.round(interval * ease));
        }
        reps += 1;
        // Standard SM-2 ease delta — slightly penalizes q=3 (hard recall), rewards q=5.
        const delta = 0.10 - (5 - q) * (0.08 + (5 - q) * 0.02);
        ease = Math.max(MIN_EASE, ease + delta);
    }

    const nextReviewAt = new Date(Date.now() + interval * 86_400_000);
    return {
        ease_factor: Math.round(ease * 100) / 100,
        interval_days: interval,
        repetitions: reps,
        next_review_at: nextReviewAt,
    };
}

module.exports = { nextSrs, MIN_EASE, DEFAULT_EASE };
