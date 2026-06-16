/**
 * HSK v2 — dựng đề từ "blueprint" (file JSON trích từ đề thật ở hsktest/).
 *
 * Khác `hsk-exam-template.service.js` (template cứng): service này đọc cấu trúc
 * CHÍNH XÁC từng level (số đáp án 3/4, image_match mấy ảnh, lưới/bank 6 hay 5 ô,
 * tách group đúng) + có thể SEED nội dung thật (transcript/đáp án/ngân hàng từ-câu).
 *
 *   instantiateV2(level, { seed })
 *     - seed=false → đề TRỐNG nhưng đúng cấu trúc (options/option_images đúng số,
 *       group đúng số ô) để admin tự nhập.
 *     - seed=true  → đề có sẵn NỘI DUNG THẬT từ đề mẫu (admin chỉ cần upload 1 audio).
 *
 * Mọi đề tạo ra đều format_version = 2.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const BLUEPRINT_DIR = path.join(__dirname, '../data/hsk-v2');
const V2_LEVELS = [1, 2, 3];

const SECTION_TITLES = {
    listening: 'Phần 1 — Nghe (听力)',
    reading: 'Phần 2 — Đọc (阅读)',
    writing: 'Phần 3 — Viết (书写)',
};

const GROUP_TITLE = {
    image_grid: 'Lưới ảnh A–F',
    word_bank: 'Ngân hàng từ',
    reply_bank: 'Ngân hàng câu trả lời',
    passage: 'Đoạn đọc',
    passage_multi: 'Đoạn đọc dùng chung',
};

function loadBlueprint(level) {
    const lvl = Number(level);
    if (!V2_LEVELS.includes(lvl)) return null;
    try {
        return JSON.parse(fs.readFileSync(path.join(BLUEPRINT_DIR, `hsk${lvl}.json`), 'utf-8'));
    } catch {
        return null;
    }
}

function labelsOf(group) {
    if (Array.isArray(group.labels) && group.labels.length) return group.labels;
    const n = group.items || 6;
    return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

// Nội dung dùng chung của group (blank = trống đúng số ô; seed = điền thật).
function buildGroupContent(group, seed) {
    const labels = labelsOf(group);
    const srcItems = seed && group.content && Array.isArray(group.content.items) ? group.content.items : null;

    if (group.type === 'image_grid') {
        // 1 ảnh ghép A–F. seed có thể kèm image_url (OCR tách được); nếu không → trống, admin upload.
        const url = (seed && group.content && group.content.image_url) ? String(group.content.image_url) : '';
        return { image_url: url, items: labels.map(l => ({ label: l })) };
    }
    if (group.type === 'word_bank') {
        const items = srcItems
            ? srcItems.map(it => ({ label: it.label, word: it.word || '', pinyin: it.pinyin || '', vi: it.translation_vi || '' }))
            : labels.map(l => ({ label: l, word: '', pinyin: '', vi: '' }));
        return { items };
    }
    if (group.type === 'reply_bank') {
        const items = srcItems
            ? srcItems.map(it => ({ label: it.label, sentence_zh: it.sentence_zh || '', sentence_pinyin: it.pinyin || '', vi: it.translation_vi || '' }))
            : labels.map(l => ({ label: l, sentence_zh: '', sentence_pinyin: '', vi: '' }));
        return { items };
    }
    if (group.type === 'passage' || group.type === 'passage_multi') {
        const c = (seed && group.content) ? group.content : {};
        return group.type === 'passage'
            ? { passage_zh: c.passage_zh || '', passage_pinyin: c.pinyin || '', passage_vi: c.translation_vi || '' }
            : { passage: c.passage || c.passage_zh || '', passage_pinyin: c.pinyin || '', passage_vi: c.translation_vi || '' };
    }
    return null;
}

// options (text) cho multiple_choice — đúng options_count; seed thì điền text+pinyin.
function buildOptions(part, q, seed) {
    if (part.question_type !== 'multiple_choice') return [];
    const n = part.options_count || 3;
    if (seed && Array.isArray(q.options) && q.options.length) {
        return q.options.map((o, i) => ({ label: o.label || String.fromCharCode(65 + i), text: o.text || '', pinyin: o.pinyin || '' }));
    }
    return Array.from({ length: n }, (_, i) => ({ label: String.fromCharCode(65 + i), text: '', pinyin: '' }));
}

// option_images cho image_match — đúng số ảnh (HSK1-3 = 3). seed có thể kèm URL (OCR), nếu không → trống.
function buildOptionImages(part, q, seed) {
    if (part.question_type !== 'image_match') return [];
    const n = part.options_count || 3;
    const base = Array.from({ length: n }, () => '');
    if (seed && q && Array.isArray(q.option_images)) {
        for (let i = 0; i < n; i += 1) base[i] = q.option_images[i] ? String(q.option_images[i]) : '';
    }
    return base;
}

function buildMeta(q, seed) {
    if (!seed) return null;
    const meta = (q.meta && typeof q.meta === 'object') ? { ...q.meta } : {};
    if (q.pinyin && q.question_text) {
        meta.pinyin = { ...(meta.pinyin || {}), question_text: q.pinyin };
    }
    if (q.translation_vi && !meta.translation_vi) meta.translation_vi = q.translation_vi;
    return Object.keys(meta).length ? meta : null;
}

/**
 * @param {1|2|3} level
 * @param {{seed?: boolean, title?: string, examType?: 'practice'|'exam'}} [opts]
 * @returns {Promise<{examId:number, totalQuestions:number}>}
 */
async function instantiateV2(level, opts = {}) {
    const bp = loadBlueprint(level);
    if (!bp) {
        const e = new Error(`HSK ${level} chưa có blueprint v2 (chỉ hỗ trợ HSK 1-3).`);
        e.code = 'UNSUPPORTED_LEVEL';
        throw e;
    }
    return instantiateBlueprint(bp, opts);
}

/**
 * Insert 1 đề v2 từ blueprint OBJECT. Dùng cho cả tạo tay (seed) lẫn OCR v2
 * (AI điền nội dung + ảnh vào blueprint rồi gọi hàm này với seed=true, audioUrl).
 * @param {object} bp blueprint (có/không nội dung)
 * @param {{seed?:boolean, title?:string, examType?:string, audioUrl?:string|null}} [opts]
 */
async function instantiateBlueprint(bp, opts = {}) {
    const { seed = false, title, examType = 'exam', audioUrl = null } = opts;
    const level = bp.level;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const examTitle = title || `HSK ${level} v2 — ${seed ? `mẫu ${bp.exam_code}` : 'Đề mới'} (${new Date().toISOString().slice(0, 10)})`;
        const type = (examType === 'practice' || examType === 'exam') ? examType : 'exam';
        const desc = seed
            ? `Seed từ đề ${bp.exam_code}. Nhớ upload 1 file audio cho cả đề (gợi ý: ${bp.audio_file}).`
            : 'Đề v2 (template chuẩn) — nhập nội dung + upload 1 audio.';

        const [examRes] = await conn.execute(
            `INSERT INTO hsk_exams
               (title, hsk_level, exam_type, duration_minutes, passing_score, description, total_questions, format_version, audio_url)
             VALUES (?, ?, ?, ?, ?, ?, 0, 2, ?)`,
            [examTitle, level, type, bp.duration_minutes || 60, bp.passing_score || 120, desc, audioUrl || null]
        );
        const examId = examRes.insertId;

        let total = 0;
        let sIdx = 0;
        for (const sec of bp.sections) {
            sIdx += 1;
            const [secRes] = await conn.execute(
                `INSERT INTO hsk_sections
                   (exam_id, section_type, section_order, title, instructions, duration_seconds, total_questions)
                 VALUES (?, ?, ?, ?, ?, 0, 0)`,
                [examId, sec.section_type, sIdx, sec.title_vi || SECTION_TITLES[sec.section_type] || sec.section_type, sec.instructions_vi || '']
            );
            const sectionId = secRes.insertId;
            let secCount = 0;
            let partIdx = 0;

            for (const part of sec.parts) {
                partIdx += 1;
                let groupId = null;
                if (part.group) {
                    const content = buildGroupContent(part.group, seed);
                    const grpInstructions = (seed && part.group.type === 'image_grid' && part.group.content && part.group.content.image_desc)
                        ? String(part.group.content.image_desc) : null;
                    const [grpRes] = await conn.execute(
                        `INSERT INTO hsk_question_groups
                           (section_id, group_type, title_vi, instructions_vi, content, order_index)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [sectionId, part.group.type, GROUP_TITLE[part.group.type] || null, grpInstructions, JSON.stringify(content), partIdx]
                    );
                    groupId = grpRes.insertId;
                }

                for (const q of part.questions) {
                    const options = buildOptions(part, q, seed);
                    const optionImages = buildOptionImages(part, q, seed);
                    const meta = buildMeta(q, seed);
                    await conn.execute(
                        `INSERT INTO hsk_questions
                           (section_id, group_id, question_number, question_type, question_text, passage, statement,
                            question_image, transcript, options, option_images, correct_answer, explanation, difficulty, points, audio_play_count, meta)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 2, ?)`,
                        [
                            sectionId, groupId, q.number, part.question_type,
                            seed ? (q.question_text || null) : null,
                            seed ? (q.passage || null) : null,
                            seed ? (q.statement || null) : null,
                            seed ? (q.question_image || null) : null,
                            seed ? (q.transcript || null) : null,
                            JSON.stringify(options),
                            JSON.stringify(optionImages),
                            seed ? (q.correct_answer || 'A') : 'A',
                            null,
                            meta ? JSON.stringify(meta) : null,
                        ]
                    );
                    secCount += 1;
                    total += 1;
                }
            }
            await conn.execute(`UPDATE hsk_sections SET total_questions = ? WHERE id = ?`, [secCount, sectionId]);
        }

        await conn.execute(`UPDATE hsk_exams SET total_questions = ? WHERE id = ?`, [total, examId]);
        await conn.commit();
        return { examId, totalQuestions: total };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = { loadBlueprint, instantiateV2, instantiateBlueprint, V2_LEVELS };
