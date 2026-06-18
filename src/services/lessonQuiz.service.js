/**
 * Lesson quiz builder.
 *
 * Tạo quiz cuối bài học từ TỪ VỰNG + NGỮ PHÁP đã link vào bài:
 *   - Từ vựng: MCQ tự sinh (nghĩa tiếng Việt → chọn chữ Hán), 3 mồi nhiễu lấy
 *     ngẫu nhiên trong vocabulary cùng cấp HSK của bài. Deterministic, không AI.
 *   - Ngữ pháp: tái dùng ngân hàng grammar_quiz_questions đã seed
 *     (GrammarQuiz.getQuestions) lọc theo các điểm NP của bài.
 *
 * Hợp đồng câu hỏi (giống grammar_quiz_questions): options = mảng chuỗi,
 * correctAnswer = đúng MỘT phần tử trong options. Client gửi lại chuỗi đã chọn.
 */

const db = require('../config/database');
const GrammarQuiz = require('../models/grammarQuiz.model');

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function buildVocabQuestions(lessonId, max) {
    const [rows] = await db.execute(
        `SELECT v.id, v.simplified, v.pinyin, v.meaning_vi, v.hsk_level
           FROM lesson_vocabulary lv
           JOIN vocabulary v ON v.id = lv.vocabulary_id
          WHERE lv.lesson_id = ?
            AND v.meaning_vi IS NOT NULL AND v.meaning_vi <> ''
            AND v.simplified IS NOT NULL AND v.simplified <> ''
          ORDER BY lv.order_index ASC, lv.id ASC`,
        [lessonId]
    );
    if (!rows.length) return [];

    // Distractor pool: simplified words from the same HSK level(s) as the lesson.
    const levels = [...new Set(rows.map((r) => r.hsk_level).filter(Boolean))];
    let pool = [];
    if (levels.length) {
        const ph = levels.map(() => '?').join(',');
        const [poolRows] = await db.query(
            `SELECT DISTINCT simplified FROM vocabulary
              WHERE hsk_level IN (${ph})
                AND simplified IS NOT NULL AND simplified <> ''
              LIMIT 800`,
            levels
        );
        pool = poolRows.map((r) => r.simplified);
    }
    if (pool.length < 4) {
        const [poolRows] = await db.query(
            `SELECT DISTINCT simplified FROM vocabulary
              WHERE simplified IS NOT NULL AND simplified <> '' LIMIT 800`
        );
        pool = poolRows.map((r) => r.simplified);
    }

    const questions = [];
    for (const w of shuffle(rows).slice(0, max)) {
        const distractors = shuffle(pool.filter((s) => s && s !== w.simplified)).slice(0, 3);
        if (distractors.length < 3) continue; // can't form 4 distinct options
        questions.push({
            id: `v${w.id}`,
            kind: 'vocab',
            refId: w.id,
            questionType: 'multiple_choice',
            questionText: `Chọn chữ Hán đúng với nghĩa: «${w.meaning_vi}»`,
            options: shuffle([w.simplified, ...distractors]),
            correctAnswer: w.simplified,
            explanation: `${w.simplified}${w.pinyin ? ` (${w.pinyin})` : ''} — ${w.meaning_vi}`,
            points: 1,
        });
    }
    return questions;
}

async function buildGrammarQuestions(lessonId, max) {
    const [gids] = await db.execute(
        `SELECT grammar_pattern_id FROM lesson_grammar WHERE lesson_id = ?`,
        [lessonId]
    );
    const grammarIds = gids.map((r) => r.grammar_pattern_id);
    if (!grammarIds.length) return [];

    const rows = await GrammarQuiz.getQuestions({ grammarIds, limit: max });
    return rows.map((r) => ({
        id: `g${r.id}`,
        kind: 'grammar',
        refId: r.grammar_pattern_id,
        questionType: r.question_type,
        questionText: r.question_text,
        options: r.options,
        correctAnswer: r.correct_answer,
        explanation: r.explanation || '',
        points: r.points || 1,
    }));
}

/**
 * Build a mixed lesson quiz (~half vocab, half grammar) capped at `size`.
 * Returns server-side records INCLUDING correctAnswer/explanation.
 */
async function buildLessonQuiz(lessonId, { size = 10 } = {}) {
    const target = Math.min(Math.max(parseInt(size, 10) || 10, 1), 30);
    const [vocabQ, grammarQ] = await Promise.all([
        buildVocabQuestions(lessonId, target),
        buildGrammarQuestions(lessonId, target),
    ]);

    let g = grammarQ.slice(0, Math.ceil(target / 2));
    let v = vocabQ.slice(0, target - g.length);
    if (v.length + g.length < target) {
        g = grammarQ.slice(0, target - v.length); // backfill from grammar
    }
    return shuffle([...v, ...g]).slice(0, target);
}

module.exports = { buildLessonQuiz };
