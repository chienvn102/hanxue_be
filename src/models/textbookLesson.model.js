/**
 * TextbookLesson model
 * Handles all reads/writes for the new textbook-style lesson schema
 * (introduced in migration 004_textbook_lessons.sql).
 */

const db = require('../config/database');

const TextbookLesson = {
    /**
     * Full read for /lessons/:id/textbook — pulls passage + vocab + grammar
     * + exercises + user progress in parallel.
     * includeInactive=true: lấy cả bài soft-deleted (admin context).
     */
    async getFullPayload(lessonId, userId = null, includeInactive = false) {
        const [
            [lessonRows],
            [vocabRows],
            [grammarRows],
            [writingRows],
            [examLinkRows],
            [progressRows],
        ] = await Promise.all([
            db.execute(
                `SELECT id, course_id, title, description, passage_zh, passage_pinyin,
                        passage_vi, passage_audio_url, objectives_vi, hsk_level,
                        order_index, is_active
                   FROM lessons
                  WHERE id = ?` + (includeInactive ? '' : ' AND is_active = TRUE'),
                [lessonId]
            ),
            db.execute(
                `SELECT lv.id AS link_id, lv.order_index, lv.note_vi,
                        v.id, v.simplified, v.traditional, v.pinyin,
                        v.meaning_vi, v.meaning_en, v.hsk_level, v.word_type, v.audio_url
                   FROM lesson_vocabulary lv
                   JOIN vocabulary v ON v.id = lv.vocabulary_id
                  WHERE lv.lesson_id = ?
               ORDER BY lv.order_index ASC, lv.id ASC`,
                [lessonId]
            ),
            db.execute(
                `SELECT gp.id, gp.pattern, gp.pattern_pinyin, gp.pattern_formula,
                        gp.grammar_point, gp.explanation, gp.examples,
                        gp.hsk_level, gp.audio_url, lg.order_index
                   FROM lesson_grammar lg
                   JOIN grammar_patterns gp ON gp.id = lg.grammar_pattern_id
                  WHERE lg.lesson_id = ?
               ORDER BY lg.order_index ASC, lg.id ASC`,
                [lessonId]
            ),
            db.execute(
                `SELECT id, prompt_vi, prompt_zh, expected_keywords,
                        sample_answer_zh, sample_answer_pinyin, sample_answer_vi,
                        min_chars, max_chars, order_index
                   FROM lesson_writing_exercises
                  WHERE lesson_id = ?
               ORDER BY order_index ASC, id ASC`,
                [lessonId]
            ),
            db.execute(
                `SELECT le.exam_id, le.unlock_after_complete,
                        e.title, e.hsk_level
                   FROM lesson_exams le
                   JOIN hsk_exams e ON e.id = le.exam_id
                  WHERE le.lesson_id = ?`,
                [lessonId]
            ),
            userId
                ? db.execute(
                    `SELECT status, vocab_done, passage_done, grammar_done,
                            exercise_done, completed_at,
                            score_percentage, quiz_score, writing_score
                       FROM user_lesson_progress
                      WHERE user_id = ? AND lesson_id = ?
                      LIMIT 1`,
                    [userId, lessonId]
                )
                : [[null]],
        ]);

        if (!lessonRows[0]) return null;
        const lesson = lessonRows[0];

        // Parse JSON columns from grammar_patterns safely
        const grammar = grammarRows.map((row) => ({
            ...row,
            pattern: safeJson(row.pattern),
            pattern_pinyin: safeJson(row.pattern_pinyin),
            examples: safeJson(row.examples) || [],
        }));

        const writing = writingRows.map((row) => ({
            ...row,
            expected_keywords: safeJson(row.expected_keywords) || [],
        }));

        const progress = progressRows && progressRows[0]
            ? {
                status: progressRows[0].status,
                vocab_done: !!progressRows[0].vocab_done,
                passage_done: !!progressRows[0].passage_done,
                grammar_done: !!progressRows[0].grammar_done,
                exercise_done: !!progressRows[0].exercise_done,
                completed_at: progressRows[0].completed_at,
                score_percentage: progressRows[0].score_percentage === null ? null : Number(progressRows[0].score_percentage),
                quiz_score: progressRows[0].quiz_score === null ? null : Number(progressRows[0].quiz_score),
                writing_score: progressRows[0].writing_score === null ? null : Number(progressRows[0].writing_score),
            }
            : null;

        return {
            lesson,
            vocabulary: vocabRows,
            grammar,
            writingExercises: writing,
            hskExams: examLinkRows,
            progress,
        };
    },

    /**
     * Admin: insert textbook lesson skeleton. Returns lessonId.
     */
    async createTextbook({
        courseId, title, description, passageZh, passagePinyin, passageVi,
        objectivesVi, hskLevel, orderIndex,
    }) {
        const [result] = await db.execute(
            `INSERT INTO lessons
                (course_id, title, description, passage_zh, passage_pinyin,
                 passage_vi, objectives_vi, hsk_level, order_index, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [
                courseId, title, description || null,
                passageZh || null, passagePinyin || null, passageVi || null,
                objectivesVi || null, hskLevel || 1, orderIndex || 0,
            ]
        );
        return result.insertId;
    },

    /**
     * Admin: update audio URL after edge-tts script generates the file.
     */
    async setPassageAudioUrl(lessonId, audioUrl) {
        const [result] = await db.execute(
            `UPDATE lessons SET passage_audio_url = ? WHERE id = ?`,
            [audioUrl, lessonId]
        );
        return result.affectedRows;
    },

    /**
     * Junction operations.
     */
    async attachVocabulary(lessonId, vocabularyId, orderIndex = 0, noteVi = null) {
        await db.execute(
            `INSERT INTO lesson_vocabulary (lesson_id, vocabulary_id, order_index, note_vi)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE order_index = VALUES(order_index), note_vi = VALUES(note_vi)`,
            [lessonId, vocabularyId, orderIndex, noteVi]
        );
    },

    async detachVocabulary(lessonId, vocabularyId) {
        await db.execute(
            `DELETE FROM lesson_vocabulary WHERE lesson_id = ? AND vocabulary_id = ?`,
            [lessonId, vocabularyId]
        );
    },

    async updateVocabularyLink(lessonId, vocabularyId, data) {
        const allowed = { order_index: 'orderIndex', note_vi: 'noteVi' };
        const updates = [];
        const values = [];
        for (const [col, key] of Object.entries(allowed)) {
            if (data[key] !== undefined) {
                updates.push(`${col} = ?`);
                values.push(data[key]);
            }
        }
        if (updates.length === 0) return 0;
        values.push(lessonId, vocabularyId);
        const [result] = await db.execute(
            `UPDATE lesson_vocabulary SET ${updates.join(', ')}
              WHERE lesson_id = ? AND vocabulary_id = ?`,
            values
        );
        return result.affectedRows;
    },

    async attachGrammar(lessonId, grammarPatternId, orderIndex = 0) {
        await db.execute(
            `INSERT INTO lesson_grammar (lesson_id, grammar_pattern_id, order_index)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE order_index = VALUES(order_index)`,
            [lessonId, grammarPatternId, orderIndex]
        );
    },

    async detachGrammar(lessonId, grammarPatternId) {
        await db.execute(
            `DELETE FROM lesson_grammar WHERE lesson_id = ? AND grammar_pattern_id = ?`,
            [lessonId, grammarPatternId]
        );
    },

    async addWritingExercise(lessonId, data) {
        const {
            promptVi, promptZh, expectedKeywords,
            sampleAnswerZh, sampleAnswerPinyin, sampleAnswerVi,
            minChars, maxChars, orderIndex,
        } = data;
        const [result] = await db.execute(
            `INSERT INTO lesson_writing_exercises
                (lesson_id, prompt_vi, prompt_zh, expected_keywords,
                 sample_answer_zh, sample_answer_pinyin, sample_answer_vi,
                 min_chars, max_chars, order_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                lessonId,
                promptVi,
                promptZh || null,
                expectedKeywords ? JSON.stringify(expectedKeywords) : null,
                sampleAnswerZh || null,
                sampleAnswerPinyin || null,
                sampleAnswerVi || null,
                minChars || 5,
                maxChars || 200,
                orderIndex || 0,
            ]
        );
        return result.insertId;
    },

    async updateWritingExercise(exerciseId, lessonId, data) {
        const allowed = {
            prompt_vi: 'promptVi',
            prompt_zh: 'promptZh',
            expected_keywords: 'expectedKeywords',
            sample_answer_zh: 'sampleAnswerZh',
            sample_answer_pinyin: 'sampleAnswerPinyin',
            sample_answer_vi: 'sampleAnswerVi',
            min_chars: 'minChars',
            max_chars: 'maxChars',
            order_index: 'orderIndex',
        };
        const updates = [];
        const values = [];
        for (const [col, key] of Object.entries(allowed)) {
            if (data[key] !== undefined) {
                updates.push(`${col} = ?`);
                if (col === 'expected_keywords') {
                    values.push(data[key] ? JSON.stringify(data[key]) : null);
                } else {
                    values.push(data[key]);
                }
            }
        }
        if (updates.length === 0) return 0;
        values.push(exerciseId, lessonId);
        const [result] = await db.execute(
            `UPDATE lesson_writing_exercises SET ${updates.join(', ')}
              WHERE id = ? AND lesson_id = ?`,
            values
        );
        return result.affectedRows;
    },

    async deleteWritingExercise(exerciseId, lessonId) {
        const [result] = await db.execute(
            `DELETE FROM lesson_writing_exercises WHERE id = ? AND lesson_id = ?`,
            [exerciseId, lessonId]
        );
        return result.affectedRows;
    },

    /**
     * User progress.
     */
    async markSectionDone(userId, lessonId, section) {
        const validSections = ['vocab', 'passage', 'grammar', 'exercise'];
        if (!validSections.includes(section)) {
            throw new Error(`invalid section: ${section}`);
        }
        const column = `${section}_done`;
        // Upsert + flip the section column to 1.
        await db.execute(
            `INSERT INTO user_lesson_progress (user_id, lesson_id, status, ${column})
             VALUES (?, ?, 'in_progress', 1)
             ON DUPLICATE KEY UPDATE ${column} = 1,
                 status = IF(status = 'completed', status, 'in_progress')`,
            [userId, lessonId]
        );

        // If all 4 done → mark completed + set completed_at (only first time).
        const [rows] = await db.execute(
            `SELECT vocab_done, passage_done, grammar_done, exercise_done, status
               FROM user_lesson_progress
              WHERE user_id = ? AND lesson_id = ? LIMIT 1`,
            [userId, lessonId]
        );
        const row = rows[0];
        const allDone = row && row.vocab_done && row.passage_done && row.grammar_done && row.exercise_done;
        if (allDone && row.status !== 'completed') {
            await db.execute(
                `UPDATE user_lesson_progress
                    SET status = 'completed', completed_at = NOW()
                  WHERE user_id = ? AND lesson_id = ?`,
                [userId, lessonId]
            );
            return { sectionDone: section, allDone: true, justCompleted: true };
        }
        return { sectionDone: section, allDone: !!allDone, justCompleted: false };
    },

    /**
     * Writing submission — Groq grading (services/lessonWritingGrader) with a
     * keyword/length heuristic fallback. Persists the submission, stores the
     * writing_score on lesson progress, then recomputes the lesson aggregate
     * (avg quiz + writing) which gates exercise_done at LESSON_PASS_PCT (≥70%).
     */
    async submitWriting(userId, exerciseId, answerZh) {
        const [exRows] = await db.execute(
            `SELECT id, lesson_id, prompt_vi, prompt_zh, expected_keywords,
                    sample_answer_zh, min_chars, max_chars
               FROM lesson_writing_exercises WHERE id = ? LIMIT 1`,
            [exerciseId]
        );
        const exercise = exRows[0];
        if (!exercise) throw new Error('exercise not found');

        const keywords = safeJson(exercise.expected_keywords) || [];
        const text = (answerZh || '').trim();
        const hanCharCount = (text.match(/[一-鿿]/g) || []).length;

        // ---- Keyword/length heuristic (fallback + always-available baseline) ----
        const hits = [];
        const missed = [];
        for (const kw of keywords) {
            if (text.includes(kw)) hits.push(kw);
            else missed.push(kw);
        }

        let score = 0;
        let feedback = '';
        if (hanCharCount < (exercise.min_chars || 5)) {
            score = Math.max(0, Math.floor((hanCharCount / (exercise.min_chars || 5)) * 40));
            feedback = `Bài trả lời còn quá ngắn (${hanCharCount} ký tự, tối thiểu ${exercise.min_chars}).`;
        } else if (hanCharCount > (exercise.max_chars || 200)) {
            feedback = `Bài trả lời quá dài (${hanCharCount}/${exercise.max_chars}).`;
            score = 60;
        } else {
            const keywordRatio = keywords.length === 0 ? 1 : hits.length / keywords.length;
            score = Math.round(60 + 40 * keywordRatio);
            if (keywordRatio === 1) {
                feedback = 'Tốt! Bạn đã sử dụng đầy đủ các điểm ngữ pháp/từ vựng cần thiết.';
            } else if (hits.length > 0) {
                feedback = `Đã dùng ${hits.length}/${keywords.length} điểm cần có. Còn thiếu: ${missed.join(', ')}.`;
            } else {
                feedback = `Chưa thấy điểm ngữ pháp/từ vựng cần có. Hãy thử dùng: ${missed.join(', ')}.`;
            }
        }

        // ---- Groq grading (overrides heuristic when enabled + healthy) ----
        let ai = null;
        try {
            const grader = require('../services/lessonWritingGrader.service');
            ai = await grader.gradeWriting({
                promptVi: exercise.prompt_vi,
                promptZh: exercise.prompt_zh,
                expectedKeywords: keywords,
                sampleAnswerZh: exercise.sample_answer_zh,
                minChars: exercise.min_chars,
                maxChars: exercise.max_chars,
                answerZh: text,
            });
        } catch (e) {
            console.warn('[lessonWritingGrader] fell back to keyword grading:', e.message);
        }
        if (ai) {
            score = ai.score;
            feedback = ai.feedbackVi || feedback;
        }

        const [insRes] = await db.execute(
            `INSERT INTO user_writing_submissions
                (user_id, exercise_id, answer_zh, score, keyword_hits, feedback_vi)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, exerciseId, answerZh, score, JSON.stringify(hits), feedback]
        );

        // Store writing_score on lesson progress + recompute the aggregate/gate.
        await this.upsertProgressScore(userId, exercise.lesson_id, 'writing_score', score);
        const progress = await this.recomputeLessonScore(userId, exercise.lesson_id);

        return {
            submissionId: insRes.insertId,
            exerciseId,
            lessonId: exercise.lesson_id,
            score,
            keywordHits: hits,
            keywordMissed: missed,
            feedback,
            charCount: hanCharCount,
            ai: ai
                ? {
                    source: ai.source,
                    feedbackZh: ai.feedbackZh,
                    suggestedAnswer: ai.suggestedAnswer,
                    strengths: ai.strengths,
                    issues: ai.issues,
                }
                : null,
            lessonScore: progress.aggregate,
            lessonPassed: progress.passed,
            justCompleted: progress.justCompleted,
            courseId: progress.courseId,
        };
    },

    /**
     * Upsert one numeric score column (quiz_score | writing_score) on
     * user_lesson_progress, creating the row in 'in_progress' state if needed.
     */
    async upsertProgressScore(userId, lessonId, column, value) {
        if (!['quiz_score', 'writing_score'].includes(column)) {
            throw new Error(`invalid score column: ${column}`);
        }
        await db.execute(
            `INSERT INTO user_lesson_progress (user_id, lesson_id, status, ${column})
             VALUES (?, ?, 'in_progress', ?)
             ON DUPLICATE KEY UPDATE ${column} = VALUES(${column}),
                 status = IF(status = 'completed', status, 'in_progress')`,
            [userId, lessonId, value]
        );
    },

    /**
     * Recompute a lesson's aggregate score and exercise gate for one user.
     * - Required components = those the lesson actually has: quiz (any linked
     *   vocab/grammar) and/or writing (any writing exercise).
     * - score_percentage = average of submitted required component scores.
     * - exercise_done flips to 1 only when ALL required components are
     *   submitted AND the average ≥ LESSON_PASS_PCT (never downgrades).
     * - When all 4 section flags are done, transitions status → 'completed'.
     * Returns { aggregate, passed, justCompleted, courseId, quizScore, writingScore }.
     */
    async recomputeLessonScore(userId, lessonId) {
        const [[counts]] = await db.execute(
            `SELECT
                (SELECT COUNT(*) FROM lesson_vocabulary WHERE lesson_id = ?)        AS vocab_n,
                (SELECT COUNT(*) FROM lesson_grammar WHERE lesson_id = ?)           AS grammar_n,
                (SELECT COUNT(*) FROM lesson_writing_exercises WHERE lesson_id = ?) AS writing_n,
                (SELECT course_id FROM lessons WHERE id = ?)                        AS course_id`,
            [lessonId, lessonId, lessonId, lessonId]
        );
        const hasQuiz = Number(counts?.vocab_n || 0) + Number(counts?.grammar_n || 0) > 0;
        const hasWriting = Number(counts?.writing_n || 0) > 0;
        const courseId = counts?.course_id || null;

        const [progRows] = await db.execute(
            `SELECT quiz_score, writing_score,
                    vocab_done, passage_done, grammar_done, exercise_done, status
               FROM user_lesson_progress
              WHERE user_id = ? AND lesson_id = ? LIMIT 1`,
            [userId, lessonId]
        );
        const row = progRows[0] || {};
        const quizScore = row.quiz_score === null || row.quiz_score === undefined ? null : Number(row.quiz_score);
        const writingScore = row.writing_score === null || row.writing_score === undefined ? null : Number(row.writing_score);

        const required = [];
        if (hasQuiz) required.push(quizScore);
        if (hasWriting) required.push(writingScore);

        const allSubmitted = required.length > 0 && required.every((s) => s !== null);
        const present = required.filter((s) => s !== null);
        const aggregate = present.length
            ? Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 100) / 100
            : null;

        const passThreshold = Number.parseInt(process.env.LESSON_PASS_PCT || '70', 10);
        const passed = allSubmitted && aggregate !== null && aggregate >= passThreshold;

        // Persist aggregate + raise exercise_done when passed (never downgrade).
        await db.execute(
            `UPDATE user_lesson_progress
                SET score_percentage = ?, exercise_done = GREATEST(exercise_done, ?)
              WHERE user_id = ? AND lesson_id = ?`,
            [aggregate, passed ? 1 : 0, userId, lessonId]
        );

        // Re-read flags and transition to completed if all 4 sections done.
        const [afterRows] = await db.execute(
            `SELECT vocab_done, passage_done, grammar_done, exercise_done, status
               FROM user_lesson_progress
              WHERE user_id = ? AND lesson_id = ? LIMIT 1`,
            [userId, lessonId]
        );
        const after = afterRows[0] || {};
        const allDone = after.vocab_done && after.passage_done && after.grammar_done && after.exercise_done;
        let justCompleted = false;
        if (allDone && after.status !== 'completed') {
            await db.execute(
                `UPDATE user_lesson_progress
                    SET status = 'completed', completed_at = NOW()
                  WHERE user_id = ? AND lesson_id = ?`,
                [userId, lessonId]
            );
            justCompleted = true;
        }

        return { aggregate, passed, justCompleted, courseId, quizScore, writingScore };
    },
};

function safeJson(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
}

module.exports = TextbookLesson;
