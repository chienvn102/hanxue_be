/**
 * HSK Exam Template Service (HF2)
 *
 * `instantiateTemplate(level, overrides)` tạo 1 atomic transaction:
 *   - Insert hsk_exams row.
 *   - Insert sections theo cấu trúc chuẩn HSK level.
 *   - Insert groups (image_grid / reply_bank / word_bank / passage).
 *   - Insert N placeholder questions với question_type đúng + question_number
 *     1..N + correct_answer = 'A' (admin sẽ chỉnh sau).
 *
 * Supports HSK 1-6 templates. HSK 4-6 use coarse official part structure
 * and placeholder content for admin editing.
 */

const db = require('../config/database');

const PLACEHOLDER_ANSWER = 'A';

/**
 * Khai báo declarative cho 1 part trong section.
 *
 *   count       — số câu trong part
 *   questionType— enum question_type
 *   group       — { type: 'image_grid'|'reply_bank'|'word_bank'|'passage'|'passage_multi',
 *                   title: '...', items: number }
 *                 nếu null → không tạo group, mỗi câu standalone.
 */
const TEMPLATES = {
    1: {
        title: 'HSK 1 — Đề mới',
        duration_minutes: 35,
        passing_score: 120,
        sections: [
            {
                section_type: 'listening',
                title: 'Phần 1 — Nghe (听力)',
                instructions: 'Bài thi nghe gồm 4 phần, 20 câu. Mỗi câu nghe 2 lần.',
                duration_seconds: 15 * 60,
                parts: [
                    { count: 5, questionType: 'true_false',       group: null },
                    { count: 5, questionType: 'image_grid_match', group: { type: 'image_grid', title: 'Lưới ảnh A–F', items: 6 } },
                    { count: 5, questionType: 'reply_match',      group: { type: 'reply_bank', title: 'Câu trả lời A–F', items: 6 } },
                    { count: 5, questionType: 'multiple_choice',  group: null },
                ],
            },
            {
                section_type: 'reading',
                title: 'Phần 2 — Đọc hiểu (阅读)',
                instructions: 'Bài đọc gồm 4 phần, 20 câu.',
                duration_seconds: 17 * 60,
                parts: [
                    { count: 5, questionType: 'image_grid_match', group: { type: 'image_grid', title: 'Lưới ảnh A–F', items: 6 } },
                    { count: 5, questionType: 'true_false',       group: null },
                    { count: 5, questionType: 'reply_match',      group: { type: 'reply_bank', title: 'Câu trả lời A–F', items: 6 } },
                    { count: 5, questionType: 'word_bank_fill',   group: { type: 'word_bank',  title: 'Bộ từ A–F',     items: 6 } },
                ],
            },
        ],
    },

    2: {
        title: 'HSK 2 — Đề mới',
        duration_minutes: 55,
        passing_score: 120,
        sections: [
            {
                section_type: 'listening',
                title: 'Phần 1 — Nghe (听力)',
                instructions: 'Bài thi nghe gồm 4 phần, 35 câu. Mỗi câu nghe 2 lần.',
                duration_seconds: 25 * 60,
                parts: [
                    { count: 10, questionType: 'true_false',       group: null },
                    { count: 10, questionType: 'image_grid_match', group: { type: 'image_grid', title: 'Lưới ảnh A–F (1)', items: 6 } },
                    { count: 10, questionType: 'reply_match',      group: { type: 'reply_bank', title: 'Câu trả lời A–F', items: 6 } },
                    { count: 5,  questionType: 'multiple_choice',  group: null },
                ],
            },
            {
                section_type: 'reading',
                title: 'Phần 2 — Đọc hiểu (阅读)',
                instructions: 'Bài đọc gồm 4 phần, 25 câu.',
                duration_seconds: 22 * 60,
                parts: [
                    { count: 5,  questionType: 'image_grid_match', group: { type: 'image_grid', title: 'Lưới ảnh A–F', items: 6 } },
                    { count: 5,  questionType: 'word_bank_fill',   group: { type: 'word_bank',  title: 'Bộ từ A–F',   items: 6 } },
                    { count: 5,  questionType: 'true_false',       group: null },
                    { count: 10, questionType: 'multiple_choice',  group: null },
                ],
            },
        ],
    },

    3: {
        title: 'HSK 3 — Đề mới',
        duration_minutes: 90,
        passing_score: 180,
        sections: [
            {
                section_type: 'listening',
                title: 'Phần 1 — Nghe (听力)',
                instructions: 'Bài thi nghe gồm 4 phần, 40 câu. Mỗi câu nghe 2 lần.',
                duration_seconds: 35 * 60,
                parts: [
                    { count: 10, questionType: 'image_grid_match', group: { type: 'image_grid', title: 'Lưới ảnh A–F', items: 6 } },
                    { count: 10, questionType: 'true_false',       group: null },
                    { count: 10, questionType: 'multiple_choice',  group: null },
                    { count: 10, questionType: 'multiple_choice',  group: null },
                ],
            },
            {
                section_type: 'reading',
                title: 'Phần 2 — Đọc hiểu (阅读)',
                instructions: 'Bài đọc gồm 3 phần, 30 câu.',
                duration_seconds: 30 * 60,
                parts: [
                    { count: 10, questionType: 'reply_match',     group: { type: 'reply_bank', title: 'Câu trả lời A–F', items: 6 } },
                    { count: 10, questionType: 'word_bank_fill',  group: { type: 'word_bank',  title: 'Bộ từ A–F',     items: 6 } },
                    { count: 10, questionType: 'multiple_choice', group: null },
                ],
            },
            {
                section_type: 'writing',
                title: 'Phần 3 — Viết (书写)',
                instructions: 'Bài viết gồm 2 phần, 10 câu.',
                duration_seconds: 15 * 60,
                parts: [
                    { count: 5, questionType: 'sentence_assembly', group: null },
                    { count: 5, questionType: 'fill_hanzi',        group: null },
                ],
            },
        ],
    },

    4: {
        title: 'HSK 4 - De moi',
        duration_minutes: 105,
        passing_score: 180,
        sections: [
            {
                section_type: 'listening',
                title: 'Phan 1 - Nghe (听力)',
                instructions: 'HSK 4 listening: true/false + short/long dialogue MCQ.',
                duration_seconds: 30 * 60,
                parts: [
                    { count: 10, questionType: 'true_false', group: null },
                    { count: 15, questionType: 'multiple_choice', group: null },
                    { count: 20, questionType: 'multiple_choice', group: null },
                ],
            },
            {
                section_type: 'reading',
                title: 'Phan 2 - Doc (阅读)',
                instructions: 'HSK 4 reading: word bank + passage MCQ.',
                duration_seconds: 40 * 60,
                parts: [
                    { count: 10, questionType: 'word_bank_fill', group: { type: 'word_bank', title: 'Bo tu A-F', items: 6 } },
                    { count: 10, questionType: 'multiple_choice', group: null },
                    { count: 20, questionType: 'multiple_choice', group: { type: 'passage_multi', title: 'Passage multi-question', items: 0 } },
                ],
            },
            {
                section_type: 'writing',
                title: 'Phan 3 - Viet (书写)',
                instructions: 'HSK 4 writing: assemble sentence + image keyword sentence.',
                duration_seconds: 25 * 60,
                parts: [
                    { count: 10, questionType: 'sentence_assembly', group: null },
                    { count: 5, questionType: 'image_keyword_sentence', group: null },
                ],
            },
        ],
    },

    5: {
        title: 'HSK 5 - De moi',
        duration_minutes: 125,
        passing_score: 180,
        sections: [
            {
                section_type: 'listening',
                title: 'Phan 1 - Nghe (听力)',
                instructions: 'HSK 5 listening: dialogue/monologue MCQ.',
                duration_seconds: 30 * 60,
                parts: [
                    { count: 20, questionType: 'multiple_choice', group: null },
                    { count: 25, questionType: 'multiple_choice', group: null },
                ],
            },
            {
                section_type: 'reading',
                title: 'Phan 2 - Doc (阅读)',
                instructions: 'HSK 5 reading: word bank + long passage MCQ.',
                duration_seconds: 45 * 60,
                parts: [
                    { count: 15, questionType: 'word_bank_fill', group: { type: 'word_bank', title: 'Bo tu A-J', items: 10 } },
                    { count: 10, questionType: 'multiple_choice', group: null },
                    { count: 20, questionType: 'multiple_choice', group: { type: 'passage_multi', title: 'Long passage multi-question', items: 0 } },
                ],
            },
            {
                section_type: 'writing',
                title: 'Phan 3 - Viet (书写)',
                instructions: 'HSK 5 writing: assemble sentence + short essay.',
                duration_seconds: 45 * 60,
                parts: [
                    { count: 8, questionType: 'sentence_assembly', group: null },
                    { count: 2, questionType: 'short_essay', group: null },
                ],
            },
        ],
    },

    6: {
        title: 'HSK 6 - De moi',
        duration_minutes: 140,
        passing_score: 180,
        sections: [
            {
                section_type: 'listening',
                title: 'Phan 1 - Nghe (听力)',
                instructions: 'HSK 6 listening: monologue/interview/story MCQ.',
                duration_seconds: 35 * 60,
                parts: [
                    { count: 15, questionType: 'multiple_choice', group: null },
                    { count: 15, questionType: 'multiple_choice', group: { type: 'passage_multi', title: 'Interview passage', items: 0 } },
                    { count: 20, questionType: 'multiple_choice', group: null },
                ],
            },
            {
                section_type: 'reading',
                title: 'Phan 2 - Doc (阅读)',
                instructions: 'HSK 6 reading: error identify + blank choice + sentence into passage + long passage.',
                duration_seconds: 50 * 60,
                parts: [
                    { count: 10, questionType: 'error_identify', group: null },
                    { count: 10, questionType: 'multi_blank_choice', group: null },
                    { count: 10, questionType: 'sentence_into_passage', group: null },
                    { count: 20, questionType: 'multiple_choice', group: { type: 'passage_multi', title: 'Long passage multi-question', items: 0 } },
                ],
            },
            {
                section_type: 'writing',
                title: 'Phan 3 - Viet (书写)',
                instructions: 'HSK 6 writing: summary essay.',
                duration_seconds: 45 * 60,
                parts: [
                    { count: 1, questionType: 'summary_essay', group: null },
                ],
            },
        ],
    },
};

/**
 * Tạo content JSON skeleton cho group dựa theo type. Admin sẽ điền sau.
 */
function buildGroupContent(group) {
    const items = Array.from({ length: group.items }, (_, i) => ({
        label: String.fromCharCode(65 + i), // A, B, C, ...
    }));
    if (group.type === 'image_grid') {
        return { items: items.map(it => ({ ...it, image_url: '' })) };
    }
    if (group.type === 'word_bank') {
        return { items: items.map(it => ({ ...it, zh: '', pinyin: '', vi: '' })) };
    }
    if (group.type === 'reply_bank') {
        return { items: items.map(it => ({ ...it, zh: '', pinyin: '', vi: '' })) };
    }
    if (group.type === 'passage') {
        return { passage_zh: '', passage_pinyin: '', passage_vi: '' };
    }
    if (group.type === 'passage_multi') {
        return {
            passage_zh: '',
            passage_pinyin: '',
            passage_vi: '',
            question_refs: [],
        };
    }
    return null;
}

/**
 * Public — atomic instantiate full HSK exam from template.
 *
 * @param {1|2|3|4|5|6} level
 * @param {{title?: string, exam_type?: string, description?: string}} overrides
 * @returns {Promise<{examId: number, totalQuestions: number}>}
 */
async function instantiateTemplate(level, overrides = {}) {
    if (!TEMPLATES[level]) {
        const err = new Error(`HSK ${level} chua co template.`);
        err.code = 'UNSUPPORTED_LEVEL';
        throw err;
    }

    const tmpl = TEMPLATES[level];
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Insert exam
        const examTitle = overrides.title || `${tmpl.title} (${new Date().toISOString().slice(0, 10)})`;
        // Coerce legacy 'mock'/'official' → 'exam' (migration 022 collapse).
        const rawType = overrides.exam_type;
        const examType =
            rawType === 'practice' || rawType === 'exam' ? rawType :
            rawType === 'mock' || rawType === 'official' ? 'exam' : 'practice';
        const description = overrides.description || null;

        const [examRes] = await conn.execute(
            `INSERT INTO hsk_exams
               (title, hsk_level, exam_type, duration_minutes, passing_score, description, total_questions)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [examTitle, level, examType, tmpl.duration_minutes, tmpl.passing_score, description]
        );
        const examId = examRes.insertId;

        let totalQuestions = 0;

        // 2. Insert sections + groups + questions
        for (let sIdx = 0; sIdx < tmpl.sections.length; sIdx++) {
            const sec = tmpl.sections[sIdx];

            const [secRes] = await conn.execute(
                `INSERT INTO hsk_sections
                   (exam_id, section_type, section_order, title, instructions, duration_seconds, total_questions)
                 VALUES (?, ?, ?, ?, ?, ?, 0)`,
                [examId, sec.section_type, sIdx + 1, sec.title, sec.instructions, sec.duration_seconds]
            );
            const sectionId = secRes.insertId;

            let questionNumber = 1 + totalQuestions; // continuous numbering across sections
            let sectionQCount = 0;

            // For each part, optionally create group, then questions
            for (let pIdx = 0; pIdx < sec.parts.length; pIdx++) {
                const part = sec.parts[pIdx];
                let groupId = null;

                if (part.group) {
                    const content = buildGroupContent(part.group);
                    const [grpRes] = await conn.execute(
                        `INSERT INTO hsk_question_groups
                           (section_id, group_type, title_vi, content, order_index)
                         VALUES (?, ?, ?, ?, ?)`,
                        [sectionId, part.group.type, part.group.title, JSON.stringify(content), pIdx]
                    );
                    groupId = grpRes.insertId;
                }

                for (let i = 0; i < part.count; i++) {
                    await conn.execute(
                        `INSERT INTO hsk_questions
                           (section_id, group_id, question_number, question_type,
                            correct_answer, points, audio_play_count)
                         VALUES (?, ?, ?, ?, ?, 1, 2)`,
                        [sectionId, groupId, questionNumber, part.questionType, PLACEHOLDER_ANSWER]
                    );
                    questionNumber++;
                    sectionQCount++;
                }
            }

            // Bump section count
            await conn.execute(
                `UPDATE hsk_sections SET total_questions = ? WHERE id = ?`,
                [sectionQCount, sectionId]
            );
            totalQuestions += sectionQCount;
        }

        // 3. Bump exam total
        await conn.execute(
            `UPDATE hsk_exams SET total_questions = ? WHERE id = ?`,
            [totalQuestions, examId]
        );

        await conn.commit();
        return { examId, totalQuestions };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    instantiateTemplate,
    // Re-exported for FE preview (level summary) qua endpoint phụ nếu cần.
    TEMPLATES,
};
