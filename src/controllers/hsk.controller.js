/**
 * HSK Controller
 * Handles HTTP request/response for HSK test endpoints
 */

const HskModel = require('../models/hsk.model');

/**
 * GET /api/hsk/tests
 */
async function getTests(req, res) {
    try {
        const { level } = req.query;
        const rows = await HskModel.getTests(level);

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
}

/**
 * GET /api/hsk/tests/:id
 */
async function getTestById(req, res) {
    try {
        const { id } = req.params;

        const test = await HskModel.getTestById(id);
        if (!test) {
            return res.status(404).json({ error: 'Test not found' });
        }

        const [listening, reading, writing] = await Promise.all([
            HskModel.getListeningQuestions(id),
            HskModel.getReadingQuestions(id),
            HskModel.getWritingQuestions(id)
        ]);

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
}

/**
 * POST /api/hsk/tests/:id/submit
 */
async function submitTest(req, res) {
    try {
        const { id } = req.params;
        const { answers, timeSpentMins } = req.body;
        const userId = req.user.userId;

        const [listening, reading, test] = await Promise.all([
            HskModel.getListeningAnswers(id),
            HskModel.getReadingAnswers(id),
            HskModel.getTestById(id)
        ]);

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

        const passingScore = test?.passing_score || 60;
        const passed = totalScore >= passingScore;

        // Save result
        const resultId = await HskModel.saveResult({
            userId,
            testId: id,
            listeningScore,
            readingScore,
            totalScore,
            passed,
            timeSpentMins,
            answers
        });

        // Update test stats
        await HskModel.incrementTimesTaken(id);

        res.json({
            resultId,
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
}

/**
 * GET /api/hsk/results
 */
async function getResults(req, res) {
    try {
        const userId = req.user.userId;
        const { level } = req.query;

        const rows = await HskModel.getUserResults(userId, level);

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
}

module.exports = {
    getTests,
    getTestById,
    submitTest,
    getResults
};
