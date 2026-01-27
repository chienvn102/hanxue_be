/**
 * HSK Test Model
 * Handles database operations for HSK tests
 */

const db = require('../config/database');

/**
 * Get HSK tests list
 */
async function getTests(level) {
    let sql = `SELECT id, title, hsk_level, year, source, is_official,
                      duration_mins, listening_count, reading_count, 
                      writing_count, times_taken, avg_score
               FROM hsk_tests WHERE 1=1`;
    const params = [];

    if (level) {
        sql += ' AND hsk_level = ?';
        params.push(parseInt(level));
    }

    sql += ' ORDER BY hsk_level, year DESC';

    const [rows] = await db.execute(sql, params);
    return rows;
}

/**
 * Get single test by ID
 */
async function getTestById(id) {
    const [tests] = await db.execute(
        'SELECT * FROM hsk_tests WHERE id = ?',
        [id]
    );
    return tests[0] || null;
}

/**
 * Get listening questions for a test
 */
async function getListeningQuestions(testId) {
    const [rows] = await db.execute(
        `SELECT id, section_num, question_num, question_type, 
                audio_url, question_text, image_url, image_options, options
         FROM hsk_listening_questions 
         WHERE test_id = ?
         ORDER BY section_num, question_num`,
        [testId]
    );
    return rows;
}

/**
 * Get reading questions for a test
 */
async function getReadingQuestions(testId) {
    const [rows] = await db.execute(
        `SELECT id, section_num, question_num, question_type,
                passage_text, question_text, image_url, image_options, options
         FROM hsk_reading_questions
         WHERE test_id = ?
         ORDER BY section_num, question_num`,
        [testId]
    );
    return rows;
}

/**
 * Get writing questions for a test
 */
async function getWritingQuestions(testId) {
    const [rows] = await db.execute(
        `SELECT id, section_num, question_num, question_type,
                prompt_text, prompt_pinyin, given_words, image_url
         FROM hsk_writing_questions
         WHERE test_id = ?
         ORDER BY section_num, question_num`,
        [testId]
    );
    return rows;
}

/**
 * Get listening answers for scoring
 */
async function getListeningAnswers(testId) {
    const [rows] = await db.execute(
        'SELECT id, correct_answer FROM hsk_listening_questions WHERE test_id = ?',
        [testId]
    );
    return rows;
}

/**
 * Get reading answers for scoring
 */
async function getReadingAnswers(testId) {
    const [rows] = await db.execute(
        'SELECT id, correct_answer FROM hsk_reading_questions WHERE test_id = ?',
        [testId]
    );
    return rows;
}

/**
 * Save test result
 */
async function saveResult({ userId, testId, listeningScore, readingScore, totalScore, passed, timeSpentMins, answers }) {
    const [result] = await db.execute(
        `INSERT INTO hsk_test_results 
         (user_id, test_id, listening_score, reading_score, total_score, 
          passed, time_spent_mins, answers)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, testId, listeningScore, readingScore, totalScore,
            passed, timeSpentMins, JSON.stringify(answers)]
    );
    return result.insertId;
}

/**
 * Update test stats after submission
 */
async function incrementTimesTaken(testId) {
    await db.execute(
        'UPDATE hsk_tests SET times_taken = times_taken + 1 WHERE id = ?',
        [testId]
    );
}

/**
 * Get user's test results
 */
async function getUserResults(userId, level) {
    let sql = `SELECT r.*, t.title, t.hsk_level 
               FROM hsk_test_results r
               JOIN hsk_tests t ON r.test_id = t.id
               WHERE r.user_id = ?`;
    const params = [userId];

    if (level) {
        sql += ' AND t.hsk_level = ?';
        params.push(parseInt(level));
    }

    sql += ' ORDER BY r.completed_at DESC';

    const [rows] = await db.execute(sql, params);
    return rows;
}

module.exports = {
    getTests,
    getTestById,
    getListeningQuestions,
    getReadingQuestions,
    getWritingQuestions,
    getListeningAnswers,
    getReadingAnswers,
    saveResult,
    incrementTimesTaken,
    getUserResults
};
