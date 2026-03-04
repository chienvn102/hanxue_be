/**
 * HSK Exam Model
 * Handles database operations for HSK exams, sections, and questions
 */

const db = require('../config/database');

// ============================================================
// EXAM OPERATIONS
// ============================================================

async function getExamList({ hsk, type, page = 1, limit = 20, activeOnly = true }) {
    const offset = (page - 1) * limit;
    let sql = `SELECT * FROM hsk_exams WHERE 1=1`;
    const params = [];

    if (activeOnly) {
        sql += ' AND is_active = TRUE';
    }
    if (hsk) {
        sql += ' AND hsk_level = ?';
        params.push(parseInt(hsk));
    }
    if (type) {
        sql += ' AND exam_type = ?';
        params.push(type);
    }

    sql += ' ORDER BY hsk_level ASC, created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [rows] = await db.execute(sql, params);

    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM hsk_exams WHERE 1=1';
    const countParams = [];
    if (activeOnly) countSql += ' AND is_active = TRUE';
    if (hsk) { countSql += ' AND hsk_level = ?'; countParams.push(parseInt(hsk)); }
    if (type) { countSql += ' AND exam_type = ?'; countParams.push(type); }

    const [countResult] = await db.execute(countSql, countParams);

    return { rows, total: countResult[0].total };
}

async function getExamById(id, includeSections = false) {
    const [rows] = await db.execute('SELECT * FROM hsk_exams WHERE id = ?', [id]);
    if (!rows[0]) return null;

    const exam = rows[0];

    if (includeSections) {
        const [sections] = await db.execute(
            'SELECT * FROM hsk_sections WHERE exam_id = ? ORDER BY section_order',
            [id]
        );
        exam.sections = sections;

        // Get questions for each section
        for (const section of exam.sections) {
            const [questions] = await db.execute(
                'SELECT * FROM hsk_questions WHERE section_id = ? ORDER BY question_number',
                [section.id]
            );
            section.questions = questions.map(q => ({
                ...q,
                options: q.options ? JSON.parse(q.options) : [],
                option_images: q.option_images ? JSON.parse(q.option_images) : []
            }));
        }
    }

    return exam;
}

async function createExam(data) {
    const { title, hsk_level, exam_type, duration_minutes, passing_score, description } = data;

    const [result] = await db.execute(
        `INSERT INTO hsk_exams (title, hsk_level, exam_type, duration_minutes, passing_score, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [title, hsk_level || 1, exam_type || 'practice', duration_minutes || 60, passing_score || 120, description || null]
    );
    return result.insertId;
}

async function updateExam(id, data) {
    const allowedFields = ['title', 'hsk_level', 'exam_type', 'duration_minutes', 'passing_score', 'description', 'is_active'];
    const updates = [];
    const values = [];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(data[field]);
        }
    }

    if (updates.length === 0) return 0;
    values.push(id);

    const [result] = await db.execute(
        `UPDATE hsk_exams SET ${updates.join(', ')} WHERE id = ?`,
        values
    );
    return result.affectedRows;
}

async function deleteExam(id) {
    const [result] = await db.execute('DELETE FROM hsk_exams WHERE id = ?', [id]);
    return result.affectedRows;
}

// ============================================================
// SECTION OPERATIONS
// ============================================================

async function getSectionsByExam(examId) {
    const [rows] = await db.execute(
        'SELECT * FROM hsk_sections WHERE exam_id = ? ORDER BY section_order',
        [examId]
    );
    return rows;
}

async function createSection(data) {
    const { exam_id, section_type, section_order, title, instructions, duration_seconds, audio_url } = data;

    const [result] = await db.execute(
        `INSERT INTO hsk_sections (exam_id, section_type, section_order, title, instructions, duration_seconds, audio_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [exam_id, section_type, section_order || 1, title || null, instructions || null, duration_seconds || 0, audio_url || null]
    );
    return result.insertId;
}

async function updateSection(id, data) {
    const allowedFields = ['section_type', 'section_order', 'title', 'instructions', 'duration_seconds', 'audio_url'];
    const updates = [];
    const values = [];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(data[field]);
        }
    }

    if (updates.length === 0) return 0;
    values.push(id);

    const [result] = await db.execute(
        `UPDATE hsk_sections SET ${updates.join(', ')} WHERE id = ?`,
        values
    );
    return result.affectedRows;
}

async function deleteSection(id) {
    const [result] = await db.execute('DELETE FROM hsk_sections WHERE id = ?', [id]);
    return result.affectedRows;
}

// ============================================================
// QUESTION OPERATIONS
// ============================================================

async function getQuestionsBySection(sectionId) {
    const [rows] = await db.execute(
        'SELECT * FROM hsk_questions WHERE section_id = ? ORDER BY question_number',
        [sectionId]
    );
    return rows.map(q => ({
        ...q,
        options: q.options ? JSON.parse(q.options) : [],
        option_images: q.option_images ? JSON.parse(q.option_images) : []
    }));
}

async function createQuestion(data) {
    const {
        section_id, question_number, question_type, question_text, question_image, question_audio,
        audio_start_time, audio_end_time, audio_play_count, options, option_images,
        correct_answer, explanation, difficulty, points
    } = data;

    const [result] = await db.execute(
        `INSERT INTO hsk_questions 
         (section_id, question_number, question_type, question_text, question_image, question_audio,
          audio_start_time, audio_end_time, audio_play_count, options, option_images,
          correct_answer, explanation, difficulty, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            section_id, question_number || 1, question_type || 'multiple_choice',
            question_text || null, question_image || null, question_audio || null,
            audio_start_time || 0, audio_end_time || 0, audio_play_count || 2,
            options ? JSON.stringify(options) : null,
            option_images ? JSON.stringify(option_images) : null,
            correct_answer, explanation || null, difficulty || 1, points || 1
        ]
    );

    // Update section question count
    await db.execute(
        'UPDATE hsk_sections SET total_questions = total_questions + 1 WHERE id = ?',
        [section_id]
    );

    // Update exam question count
    await db.execute(`
        UPDATE hsk_exams e
        SET total_questions = (
            SELECT COALESCE(SUM(s.total_questions), 0)
            FROM hsk_sections s WHERE s.exam_id = e.id
        )
        WHERE e.id = (SELECT exam_id FROM hsk_sections WHERE id = ?)
    `, [section_id]);

    return result.insertId;
}

async function updateQuestion(id, data) {
    const allowedFields = [
        'question_number', 'question_type', 'question_text', 'question_image', 'question_audio',
        'audio_start_time', 'audio_end_time', 'audio_play_count', 'options', 'option_images',
        'correct_answer', 'explanation', 'difficulty', 'points'
    ];
    const updates = [];
    const values = [];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            if (['options', 'option_images'].includes(field) && typeof data[field] === 'object') {
                values.push(JSON.stringify(data[field]));
            } else {
                values.push(data[field]);
            }
        }
    }

    if (updates.length === 0) return 0;
    values.push(id);

    const [result] = await db.execute(
        `UPDATE hsk_questions SET ${updates.join(', ')} WHERE id = ?`,
        values
    );
    return result.affectedRows;
}

async function deleteQuestion(id) {
    // Get section_id before delete
    const [rows] = await db.execute('SELECT section_id FROM hsk_questions WHERE id = ?', [id]);
    const sectionId = rows[0]?.section_id;

    const [result] = await db.execute('DELETE FROM hsk_questions WHERE id = ?', [id]);

    if (result.affectedRows > 0 && sectionId) {
        // Update counts
        await db.execute(
            'UPDATE hsk_sections SET total_questions = total_questions - 1 WHERE id = ?',
            [sectionId]
        );
        await db.execute(`
            UPDATE hsk_exams e
            SET total_questions = (
                SELECT COALESCE(SUM(s.total_questions), 0)
                FROM hsk_sections s WHERE s.exam_id = e.id
            )
            WHERE e.id = (SELECT exam_id FROM hsk_sections WHERE id = ?)
        `, [sectionId]);
    }

    return result.affectedRows;
}

// ============================================================
// EXAM ATTEMPT OPERATIONS
// ============================================================

async function createAttempt(userId, examId) {
    const [result] = await db.execute(
        `INSERT INTO hsk_exam_attempts (user_id, exam_id) VALUES (?, ?)`,
        [userId, examId]
    );
    return result.insertId;
}

async function getAttemptById(attemptId) {
    const [rows] = await db.execute('SELECT * FROM hsk_exam_attempts WHERE id = ?', [attemptId]);
    return rows[0] || null;
}

async function submitAnswer(attemptId, questionId, userAnswer, isCorrect, pointsEarned, timeSpent) {
    const [result] = await db.execute(
        `INSERT INTO hsk_user_answers (attempt_id, question_id, user_answer, is_correct, points_earned, time_spent_seconds)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_answer = VALUES(user_answer), is_correct = VALUES(is_correct), 
         points_earned = VALUES(points_earned), time_spent_seconds = VALUES(time_spent_seconds), answered_at = NOW()`,
        [attemptId, questionId, userAnswer, isCorrect, pointsEarned || 0, timeSpent || 0]
    );
    return result.affectedRows;
}

async function completeAttempt(attemptId) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Fetch answers WITH correct_answer and points for grading
        const [answers] = await conn.execute(
            `SELECT ua.*, q.correct_answer, q.points AS question_points, q.section_id, s.section_type
             FROM hsk_user_answers ua
             JOIN hsk_questions q ON ua.question_id = q.id
             JOIN hsk_sections s ON q.section_id = s.id
             WHERE ua.attempt_id = ?`,
            [attemptId]
        );

        let listeningScore = 0, readingScore = 0, writingScore = 0;
        let correctCount = 0, wrongCount = 0;
        let totalTimeSpent = 0;

        // Grade each answer by comparing user_answer with correct_answer
        for (const ans of answers) {
            totalTimeSpent += ans.time_spent_seconds || 0;

            const userAnswer = (ans.user_answer || '').trim().toLowerCase();
            const correctAnswer = (ans.correct_answer || '').trim().toLowerCase();
            const isCorrect = userAnswer !== '' && userAnswer === correctAnswer;
            const points = isCorrect ? (ans.question_points || 1) : 0;

            // Update the answer row with grading result
            await conn.execute(
                `UPDATE hsk_user_answers SET is_correct = ?, points_earned = ? WHERE id = ?`,
                [isCorrect, points, ans.id]
            );

            if (isCorrect) {
                correctCount++;
                if (ans.section_type === 'listening') listeningScore += points;
                else if (ans.section_type === 'reading') readingScore += points;
                else if (ans.section_type === 'writing') writingScore += points;
            } else {
                wrongCount++;
            }
        }

        const totalScore = listeningScore + readingScore + writingScore;

        // Get exam passing score and max possible score
        const [attempt] = await conn.execute('SELECT exam_id FROM hsk_exam_attempts WHERE id = ?', [attemptId]);
        const [exam] = await conn.execute('SELECT passing_score, total_questions FROM hsk_exams WHERE id = ?', [attempt[0].exam_id]);
        const isPassed = totalScore >= (exam[0]?.passing_score || 0);
        const unansweredCount = (exam[0]?.total_questions || 0) - correctCount - wrongCount;

        // Calculate max possible score
        const [maxScoreResult] = await conn.execute(
            `SELECT COALESCE(SUM(q.points), 0) as max_score
             FROM hsk_questions q
             JOIN hsk_sections s ON q.section_id = s.id
             WHERE s.exam_id = ?`,
            [attempt[0].exam_id]
        );
        const maxScore = maxScoreResult[0]?.max_score || 0;

        await conn.execute(
            `UPDATE hsk_exam_attempts SET
             completed_at = NOW(), status = 'completed',
             listening_score = ?, reading_score = ?, writing_score = ?, total_score = ?,
             max_score = ?, is_passed = ?, correct_count = ?, wrong_count = ?, unanswered_count = ?, time_spent_seconds = ?
             WHERE id = ?`,
            [listeningScore, readingScore, writingScore, totalScore, maxScore, isPassed, correctCount, wrongCount, unansweredCount, totalTimeSpent, attemptId]
        );

        await conn.commit();

        return { listeningScore, readingScore, writingScore, totalScore, maxScore, isPassed, correctCount, wrongCount, unansweredCount };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function getUserAttempts(userId, examId = null) {
    let sql = `SELECT a.*, e.title, e.hsk_level 
               FROM hsk_exam_attempts a 
               JOIN hsk_exams e ON a.exam_id = e.id 
               WHERE a.user_id = ?`;
    const params = [userId];

    if (examId) {
        sql += ' AND a.exam_id = ?';
        params.push(examId);
    }

    sql += ' ORDER BY a.started_at DESC';

    const [rows] = await db.execute(sql, params);
    return rows;
}

async function getInProgressAttempt(userId, examId) {
    const [rows] = await db.execute(
        `SELECT * FROM hsk_exam_attempts WHERE user_id = ? AND exam_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1`,
        [userId, examId]
    );
    return rows[0] || null;
}

async function getAttemptAnswers(attemptId) {
    const [rows] = await db.execute(
        `SELECT ua.question_id, ua.user_answer, ua.time_spent_seconds
         FROM hsk_user_answers ua
         WHERE ua.attempt_id = ?`,
        [attemptId]
    );
    return rows;
}

async function getAttemptWithAnswers(attemptId) {
    const [rows] = await db.execute(
        `SELECT ua.question_id, ua.user_answer, ua.is_correct, ua.points_earned, ua.time_spent_seconds
         FROM hsk_user_answers ua
         WHERE ua.attempt_id = ?`,
        [attemptId]
    );
    return rows;
}

module.exports = {
    // Exams
    getExamList,
    getExamById,
    createExam,
    updateExam,
    deleteExam,
    // Sections
    getSectionsByExam,
    createSection,
    updateSection,
    deleteSection,
    // Questions
    getQuestionsBySection,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    // Attempts
    createAttempt,
    getAttemptById,
    getInProgressAttempt,
    getAttemptAnswers,
    getAttemptWithAnswers,
    submitAnswer,
    completeAttempt,
    getUserAttempts
};
