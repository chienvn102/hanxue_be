const express = require('express');
const db = require('../config/database');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get HSK tests list
router.get('/tests', async (req, res) => {
    try {
        const { level } = req.query;

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

        res.json({
            data: rows.map(row => ({
                id: row.id,
                title: row.title,
                hskLevel: row.hsk_level,
                year: row.year,
                source: row.source,
                isOfficial: row.is_official,
                durationMins: row.duration_mins,
                listeningCount: row.listening_count,
                readingCount: row.reading_count,
                writingCount: row.writing_count,
                timesTaken: row.times_taken,
                avgScore: row.avg_score
            }))
        });
    } catch (err) {
        console.error('Get tests error:', err);
        res.status(500).json({ error: 'Failed to get tests' });
    }
});

// Get single test with questions
router.get('/tests/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Get test info
        const [tests] = await db.execute(
            `SELECT * FROM hsk_tests WHERE id = ?`,
            [id]
        );

        if (tests.length === 0) {
            return res.status(404).json({ error: 'Test not found' });
        }

        const test = tests[0];

        // Get listening questions
        const [listening] = await db.execute(
            `SELECT id, section_num, question_num, question_type, 
                    audio_url, question_text, image_url, image_options, options
             FROM hsk_listening_questions 
             WHERE test_id = ?
             ORDER BY section_num, question_num`,
            [id]
        );

        // Get reading questions
        const [reading] = await db.execute(
            `SELECT id, section_num, question_num, question_type,
                    passage_text, question_text, image_url, image_options, options
             FROM hsk_reading_questions
             WHERE test_id = ?
             ORDER BY section_num, question_num`,
            [id]
        );

        // Get writing questions
        const [writing] = await db.execute(
            `SELECT id, section_num, question_num, question_type,
                    prompt_text, prompt_pinyin, given_words, image_url
             FROM hsk_writing_questions
             WHERE test_id = ?
             ORDER BY section_num, question_num`,
            [id]
        );

        res.json({
            id: test.id,
            title: test.title,
            hskLevel: test.hsk_level,
            durationMins: test.duration_mins,
            passingScore: test.passing_score,
            listening: listening.map(q => ({
                id: q.id,
                sectionNum: q.section_num,
                questionNum: q.question_num,
                type: q.question_type,
                audioUrl: q.audio_url,
                questionText: q.question_text,
                imageUrl: q.image_url,
                imageOptions: q.image_options ? JSON.parse(q.image_options) : null,
                options: q.options ? JSON.parse(q.options) : null
            })),
            reading: reading.map(q => ({
                id: q.id,
                sectionNum: q.section_num,
                questionNum: q.question_num,
                type: q.question_type,
                passageText: q.passage_text,
                questionText: q.question_text,
                imageUrl: q.image_url,
                imageOptions: q.image_options ? JSON.parse(q.image_options) : null,
                options: q.options ? JSON.parse(q.options) : null
            })),
            writing: writing.map(q => ({
                id: q.id,
                sectionNum: q.section_num,
                questionNum: q.question_num,
                type: q.question_type,
                promptText: q.prompt_text,
                promptPinyin: q.prompt_pinyin,
                givenWords: q.given_words ? JSON.parse(q.given_words) : null,
                imageUrl: q.image_url
            }))
        });
    } catch (err) {
        console.error('Get test error:', err);
        res.status(500).json({ error: 'Failed to get test' });
    }
});

// Submit test answers
router.post('/tests/:id/submit', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { answers, timeSpentMins } = req.body;
        const userId = req.user.userId;

        // Get correct answers
        const [listening] = await db.execute(
            `SELECT id, correct_answer FROM hsk_listening_questions WHERE test_id = ?`,
            [id]
        );

        const [reading] = await db.execute(
            `SELECT id, correct_answer FROM hsk_reading_questions WHERE test_id = ?`,
            [id]
        );

        // Calculate scores
        let listeningCorrect = 0;
        let readingCorrect = 0;

        listening.forEach(q => {
            if (answers[`l_${q.id}`] === q.correct_answer) {
                listeningCorrect++;
            }
        });

        reading.forEach(q => {
            if (answers[`r_${q.id}`] === q.correct_answer) {
                readingCorrect++;
            }
        });

        const listeningScore = Math.round((listeningCorrect / listening.length) * 100);
        const readingScore = Math.round((readingCorrect / reading.length) * 100);
        const totalScore = Math.round((listeningScore + readingScore) / 2);

        // Get passing score
        const [tests] = await db.execute(
            `SELECT passing_score FROM hsk_tests WHERE id = ?`,
            [id]
        );
        const passingScore = tests[0]?.passing_score || 60;
        const passed = totalScore >= passingScore;

        // Save result
        const [result] = await db.execute(
            `INSERT INTO hsk_test_results 
             (user_id, test_id, listening_score, reading_score, total_score, 
              passed, time_spent_mins, answers)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, id, listeningScore, readingScore, totalScore,
                passed, timeSpentMins, JSON.stringify(answers)]
        );

        // Update test stats
        await db.execute(
            `UPDATE hsk_tests SET times_taken = times_taken + 1 WHERE id = ?`,
            [id]
        );

        res.json({
            resultId: result.insertId,
            listeningScore,
            readingScore,
            totalScore,
            passed,
            passingScore
        });
    } catch (err) {
        console.error('Submit test error:', err);
        res.status(500).json({ error: 'Failed to submit test' });
    }
});

// Get user's test results
router.get('/results', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { level } = req.query;

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

        res.json({
            data: rows.map(r => ({
                id: r.id,
                testId: r.test_id,
                testTitle: r.title,
                hskLevel: r.hsk_level,
                listeningScore: r.listening_score,
                readingScore: r.reading_score,
                totalScore: r.total_score,
                passed: r.passed,
                timeSpentMins: r.time_spent_mins,
                completedAt: r.completed_at
            }))
        });
    } catch (err) {
        console.error('Get results error:', err);
        res.status(500).json({ error: 'Failed to get results' });
    }
});

module.exports = router;
