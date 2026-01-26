/**
 * SRS (Spaced Repetition System) Service
 * Implements SM-2 Algorithm for vocabulary review scheduling
 * 
 * Quality ratings:
 * 0 - Complete blackout (không nhớ gì)
 * 1 - Incorrect but recognized answer (nhớ sai nhưng nhận ra đáp án)
 * 2 - Incorrect but easy recall (nhớ sai nhưng quen thuộc)
 * 3 - Correct with difficulty (nhớ đúng với nỗ lực)
 * 4 - Correct with hesitation (nhớ đúng sau do dự)
 * 5 - Perfect response (nhớ đúng ngay lập tức)
 */

/**
 * Calculate new Ease Factor based on quality rating
 * EF' = EF + (0.1 - (5 - q) × (0.08 + (5 - q) × 0.02))
 * Minimum EF = 1.3
 */
function calculateEaseFactor(currentEF, quality) {
    const newEF = currentEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    return Math.max(1.3, newEF);
}

/**
 * Calculate next interval based on repetitions and EF
 * I(1) = 1 day
 * I(2) = 6 days
 * I(n) = I(n-1) × EF (n > 2)
 */
function calculateInterval(repetitions, easeFactor, currentInterval) {
    if (repetitions <= 0) return 0;
    if (repetitions === 1) return 1;
    if (repetitions === 2) return 6;
    return Math.round(currentInterval * easeFactor);
}

/**
 * Calculate next review date
 */
function calculateNextReviewDate(intervalDays) {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + intervalDays);
    return nextDate;
}

/**
 * Main SM-2 calculation function
 * @param {number} quality - Rating 0-5
 * @param {Object} currentProgress - Current user progress (or null for new)
 * @returns {Object} - New progress values
 */
function calculateNextReview(quality, currentProgress = null) {
    // Default values for new word
    let easeFactor = currentProgress?.ease_factor || 2.5;
    let repetitions = currentProgress?.repetitions || 0;
    let intervalDays = currentProgress?.interval_days || 0;

    // If quality < 3, reset repetitions (failed recall)
    if (quality < 3) {
        repetitions = 0;
        intervalDays = 1; // Review again tomorrow
    } else {
        // Success - increment repetitions
        repetitions += 1;
        intervalDays = calculateInterval(repetitions, easeFactor, intervalDays);
    }

    // Always update ease factor
    easeFactor = calculateEaseFactor(easeFactor, quality);

    // Calculate next review date
    const nextReview = calculateNextReviewDate(intervalDays);

    // Determine mastery level (0-5) based on repetitions
    let masteryLevel = 0;
    if (repetitions >= 8) masteryLevel = 5;
    else if (repetitions >= 6) masteryLevel = 4;
    else if (repetitions >= 4) masteryLevel = 3;
    else if (repetitions >= 2) masteryLevel = 2;
    else if (repetitions >= 1) masteryLevel = 1;

    return {
        ease_factor: Math.round(easeFactor * 100) / 100, // Round to 2 decimals
        interval_days: intervalDays,
        repetitions: repetitions,
        next_review: nextReview,
        mastery_level: masteryLevel
    };
}

/**
 * Get quality description in Vietnamese
 */
function getQualityDescription(quality) {
    const descriptions = {
        0: 'Không nhớ gì',
        1: 'Nhớ sai nhưng nhận ra đáp án',
        2: 'Nhớ sai nhưng quen thuộc',
        3: 'Nhớ đúng với nỗ lực',
        4: 'Nhớ đúng sau do dự',
        5: 'Nhớ đúng ngay lập tức'
    };
    return descriptions[quality] || 'Unknown';
}

module.exports = {
    calculateNextReview,
    calculateEaseFactor,
    calculateInterval,
    getQualityDescription
};
