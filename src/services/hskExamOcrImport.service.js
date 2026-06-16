/**
 * HSK OCR import service.
 *
 * This is an additive admin hook: it creates draft HSK exam data in the same
 * schema used by existing CRUD, but it does not change CRUD behavior.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const gcs = require('./gcs.service');
const gemini = require('./gemini.service');
const pdfImageExtract = require('./pdfImageExtract.client');
const { TEMPLATES } = require('./hsk-exam-template.service'); // nguồn chuẩn cấu trúc đề (range→type)
const hskV2 = require('./hsk-v2.service'); // OCR v2: blueprint cố định + AI điền nội dung

const IMPORT_MODEL = process.env.HSK_IMPORT_MODEL || 'gemini-2.5-flash';
const IMPORT_LOCATION = process.env.HSK_IMPORT_LOCATION || 'global';
const MAX_RAW_TEXT_CHARS = parseInt(process.env.HSK_IMPORT_MAX_RAW_TEXT_CHARS || '180000', 10);
const MAX_OUTPUT_TOKENS = parseInt(process.env.HSK_IMPORT_MAX_OUTPUT_TOKENS || '65536', 10);
const IMPORT_TIMEOUT_MS = parseInt(process.env.HSK_IMPORT_TIMEOUT_MS || '180000', 10);
const IMPORT_THINKING_BUDGET = (() => {
    const raw = process.env.HSK_IMPORT_THINKING_BUDGET;
    if (raw === undefined || raw === '') return 8192;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? 8192 : parsed;
})();

const ALLOWED_QUESTION_TYPES = new Set([
    'image_match',
    'true_false',
    'multiple_choice',
    'fill_blank',
    'sentence_order',
    'error_identify',
    'short_answer',
    'image_grid_match',
    'word_bank_fill',
    'reply_match',
    'sentence_assembly',
    'fill_hanzi',
    'image_keyword_sentence',
    'short_essay',
    'multi_blank_choice',
    'sentence_into_passage',
    'summary_essay',
]);

const ALLOWED_GROUP_TYPES = new Set(['image_grid', 'word_bank', 'reply_bank', 'passage', 'passage_multi']);
const ALLOWED_SECTION_TYPES = new Set(['listening', 'reading', 'writing']);

// Canonical Vietnamese title per group_type. The AI often labels groups of the
// SAME type inconsistently (e.g. "Lưới hình", "Bảng ảnh A-F", "Chọn hình") — we
// normalize known types to one label so the exam UI is consistent. Unknown types
// keep whatever the AI provided.
const GROUP_TITLE_BY_TYPE = {
    image_grid: 'Lưới ảnh A-F',
    word_bank: 'Ngân hàng từ',
    reply_bank: 'Ngân hàng câu trả lời',
    passage: 'Đoạn đọc',
    passage_multi: 'Đoạn đọc dùng chung',
};

// EXACT content schema mỗi group_type — phải khớp FE GroupHeader.tsx /
// GroupManager.tsx, nếu không phần "đại diện group" (ngân hàng từ/câu trả lời,
// đoạn văn, lưới ảnh A-F) sẽ render rỗng. Trước đây prompt chỉ ghi `content: {}`
// nên AI bỏ trống → group import thiếu nội dung dùng chung.
const GROUP_CONTENT_SCHEMA_GUIDE = [
    'CÁCH ĐIỀN group.content THEO group_type (BẮT BUỘC — copy nguyên văn tiếng Trung từ PDF, KHÔNG bịa):',
    '- word_bank: { "items": [ {"label":"A","word":"<từ in trên đề>","pinyin":"<nếu có>"}, ... A→F ], "example"?: {"label":"<chữ ví dụ>","sentence_zh":"<câu 例如>","sentence_pinyin":"<nếu có>"} }',
    '- reply_bank: { "items": [ {"label":"A","sentence_zh":"<câu trả lời in trên đề>","sentence_pinyin":"<nếu có>"}, ... A→F ], "example"?: {"label":"...","prompt_zh":"<câu 例如>","prompt_pinyin":"..."} }',
    '- image_grid: { "image_url":"", "items": [ {"label":"A"}, ... đúng SỐ NHÃN A→F/A→E ], "example"?: {"label":"<chữ>","content":{"zh":"<câu 例如>","pinyin":"..."}} } — KHÔNG nhìn thấy ảnh: để image_url RỖNG (hệ thống tự gán 1 ẢNH GHÉP A–F sau); items CHỈ cần label (A→F) để render đáp án, KHÔNG cần ảnh từng ô.',
    '- passage: { "passage_zh":"<đoạn văn nguyên văn>", "passage_pinyin"?:"", "passage_vi"?:"" }',
    '- passage_multi: { "passage":"<đoạn văn dùng chung nguyên văn>", "passage_pinyin"?:"", "passage_vi"?:"" }',
    'Mỗi câu thuộc cụm dùng chung PHẢI set group_ref = local_id của group tương ứng. Nếu thiếu nội dung bank/đoạn văn trong PDF → để rỗng và push warning, KHÔNG tự nghĩ ra.',
].join('\n');

const HSK_EXPECTED = {
    1: { total: 40, duration: 35, passing: 120, sections: { listening: 20, reading: 20 } },
    2: { total: 60, duration: 50, passing: 120, sections: { listening: 35, reading: 25 } },
    3: { total: 80, duration: 85, passing: 180, sections: { listening: 40, reading: 30, writing: 10 } },
    4: { total: 100, duration: 105, passing: 180, sections: { listening: 45, reading: 40, writing: 15 } },
    5: { total: 100, duration: 125, passing: 180, sections: { listening: 45, reading: 45, writing: 10 } },
    6: { total: 101, duration: 140, passing: 180, sections: { listening: 50, reading: 50, writing: 1 } },
};

const HSK4_SECTION_PLANS = [
    {
        section_type: 'listening',
        section_order: 1,
        title: 'Phần I — Nghe hiểu (听力)',
        instructions: 'Nghe audio liên tục và chọn đáp án đúng.',
        duration_seconds: 1800,
        range: '1-45',
        expectedCount: 45,
        maxOutputTokens: 48000,
        guide: [
            'Questions 1-10: true_false, use statement + transcript, correct_answer A for TRUE and B for FALSE.',
            'Questions 11-45: multiple_choice, use options A-D where available, transcript hidden in result only.',
            'Do not create per-question audio; section-level audio is used in exam mode.',
        ].join('\n'),
    },
    {
        section_type: 'reading',
        section_order: 2,
        title: 'Phần II — Đọc hiểu (阅读)',
        instructions: 'Đọc nội dung và chọn đáp án đúng.',
        duration_seconds: 2400,
        range: '46-85',
        expectedCount: 40,
        maxOutputTokens: 48000,
        guide: [
            'Questions 46-55: word_bank_fill. Create word_bank groups A-F and set group_ref.',
            'Questions 56-65: sentence_order.',
            'Questions 66-85: multiple_choice. Use passage_multi groups for shared passages.',
        ].join('\n'),
    },
    {
        section_type: 'writing',
        section_order: 3,
        title: 'Phần III — Viết (书写)',
        instructions: 'Hoàn thành câu và viết câu theo ảnh/từ khóa.',
        duration_seconds: 1500,
        range: '86-100',
        expectedCount: 15,
        maxOutputTokens: 24000,
        guide: [
            'Questions 86-95: sentence_assembly. question_text must be chunks separated by " / ".',
            'Questions 96-100: image_keyword_sentence. If image cannot be extracted, leave question_image empty and set meta.keyword.',
        ].join('\n'),
    },
];

// Suy ra "section plan" (range câu → question_type) cho 1 level từ TEMPLATES —
// nguồn chuẩn dùng chung với trình tạo đề thủ công. Nhờ vậy MỌI level đều import
// theo từng section (1 call/section) → hết truncation giữa đề (nguyên nhân HSK1-3
// rớt câu). Đánh số câu LIÊN TỤC qua các section như đề thật.
function buildSectionPlans(level) {
    const tmpl = TEMPLATES[level];
    if (!tmpl || !Array.isArray(tmpl.sections)) return null;
    const plans = [];
    let qNum = 1;
    tmpl.sections.forEach((sec, sIdx) => {
        const start = qNum;
        const guideLines = [];
        for (const part of sec.parts) {
            const from = qNum;
            const to = qNum + part.count - 1;
            const groupNote = part.group
                ? ` — tạo 1 group ${part.group.type} (A–F) dùng chung và set group_ref cho mỗi câu`
                : '';
            guideLines.push(`Questions ${from}-${to}: ${part.questionType}${groupNote}.`);
            qNum += part.count;
        }
        const end = qNum - 1;
        plans.push({
            section_type: sec.section_type,
            section_order: sIdx + 1,
            title: sec.title,
            instructions: sec.instructions,
            duration_seconds: sec.duration_seconds,
            range: `${start}-${end}`,
            expectedCount: end - start + 1,
            maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, Math.max(16000, (end - start + 1) * 1000)),
            guide: guideLines.join('\n'),
        });
    });
    return plans;
}

// HSK4 giữ guide tinh chỉnh tay (HSK4_SECTION_PLANS); các level khác suy từ TEMPLATES.
function getSectionPlans(level) {
    if (level === 4) return HSK4_SECTION_PLANS;
    return buildSectionPlans(level);
}

function jsonOrNull(value) {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}

function truncateText(value, maxChars = MAX_RAW_TEXT_CHARS) {
    const text = String(value || '').trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n\n[TRUNCATED ${text.length - maxChars} chars]`;
}

function safeFilename(originalName) {
    const ext = path.extname(originalName || '').toLowerCase();
    const base = path.basename(originalName || 'file', ext)
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'file';
    return `${base}${ext}`;
}

function ensureLocalUploadDir(kind) {
    const dir = path.join(__dirname, `../../public/uploads/${kind}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function createJob({ adminId, title, hskLevel, examType, files }) {
    const [result] = await db.execute(
        `INSERT INTO hsk_import_jobs
            (admin_id, status, progress, title, hsk_level, exam_type, file_names, warnings, errors)
         VALUES (?, 'queued', 0, ?, ?, ?, ?, JSON_ARRAY(), JSON_ARRAY())`,
        [
            adminId || null,
            title || null,
            hskLevel,
            examType,
            jsonOrNull(files),
        ]
    );
    return result.insertId;
}

// Whitelist of columns updateJob may write. Column names are interpolated into
// the SQL string (cannot be parameterized), so we MUST restrict them to a known
// set — never let arbitrary patch keys reach the query (SQL injection on column
// names otherwise).
const UPDATABLE_JOB_FIELDS = new Set([
    'status', 'progress', 'raw_text', 'structured_json',
    'summary', 'warnings', 'errors', 'exam_id', 'completed_at',
]);

async function updateJob(jobId, patch) {
    const fields = [];
    const params = [];
    const jsonFields = new Set(['file_names', 'summary', 'warnings', 'errors']);

    for (const [field, value] of Object.entries(patch)) {
        if (!UPDATABLE_JOB_FIELDS.has(field)) {
            throw new Error(`updateJob: refusing to update unknown column "${field}"`);
        }
        fields.push(`${field} = ?`);
        if (jsonFields.has(field)) params.push(jsonOrNull(value));
        else params.push(value);
    }

    if (!fields.length) return;
    params.push(jobId);
    await db.execute(`UPDATE hsk_import_jobs SET ${fields.join(', ')} WHERE id = ?`, params);
}

async function getJob(jobId) {
    const [rows] = await db.execute('SELECT * FROM hsk_import_jobs WHERE id = ?', [jobId]);
    const row = rows[0];
    if (!row) return null;
    return {
        ...row,
        file_names: parseJson(row.file_names, {}),
        summary: parseJson(row.summary, null),
        warnings: parseJson(row.warnings, []),
        errors: parseJson(row.errors, []),
    };
}

function parseJson(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

async function extractPdfText(file, warnings) {
    let text = '';
    try {
        const pdfParse = require('pdf-parse');
        // Pin to pdf-parse@1.x for Node 18 on the droplet. Keep this call shape
        // intentionally simple; pdf-parse@2 requires newer Node/browser polyfills.
        const result = await pdfParse(file.buffer);
        text = result?.text || '';
    } catch (error) {
        warnings.push(`Không đọc được text layer PDF bằng pdf-parse: ${error.message}`);
    }

    if (shouldUseDocumentAi(text)) {
        const ocrText = await extractWithDocumentAi(file, warnings);
        if (ocrText) text = ocrText;
    }

    return text;
}

function shouldUseDocumentAi(text) {
    if (process.env.HSK_IMPORT_FORCE_DOCUMENT_AI === 'true') return true;
    const cleaned = String(text || '').trim();
    if (cleaned.length < 500) return process.env.HSK_IMPORT_OCR_ENABLED === 'true';
    const chineseChars = cleaned.match(/[\u3400-\u9fff]/g)?.length || 0;
    return process.env.HSK_IMPORT_OCR_ENABLED === 'true' && chineseChars < 20;
}

async function extractWithDocumentAi(file, warnings) {
    const processorName = process.env.DOCUMENT_AI_PROCESSOR_NAME;
    if (!processorName) {
        warnings.push('Document AI chưa cấu hình; dùng text PDF đã extract được.');
        return '';
    }

    try {
        const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
        const client = new DocumentProcessorServiceClient();
        const [result] = await client.processDocument({
            name: processorName,
            rawDocument: {
                content: file.buffer.toString('base64'),
                mimeType: file.mimetype || 'application/pdf',
            },
        });
        return result?.document?.text || '';
    } catch (error) {
        warnings.push(`Document AI OCR lỗi: ${error.message}`);
        return '';
    }
}

async function extractAnswerText(file, warnings) {
    if (!file) return '';
    const ext = path.extname(file.originalname || '').toLowerCase();

    try {
        if (ext === '.docx') {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            return result.value || '';
        }
        if (ext === '.pdf') {
            return await extractPdfText(file, warnings);
        }
        return file.buffer.toString('utf8');
    } catch (error) {
        warnings.push(`Không đọc được file đáp án ${file.originalname}: ${error.message}`);
        return '';
    }
}

// Per-level exam blueprints. Ranges/sub-types come from the real HSK papers
// documented in hsk_refractor/PLAN_HSK1_3.md (HSK 1-3) and the HSK4 fixed form.
// HSK 5/6 fall through to a generic blueprint until their structure is added.
const HSK_BLUEPRINTS = {
    1: [
        'HSK1 fixed form (40 questions):',
        '- Listening: questions 1-20.',
        '  - 1-10 true_false: audio + image. correct_answer A=TRUE, B=FALSE. Put the spoken text in transcript.',
        '  - 11-15 image_grid_match: ONE shared image_grid group with items A-F. Each question correct_answer is a letter A-F; set group_ref to that group.',
        '  - 16-20 multiple_choice: audio + 3 options A/B/C. Put per-option pinyin in option.pinyin.',
        '- Reading: questions 21-40.',
        '  - 21-25 true_false: image + a Chinese word. correct_answer A=TRUE, B=FALSE.',
        '  - 26-30 image_grid_match: ONE shared image_grid group A-F; match each sentence to a picture.',
        '  - 31-35 reply_match: ONE shared reply_bank group A-F; match each sentence to a reply.',
        '  - 36-40 word_bank_fill: ONE shared word_bank group A-F; fill the blank in each sentence.',
        '- Create exactly one shared group per cluster (11-15, 26-30, 31-35, 36-40) and set group_ref on every question in that cluster.',
    ].join('\n'),
    2: [
        'HSK2 fixed form (60 questions):',
        '- Listening: questions 1-35.',
        '  - 1-10 true_false: audio + image. correct_answer A=TRUE, B=FALSE; spoken text in transcript.',
        '  - 11-15 image_grid_match: shared image_grid group A-F.',
        '  - 16-20 image_grid_match: a DIFFERENT shared image_grid group A-E (5 items).',
        '  - 21-30 multiple_choice: audio + 3 options A/B/C (with option.pinyin).',
        '  - 31-35 multiple_choice: multi-turn audio dialogue + a 问 question + 3 options.',
        '- Reading: questions 36-60.',
        '  - 36-40 image_grid_match: shared image_grid group A-F; match sentence to picture.',
        '  - 41-45 word_bank_fill: shared word_bank group A-F; fill the blank.',
        '  - 46-50 true_false: passage + a ★ statement. Put long text in passage, the judged line in statement. correct_answer Đúng/Sai.',
        '  - 51-55 reply_match: shared reply_bank group A-F.',
        '  - 56-60 reply_match: a DIFFERENT shared reply_bank group A-E (5 items).',
        '- Create one shared group per cluster and set group_ref on each question.',
    ].join('\n'),
    3: [
        'HSK3 fixed form (80 questions):',
        '- Listening: questions 1-40.',
        '  - 1-10 image_grid_match: shared image_grid group A-F; match each audio dialogue to a picture.',
        '  - 11-20 true_false: audio + a ★ statement. Put audio in transcript, judged line in statement. correct_answer A=TRUE, B=FALSE.',
        '  - 21-30 multiple_choice: audio + 3 options A/B/C (no pinyin needed at this level).',
        '  - 31-40 multiple_choice: audio dialogue + a question + 3 options.',
        '- Reading: questions 41-70.',
        '  - 41-45 reply_match: shared reply_bank group A-F.',
        '  - 46-50 reply_match: a DIFFERENT shared reply_bank group A-E (5 items).',
        '  - 51-60 word_bank_fill: shared word_bank group A-F; fill the blank in sentence/dialogue.',
        '  - 61-70 multiple_choice: passage + a ★ statement + 3 options. Put the reading text in passage.',
        '- Writing: questions 71-80.',
        '  - 71-75 sentence_assembly. question_text = the shuffled chunks separated by " / "; correct_answer = the full correct sentence.',
        '  - 76-80 fill_hanzi. Put pinyin hint in meta.pinyin_hint and the sentence-with-blank in meta.context_zh_with_blank; correct_answer = the missing character.',
        '- Create one shared group per cluster and set group_ref on each question.',
    ].join('\n'),
    4: [
        'HSK4 fixed form:',
        '- Listening: questions 1-45.',
        '  - 1-10 true_false, use statement + transcript, correct_answer must be A for TRUE and B for FALSE.',
        '  - 11-45 multiple_choice, four options A-D where available, transcript hidden in result only.',
        '- Reading: questions 46-85.',
        '  - 46-55 word_bank_fill with word_bank groups A-F.',
        '  - 56-65 sentence_order.',
        '  - 66-85 multiple_choice. Use passage_multi groups for shared passages.',
        '- Writing: questions 86-100.',
        '  - 86-95 sentence_assembly. question_text must contain chunks separated by " / ".',
        '  - 96-100 image_keyword_sentence. Put keyword in meta.keyword if present.',
    ].join('\n'),
};

function buildBlueprint(level) {
    if (HSK_BLUEPRINTS[level]) return HSK_BLUEPRINTS[level];

    const expected = HSK_EXPECTED[level];
    return [
        `HSK${level} expected total: ${expected?.total || 'unknown'} questions.`,
        `Expected section counts: ${JSON.stringify(expected?.sections || {})}.`,
        'Keep original paper order and section grouping.',
        'Use existing HanXue question_type/group_type only; do not invent new types.',
    ].join('\n');
}

function buildPrompt({ title, hskLevel, examType, pdfText, answerText }) {
    const expected = HSK_EXPECTED[hskLevel] || {};
    return [
        'Bạn là bộ import đề thi HSK cho hệ thống HanXue. Trả về CHỈ JSON hợp lệ, không markdown.',
        '',
        'Mục tiêu: chuyển nội dung đề PDF + file đáp án thành JSON import đúng schema HanXue, giữ đúng form đề gốc.',
        'QUY TẮC TUYỆT ĐỐI:',
        '- KHÔNG BỊA NỘI DUNG. Mọi text (statement, transcript, question_text, options) phải copy nguyên văn từ PDF TEXT phía dưới.',
        '- Nếu không tìm thấy nội dung cho câu nào → để field rỗng và push warning "Không tìm thấy nội dung câu <N> trong PDF".',
        '- correct_answer LẤY TỪ ANSWER TEXT, map theo question_number (không map theo thứ tự xuất hiện). VD ANSWER TEXT "1.B 2.A 3.D" → câu 1=B, câu 2=A, câu 3=D.',
        '- KHÔNG dịch sang tiếng Việt. Giữ nguyên tiếng Trung như trong PDF.',
        '',
        buildBlueprint(hskLevel),
        '',
        'Output JSON shape:',
        JSON.stringify({
            exam: {
                title,
                hsk_level: hskLevel,
                exam_type: examType,
                duration_minutes: expected.duration || null,
                passing_score: expected.passing || null,
                description: 'Imported by OCR',
            },
            sections: [
                {
                    section_type: 'listening|reading|writing',
                    section_order: 1,
                    title: '...',
                    instructions: '...',
                    duration_seconds: 0,
                    groups: [
                        {
                            local_id: 'g1',
                            group_type: 'word_bank|reply_bank|image_grid|passage|passage_multi',
                            title_vi: '',
                            instructions_vi: '',
                            content: {},
                            order_index: 1,
                        },
                    ],
                    questions: [
                        {
                            question_number: 1,
                            question_type: 'multiple_choice',
                            group_ref: null,
                            question_text: '',
                            passage: '',
                            statement: '',
                            question_image: '',
                            transcript: '',
                            options: [{ label: 'A', text: '' }],
                            option_images: [],
                            correct_answer: '',
                            explanation: '',
                            difficulty: 1,
                            points: 1,
                            meta: {},
                        },
                    ],
                },
            ],
            warnings: [],
        }, null, 2),
        '',
        'Important schema rules:',
        '- section_type chỉ được là listening, reading, writing.',
        `- question_type chỉ được là: ${Array.from(ALLOWED_QUESTION_TYPES).join(', ')}.`,
        `- group_type chỉ được là: ${Array.from(ALLOWED_GROUP_TYPES).join(', ')}.`,
        '- group_ref trỏ tới groups[].local_id hoặc index nhóm trong cùng section.',
        GROUP_CONTENT_SCHEMA_GUIDE,
        '- options có thể là string[] hoặc object[] {label,text,pinyin}; correct_answer dùng label A/B/C/D hoặc đáp án mẫu. true_false bắt buộc A=TRUE, B=FALSE.',
        '- Với sentence_assembly, question_text là các mảnh theo format "词1 / 词2 / 词3".',
        '- Với image_keyword_sentence, nếu ảnh chưa extract được thì question_image rỗng và meta.keyword chứa từ khóa.',
        '',
        '--- PDF TEXT ---',
        truncateText(pdfText),
        '',
        '--- ANSWER TEXT ---',
        truncateText(answerText),
    ].join('\n');
}

function buildSectionPrompt({ hskLevel, pdfText, answerText }, plan) {
    return [
        'Bạn là bộ import đề thi HSK cho hệ thống HanXue. Trả về CHỈ JSON hợp lệ, không markdown.',
        '',
        `Nhiệm vụ: parse riêng section ${plan.section_type} của HSK${hskLevel}, câu ${plan.range}.`,
        'QUY TẮC TUYỆT ĐỐI:',
        '- KHÔNG BỊA NỘI DUNG. Mọi text (statement, transcript, question_text, options) phải copy nguyên văn từ PDF TEXT phía dưới.',
        '- Nếu không tìm thấy nội dung cho câu nào → để field rỗng và push warning "Không tìm thấy nội dung câu <N> trong PDF". Tuyệt đối KHÔNG đoán hay tự nghĩ ra.',
        '- correct_answer LẤY TỪ ANSWER TEXT, map theo question_number (không map theo thứ tự xuất hiện). Ví dụ ANSWER TEXT "1.B 2.A 3.D" nghĩa là câu 1=B, câu 2=A, câu 3=D.',
        '- Với listening true_false: statement = câu in trên đề (ngắn, ~10-30 ký tự), transcript = đoạn audio đầy đủ (~50-200 ký tự). KHÔNG đảo ngược 2 field này.',
        '- KHÔNG dịch sang tiếng Việt. Giữ nguyên tiếng Trung như trong PDF.',
        '',
        plan.guide,
        '',
        'Output JSON shape:',
        JSON.stringify({
            section: {
                section_type: plan.section_type,
                section_order: plan.section_order,
                title: plan.title,
                instructions: plan.instructions,
                duration_seconds: plan.duration_seconds,
                groups: [
                    {
                        local_id: 'g1',
                        group_type: 'word_bank|reply_bank|image_grid|passage|passage_multi',
                        title_vi: '',
                        instructions_vi: '',
                        content: {},
                        order_index: 1,
                    },
                ],
                questions: [
                    {
                        question_number: Number(plan.range.split('-')[0]),
                        question_type: 'multiple_choice',
                        group_ref: null,
                        question_text: '',
                        passage: '',
                        statement: '',
                        question_image: '',
                        transcript: '',
                        options: [{ label: 'A', text: '' }],
                        option_images: [],
                        correct_answer: '',
                        explanation: '',
                        difficulty: 1,
                        points: 1,
                        meta: {},
                    },
                ],
            },
            warnings: [],
        }, null, 2),
        '',
        'Important schema rules:',
        '- Return exactly one section object.',
        `- Return exactly ${plan.expectedCount} questions, numbers ${plan.range}.`,
        `- question_type chỉ được là: ${Array.from(ALLOWED_QUESTION_TYPES).join(', ')}.`,
        `- group_type chỉ được là: ${Array.from(ALLOWED_GROUP_TYPES).join(', ')}.`,
        '- group_ref trỏ tới groups[].local_id hoặc index nhóm trong cùng section.',
        GROUP_CONTENT_SCHEMA_GUIDE,
        '- correct_answer dùng label A/B/C/D hoặc đáp án mẫu. true_false bắt buộc A=TRUE, B=FALSE.',
        '- multiple_choice: phải có options A-D (hoặc A-C) + correct_answer là nhãn.',
        '- sentence_assembly: question_text là các mảnh "词1 / 词2 / 词3"; correct_answer là câu hoàn chỉnh.',
        '- image_keyword_sentence: nếu ảnh chưa tách được, để question_image rỗng và đặt meta.keyword.',
        '- fill_hanzi: pinyin gợi ý ở meta.pinyin_hint, câu có chỗ trống ở meta.context_zh_with_blank; correct_answer là chữ Hán còn thiếu.',
        '- type trong guide chỉ là GỢI Ý theo mẫu đề; nếu nội dung thực tế trong PDF khác, ưu tiên GIỮ ĐÚNG nội dung + đáp án, TUYỆT ĐỐI không để câu trống.',
        '- Không include câu ngoài range được yêu cầu.',
        '',
        '--- PDF TEXT ---',
        truncateText(pdfText),
        '',
        '--- ANSWER TEXT ---',
        truncateText(answerText),
    ].join('\n');
}

function previewText(text, limit = 500) {
    const compact = String(text || '').replace(/\s+/g, ' ').trim();
    return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function extractJsonObject(text, label = 'AI response') {
    const clean = gemini.unwrapJsonFence(text);
    if (!clean) {
        throw new Error(`${label} is empty`);
    }
    try {
        return JSON.parse(clean);
    } catch {
        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            throw new Error(`${label} does not contain a JSON object. Preview: ${previewText(clean)}`);
        }
        try {
            return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
        } catch (error) {
            throw new Error(`${label} contains invalid JSON: ${error.message}. Preview: ${previewText(clean)}`);
        }
    }
}

async function generateImportJson(prompt, { label, maxOutputTokens }) {
    const request = async (content, attempt) => {
        const { text, finishReason, usage } = await gemini.chat([{ role: 'user', content }], {
            model: IMPORT_MODEL,
            location: IMPORT_LOCATION,
            temperature: 0,
            maxOutputTokens,
            timeoutMs: IMPORT_TIMEOUT_MS,
            responseMimeType: 'application/json',
            thinkingBudget: IMPORT_THINKING_BUDGET,
            systemInstruction: 'Return exactly one valid JSON object. Do not include markdown, comments, or prose outside JSON.',
        });

        try {
            return extractJsonObject(text, `${label} attempt ${attempt}`);
        } catch (error) {
            const preview = previewText(text, 700);
            error.aiResponsePreview = preview;
            error.finishReason = finishReason;
            error.usage = usage;
            console.error(`[hskImport] ${label} invalid JSON attempt ${attempt}:`, error.message);
            console.error(`[hskImport] ${label} finishReason=${finishReason || 'null'} usage=${JSON.stringify(usage || {})}`);
            console.error(`[hskImport] ${label} response preview attempt ${attempt}:`, preview);
            throw error;
        }
    };

    try {
        return await request(prompt, 1);
    } catch (firstError) {
        const retryPrompt = [
            prompt,
            '',
            'Your previous response was not a valid JSON object.',
            'Return ONLY one valid JSON object matching the requested schema.',
            'No markdown fences, no explanation, no bullet list, no text before or after JSON.',
        ].join('\n');

        try {
            return await request(retryPrompt, 2);
        } catch (secondError) {
            secondError.message = `${label} failed to return valid JSON after retry: ${secondError.message}`;
            secondError.cause = firstError;
            if (!secondError.aiResponsePreview && firstError.aiResponsePreview) {
                secondError.aiResponsePreview = firstError.aiResponsePreview;
            }
            if (!secondError.finishReason && firstError.finishReason) {
                secondError.finishReason = firstError.finishReason;
            }
            if (!secondError.usage && firstError.usage) {
                secondError.usage = firstError.usage;
            }
            throw secondError;
        }
    }
}

const SPARSE_OK_TYPES = new Set(['image_keyword_sentence', 'short_answer', 'short_essay', 'summary_essay']);

// Câu "shell": có question_number nhưng nội dung TRỐNG (AI trả câu rỗng do
// truncation/lẫn lộn) — đây chính là lý do "có câu nhưng mất đề + đáp án ABCD".
function isShellQuestion(q) {
    if (!q) return true;
    if (SPARSE_OK_TYPES.has(String(q.question_type || ''))) return false;
    const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const opts = Array.isArray(q.options) ? q.options.filter(o => {
        if (typeof o === 'string') return o.trim() !== '';
        return o && (has(o.text) || has(o.word) || has(o.value));
    }) : [];
    return !has(q.question_text) && !has(q.statement) && !has(q.transcript) && !has(q.passage) && opts.length < 2;
}

// Số câu THIẾU hoặc SHELL trong [start..end].
function missingOrShell(questions, start, end) {
    const byNum = new Map();
    for (const q of questions) byNum.set(Number(q.question_number), q);
    const out = [];
    for (let n = start; n <= end; n += 1) {
        const q = byNum.get(n);
        if (!q || isShellQuestion(q)) out.push(n);
    }
    return out;
}

// [56,57,58,99,100] → "56-58, 99-100"
function compactRanges(nums) {
    const s = [...new Set(nums)].sort((a, b) => a - b);
    const out = [];
    let i = 0;
    while (i < s.length) {
        let j = i;
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j += 1;
        out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
        i = j + 1;
    }
    return out.join(', ');
}

function buildMissingQuestionsPrompt({ hskLevel, pdfText, answerText }, plan, missing) {
    return [
        'Bạn là bộ import đề thi HSK cho hệ thống HanXue. Trả về CHỈ JSON hợp lệ, không markdown.',
        '',
        `Nhiệm vụ: CHỈ parse lại các câu ${missing.join(', ')} thuộc section ${plan.section_type} HSK${hskLevel}.`,
        'Các câu này lần trước bị THIẾU hoặc nội dung TRỐNG. Đọc kỹ PDF và điền ĐẦY ĐỦ (statement/transcript/question_text/options...).',
        'QUY TẮC: KHÔNG BỊA — copy nguyên văn từ PDF TEXT. correct_answer lấy từ ANSWER TEXT theo question_number. KHÔNG dịch sang tiếng Việt.',
        '',
        plan.guide,
        '',
        'Output JSON shape: { "questions": [ { "question_number": N, "question_type": "...", "question_text": "", "statement": "", "transcript": "", "options": [{"label":"A","text":""}], "correct_answer": "", "group_ref": null, "meta": {} } ] }',
        `- CHỈ trả các câu: ${missing.join(', ')}. KHÔNG trả câu khác.`,
        `- question_type chỉ được là: ${Array.from(ALLOWED_QUESTION_TYPES).join(', ')}.`,
        GROUP_CONTENT_SCHEMA_GUIDE,
        '- true_false bắt buộc A=TRUE, B=FALSE; multiple_choice cần options A-D + correct_answer.',
        '',
        '--- PDF TEXT ---',
        truncateText(pdfText),
        '',
        '--- ANSWER TEXT ---',
        truncateText(answerText),
    ].join('\n');
}

// Sau khi parse 1 section: nếu còn câu thiếu/shell → hỏi lại AI RIÊNG các số đó
// (1 vòng) rồi merge. Còn sót → warning liệt kê đích danh (KHÔNG chặn import).
async function fillMissingQuestions(input, plan, questions, warnings) {
    const [start, end] = plan.range.split('-').map(Number);
    let missing = missingOrShell(questions, start, end);
    if (!missing.length) return questions;

    warnings.push(`Section ${plan.section_type}: thiếu/trống câu ${compactRanges(missing)} → đang hỏi lại AI.`);
    try {
        const prompt = buildMissingQuestionsPrompt(input, plan, missing);
        const parsed = await generateImportJson(prompt, {
            label: `HSK${input.hskLevel} ${plan.section_type} re-ask`,
            maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, Math.max(8000, missing.length * 1200)),
        });
        const refilled = Array.isArray(parsed.questions) ? parsed.questions
            : (parsed.section && Array.isArray(parsed.section.questions) ? parsed.section.questions : []);
        const byNum = new Map(questions.map(q => [Number(q.question_number), q]));
        for (const rq of refilled) {
            const n = Number(rq.question_number);
            if (n >= start && n <= end && !isShellQuestion(rq)) byNum.set(n, rq);
        }
        questions = Array.from(byNum.values()).sort((a, b) => Number(a.question_number) - Number(b.question_number));
    } catch (e) {
        warnings.push(`Hỏi lại câu thiếu (${plan.section_type}) lỗi: ${e.message}`);
    }

    missing = missingOrShell(questions, start, end);
    if (missing.length) {
        warnings.push(`Section ${plan.section_type}: VẪN còn thiếu/trống câu ${compactRanges(missing)} — cần bổ sung tay trong editor.`);
    }
    return questions;
}

async function structureWithAi(input) {
    const chunkingOn = process.env.HSK_IMPORT_CHUNKED !== 'false';
    const plans = chunkingOn ? getSectionPlans(input.hskLevel) : null;
    if (plans && plans.length) {
        return structureSectionedWithAi(input, plans);
    }
    const prompt = buildPrompt(input);
    return generateImportJson(prompt, {
        label: `HSK${input.hskLevel} import`,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
}

// Import theo TỪNG SECTION (1 call/section) + gap-validation/re-ask mỗi section.
// Áp cho MỌI level có section plan (HSK1-6) → hết truncation giữa đề (HSK1-3 rớt câu,
// HSK4 56-65 mất đề/đáp án).
async function structureSectionedWithAi(input, plans) {
    const expected = HSK_EXPECTED[input.hskLevel] || {};
    const sections = [];
    const warnings = [`HSK${input.hskLevel} import chunked theo section (tránh truncation giữa đề).`];

    for (const plan of plans) {
        const prompt = buildSectionPrompt(input, plan);
        const parsed = await generateImportJson(prompt, {
            label: `HSK${input.hskLevel} ${plan.section_type}`,
            maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, plan.maxOutputTokens),
        });
        const section = parsed.section || parsed;
        if (Array.isArray(parsed.warnings)) warnings.push(...parsed.warnings.map(String));

        let questions = Array.isArray(section.questions) ? section.questions : [];
        questions = await fillMissingQuestions(input, plan, questions, warnings);

        sections.push({
            section_type: plan.section_type,
            section_order: plan.section_order,
            title: section.title || plan.title,
            instructions: section.instructions || plan.instructions,
            duration_seconds: section.duration_seconds || plan.duration_seconds,
            groups: Array.isArray(section.groups) ? section.groups : [],
            questions,
        });
    }

    return {
        exam: {
            title: input.title,
            hsk_level: input.hskLevel,
            exam_type: input.examType,
            duration_minutes: expected.duration,
            passing_score: expected.passing,
            description: 'Imported by OCR',
        },
        sections,
        warnings,
    };
}

function normalizeOption(opt, idx) {
    if (typeof opt === 'string') return opt;
    if (!opt || typeof opt !== 'object') return '';
    const label = String(opt.label || String.fromCharCode(65 + idx)).trim();
    const text = String(opt.text || opt.word || opt.value || '').trim();
    const out = { label, text };
    if (opt.pinyin) out.pinyin = String(opt.pinyin);
    return out;
}

function normalizeCorrectAnswer(answer, questionType) {
    const value = answer !== undefined && answer !== null ? String(answer).trim() : '';
    if (questionType === 'true_false') {
        if (/^(true|đúng|dung|对|a)$/i.test(value)) return 'A';
        if (/^(false|sai|错|b)$/i.test(value)) return 'B';
    }
    return value;
}

function normalizePayload(raw, input) {
    const expected = HSK_EXPECTED[input.hskLevel] || {};
    const exam = raw.exam || {};
    const payload = {
        exam: {
            title: String(exam.title || input.title || `HSK ${input.hskLevel} OCR Import`).trim(),
            hsk_level: input.hskLevel,
            exam_type: input.examType,
            duration_minutes: Number(exam.duration_minutes || expected.duration || 60),
            passing_score: Number(exam.passing_score || expected.passing || 120),
            description: String(exam.description || 'Imported by OCR').trim(),
        },
        sections: Array.isArray(raw.sections) ? raw.sections : [],
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    };

    payload.sections = payload.sections.map((section, sectionIdx) => {
        const normalized = {
            section_type: String(section.section_type || '').trim(),
            section_order: Number(section.section_order || sectionIdx + 1),
            title: section.title ? String(section.title) : '',
            instructions: section.instructions ? String(section.instructions) : '',
            duration_seconds: Number(section.duration_seconds || 0),
            groups: Array.isArray(section.groups) ? section.groups : [],
            questions: Array.isArray(section.questions) ? section.questions : [],
        };

        normalized.groups = normalized.groups.map((group, groupIdx) => {
            const groupType = String(group.group_type || '').trim();
            const aiTitle = group.title_vi ? String(group.title_vi).trim() : '';
            // Standardize title for known group types so groups of the same type
            // read consistently across the exam. Keep AI title for unknown types.
            const canonical = GROUP_TITLE_BY_TYPE[groupType];
            const titleVi = canonical || (aiTitle || null);
            if (canonical && aiTitle && aiTitle !== canonical) {
                payload.warnings.push(
                    `Group "${groupType}" có title "${aiTitle}" → chuẩn hoá thành "${canonical}".`
                );
            }
            return {
                local_id: group.local_id !== undefined ? String(group.local_id) : String(groupIdx),
                group_type: groupType,
                title_vi: titleVi,
                instructions_vi: group.instructions_vi ? String(group.instructions_vi) : null,
                content: group.content && typeof group.content === 'object' ? group.content : null,
                order_index: Number(group.order_index || groupIdx + 1),
            };
        });

        normalized.questions = normalized.questions.map(q => {
            const questionType = String(q.question_type || '').trim();
            return {
            question_number: Number(q.question_number || 0),
            question_type: questionType,
            group_ref: q.group_ref ?? q.groupRef ?? null,
            question_text: q.question_text ? String(q.question_text) : null,
            passage: q.passage ? String(q.passage) : null,
            statement: q.statement ? String(q.statement) : null,
            question_image: q.question_image ? String(q.question_image) : null,
            question_audio: q.question_audio ? String(q.question_audio) : null,
            transcript: q.transcript ? String(q.transcript) : null,
            audio_start_time: Number(q.audio_start_time || 0),
            audio_end_time: Number(q.audio_end_time || 0),
            audio_play_count: Number(q.audio_play_count || (input.examType === 'exam' ? 1 : 2)),
            options: Array.isArray(q.options) ? q.options.map(normalizeOption).filter(Boolean) : [],
            option_images: Array.isArray(q.option_images) ? q.option_images.filter(Boolean).map(String) : [],
            correct_answer: normalizeCorrectAnswer(q.correct_answer, questionType),
            explanation: q.explanation ? String(q.explanation) : null,
            difficulty: Number(q.difficulty || 1),
            points: Number(q.points || 1),
            meta: q.meta && typeof q.meta === 'object' ? q.meta : null,
        };
        });

        return normalized;
    });

    return payload;
}

function validatePayload(payload, input) {
    const errors = [];
    const warnings = [...(payload.warnings || [])];
    const expected = HSK_EXPECTED[input.hskLevel];

    if (!payload.sections.length) errors.push('AI output không có sections.');

    const seenNumbers = new Set();
    const sectionCounts = {};
    let total = 0;

    for (const section of payload.sections) {
        if (!ALLOWED_SECTION_TYPES.has(section.section_type)) {
            errors.push(`section_type không hợp lệ: ${section.section_type}`);
        }
        sectionCounts[section.section_type] = (sectionCounts[section.section_type] || 0) + section.questions.length;
        total += section.questions.length;

        for (const group of section.groups) {
            if (!ALLOWED_GROUP_TYPES.has(group.group_type)) {
                errors.push(`group_type không hợp lệ ở section ${section.section_order}: ${group.group_type}`);
            }
            // Cảnh báo (KHÔNG chặn import) khi nội dung dùng chung của group bị
            // trống — đây là phần "đại diện group" trước đây hay bị thiếu.
            const c = group.content && typeof group.content === 'object' ? group.content : {};
            const gid = group.local_id;
            if ((group.group_type === 'word_bank' || group.group_type === 'reply_bank')
                && !(Array.isArray(c.items) && c.items.length)) {
                warnings.push(`Group ${gid} (${group.group_type}) thiếu danh sách items A-F — cần bổ sung trong editor.`);
            }
            if (group.group_type === 'image_grid'
                && !(Array.isArray(c.items) && c.items.length)) {
                warnings.push(`Group ${gid} (image_grid) chưa có ô ảnh A-F — sẽ thử gán từ ảnh tách PDF, nếu không phải thêm tay.`);
            }
            if (group.group_type === 'passage' && !String(c.passage_zh || '').trim()) {
                warnings.push(`Group ${gid} (passage) thiếu passage_zh — cần bổ sung đoạn văn.`);
            }
            if (group.group_type === 'passage_multi' && !String(c.passage || '').trim()) {
                warnings.push(`Group ${gid} (passage_multi) thiếu passage — cần bổ sung đoạn văn.`);
            }
        }

        for (const question of section.questions) {
            if (!question.question_number) errors.push(`Có câu thiếu question_number trong section ${section.section_order}.`);
            if (seenNumbers.has(question.question_number)) warnings.push(`Trùng số câu ${question.question_number}.`);
            seenNumbers.add(question.question_number);
            if (!ALLOWED_QUESTION_TYPES.has(question.question_type)) {
                errors.push(`question_type không hợp lệ ở câu ${question.question_number}: ${question.question_type}`);
            }
            if (!question.correct_answer && !['short_answer', 'short_essay', 'summary_essay'].includes(question.question_type)) {
                // Cảnh báo (KHÔNG chặn import) — admin điền đáp án sau, tránh fail cả đề.
                warnings.push(`Câu ${question.question_number} thiếu correct_answer — bổ sung trong editor.`);
            }
            if (question.question_type === 'image_keyword_sentence' && !question.question_image) {
                warnings.push(`Câu ${question.question_number} là image_keyword_sentence nhưng chưa có ảnh; admin cần upload ảnh sau.`);
            }
        }
    }

    if (expected) {
        // Lệch số câu KHÔNG chặn import (tránh "fail cả đề" khi rớt vài câu) — chỉ
        // cảnh báo + liệt kê đích danh số câu thiếu để admin bổ sung nhanh.
        if (total !== expected.total) {
            warnings.push(`Tổng số câu lệch: nhận ${total}, kỳ vọng HSK${input.hskLevel} là ${expected.total}.`);
        }
        for (const [sectionType, count] of Object.entries(expected.sections)) {
            if ((sectionCounts[sectionType] || 0) !== count) {
                warnings.push(`Số câu section ${sectionType} lệch: nhận ${sectionCounts[sectionType] || 0}, kỳ vọng ${count}.`);
            }
        }
        const expectedMissing = [];
        for (let n = 1; n <= expected.total; n += 1) {
            if (!seenNumbers.has(n)) expectedMissing.push(n);
        }
        if (expectedMissing.length) {
            warnings.push(`Thiếu câu số: ${compactRanges(expectedMissing)} — bổ sung trong editor.`);
        }
    }

    return { errors, warnings, total };
}

async function uploadAudio(file, jobId) {
    if (!file) return null;
    const filename = `hsk-import-${jobId}-${Date.now()}-${safeFilename(file.originalname)}`;
    const bucketName = gcs.getBucketName('audio');

    if (bucketName) {
        const objectName = `uploads/audio/${filename}`;
        const result = await gcs.uploadBuffer({
            bucketName,
            objectName,
            buffer: file.buffer,
            contentType: file.mimetype,
        });
        return `gs://${result.bucketName}/${result.objectName}`;
    }

    const dir = ensureLocalUploadDir('audio');
    await fs.promises.writeFile(path.join(dir, filename), file.buffer);
    return `/uploads/audio/${filename}`;
}

/**
 * Upload the exam PDF to GCS so the Cloud Run extractor can fetch it by gs://.
 * Returns gs:// ref or null if the images bucket isn't configured.
 */
async function uploadPdfToGcs(file, jobId) {
    if (!file || !file.buffer) return null;
    const bucketName = gcs.getBucketName('image');
    if (!bucketName) return null;
    const filename = `hsk-import-${jobId}-${Date.now()}-${safeFilename(file.originalname)}`;
    const objectName = `uploads/pdf/${filename}`;
    const result = await gcs.uploadBuffer({
        bucketName,
        objectName,
        buffer: file.buffer,
        contentType: file.mimetype || 'application/pdf',
    });
    return `gs://${result.bucketName}/${result.objectName}`;
}

/**
 * Map Cloud Run-extracted images onto the payload.
 *
 * Hai đích KHÁC NHAU (đây là lý do bản cũ "mất ảnh image_grid"):
 *  1) Lưới ảnh A-F (group_type=image_grid): tài nguyên dùng chung của GROUP.
 *     - Nếu cụm chỉ extract được 1 ảnh → đó là ẢNH GHÉP A–F (chuẩn mới) → đặt vào
 *       group.content.image_url (admin sửa = 1 ô upload duy nhất).
 *     - Nếu nhiều ảnh rời → back-compat: điền group.content.items[].image_url theo
 *       thứ tự đọc (page→y→x), KHÔNG gộp theo question_number.
 *  2) Ảnh riêng 1 câu (image_match…): điền question_image cho đúng số câu.
 *
 * Ảnh đã dùng cho lưới sẽ không tái dùng cho question_image. Chỉ điền khi đang
 * trống — không ghi đè thứ AI/đề đã có. Trả về tổng số ảnh đã gán.
 */
function applyExtractedImages(payload, images, warnings) {
    if (!Array.isArray(images) || !images.length) return 0;

    // Chuẩn hoá + sắp theo thứ tự đọc. bbox = [x0,y0,x1,y1] (PDF points).
    const sorted = images
        .filter(im => im && im.gs_url)
        .map(im => {
            const bbox = Array.isArray(im.bbox) ? im.bbox : [0, 0, 0, 0];
            return {
                n: Number(im.question_number),
                gs: String(im.gs_url),
                page: Number(im.page) || 0,
                y: Number(bbox[1]) || 0,
                x: Number(bbox[0]) || 0,
            };
        })
        .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

    const used = new Set(); // chỉ số trong `sorted` đã gán cho lưới ảnh
    let applied = 0;

    // group_ref khớp group qua local_id HOẶC index (giống resolveGroupRef lúc insert).
    const refMatchesGroup = (ref, group, groupIdx) => {
        if (ref === null || ref === undefined || ref === '') return false;
        if (typeof ref === 'number') return ref === groupIdx || ref === groupIdx + 1;
        return String(ref) === String(group.local_id);
    };

    // --- Pass 1: image_grid → group.content.items[].image_url ---
    for (const section of payload.sections) {
        const groups = section.groups || [];
        for (let g = 0; g < groups.length; g += 1) {
            const group = groups[g];
            if (group.group_type !== 'image_grid') continue;
            const refNums = new Set(
                section.questions
                    .filter(q => refMatchesGroup(q.group_ref, group, g))
                    .map(q => q.question_number)
            );
            if (!refNums.size) continue;

            const gridIdx = [];
            sorted.forEach((im, idx) => {
                if (!used.has(idx) && Number.isFinite(im.n) && refNums.has(im.n)) gridIdx.push(idx);
            });
            if (!gridIdx.length) continue;

            const content = (group.content && typeof group.content === 'object') ? group.content : {};

            if (gridIdx.length === 1) {
                // 1 ảnh cho cả cụm = ảnh ghép A–F (chuẩn mới) → content.image_url.
                if (!content.image_url) {
                    content.image_url = sorted[gridIdx[0]].gs;
                    used.add(gridIdx[0]);
                    applied += 1;
                }
                // Đảm bảo có nhãn đáp án (A–F) để renderer hiện nút chọn chữ cái.
                if (!Array.isArray(content.items) || !content.items.length) {
                    const labelCount = Math.min(6, Math.max(5, refNums.size + 1));
                    content.items = Array.from({ length: labelCount }, (_, i) => ({ label: String.fromCharCode(65 + i) }));
                }
            } else {
                // Nhiều ảnh rời cho cụm → back-compat: điền items[].image_url (renderer fallback lưới).
                let items = Array.isArray(content.items) && content.items.length ? content.items : null;
                if (!items) {
                    items = gridIdx.map((_, i) => ({ label: String.fromCharCode(65 + i), image_url: '', alt_vi: '' }));
                }
                let gi = 0;
                for (const it of items) {
                    if (!it.image_url && gi < gridIdx.length) {
                        it.image_url = sorted[gridIdx[gi]].gs;
                        used.add(gridIdx[gi]);
                        gi += 1;
                        applied += 1;
                    }
                }
                content.items = items;
            }
            group.content = content;
        }
    }

    // --- Pass 2: ảnh riêng từng câu (bỏ qua ảnh đã dùng cho lưới) ---
    const byQ = new Map();
    sorted.forEach((im, idx) => {
        if (used.has(idx) || !Number.isFinite(im.n)) return;
        if (!byQ.has(im.n)) byQ.set(im.n, im.gs);
    });
    for (const section of payload.sections) {
        for (const q of section.questions) {
            if (!q.question_image && byQ.has(q.question_number)) {
                q.question_image = byQ.get(q.question_number);
                applied += 1;
            }
        }
    }

    const unmapped = sorted.filter(im => !Number.isFinite(im.n)).length;
    if (unmapped) {
        warnings.push(`${unmapped} ảnh PDF chưa map được số câu — cần gán tay trong editor.`);
    }
    return applied;
}

function resolveGroupRef(groupRef, groups, indexMap, localIdMap) {
    if (groupRef === null || groupRef === undefined || groupRef === '') return null;
    if (typeof groupRef === 'number') return indexMap.get(groupRef) || indexMap.get(groupRef - 1) || null;
    const key = String(groupRef);
    return localIdMap.get(key) || null;
}

async function insertDraftExam(payload, { audioUrl }) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const totalQuestions = payload.sections.reduce((sum, section) => sum + section.questions.length, 0);
        const [examResult] = await conn.execute(
            `INSERT INTO hsk_exams
                (title, hsk_level, exam_type, total_questions, duration_minutes, passing_score, description, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            [
                payload.exam.title,
                payload.exam.hsk_level,
                payload.exam.exam_type,
                totalQuestions,
                payload.exam.duration_minutes,
                payload.exam.passing_score,
                payload.exam.description,
            ]
        );
        const examId = examResult.insertId;

        let groupsCount = 0;
        for (const section of payload.sections) {
            // Empty string keeps compatibility if migration 018 made audio_url NOT NULL.
            // FE treats empty string as no audio.
            const sectionAudio = section.section_type === 'listening' && audioUrl ? audioUrl : '';
            const [sectionResult] = await conn.execute(
                `INSERT INTO hsk_sections
                    (exam_id, section_type, section_order, title, instructions, total_questions, duration_seconds, audio_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    examId,
                    section.section_type,
                    section.section_order,
                    section.title || null,
                    section.instructions || null,
                    section.questions.length,
                    section.duration_seconds || 0,
                    sectionAudio,
                ]
            );
            const sectionId = sectionResult.insertId;
            const indexMap = new Map();
            const localIdMap = new Map();

            for (let i = 0; i < section.groups.length; i += 1) {
                const group = section.groups[i];
                const [groupResult] = await conn.execute(
                    `INSERT INTO hsk_question_groups
                        (section_id, group_type, title_vi, instructions_vi, content, order_index)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        sectionId,
                        group.group_type,
                        group.title_vi,
                        group.instructions_vi,
                        group.content ? JSON.stringify(group.content) : null,
                        group.order_index || i + 1,
                    ]
                );
                groupsCount += 1;
                indexMap.set(i, groupResult.insertId);
                indexMap.set(i + 1, groupResult.insertId);
                localIdMap.set(String(group.local_id), groupResult.insertId);
            }

            for (const question of section.questions) {
                const groupId = resolveGroupRef(question.group_ref, section.groups, indexMap, localIdMap);
                const meta = {
                    ...(question.meta || {}),
                    importedBy: 'hsk_ocr',
                };
                await conn.execute(
                    `INSERT INTO hsk_questions
                        (section_id, group_id, question_number, question_type, question_text, passage, statement,
                         question_image, question_audio, transcript, audio_start_time, audio_end_time,
                         audio_play_count, options, option_images, correct_answer, explanation, difficulty, points, meta)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        sectionId,
                        groupId,
                        question.question_number,
                        question.question_type,
                        question.question_text,
                        question.passage,
                        question.statement,
                        question.question_image,
                        question.question_audio,
                        question.transcript,
                        question.audio_start_time,
                        question.audio_end_time,
                        question.audio_play_count,
                        question.options?.length ? JSON.stringify(question.options) : null,
                        question.option_images?.length ? JSON.stringify(question.option_images) : null,
                        question.correct_answer,
                        question.explanation,
                        question.difficulty,
                        question.points,
                        JSON.stringify(meta),
                    ]
                );
            }
        }

        await conn.commit();
        return { examId, totalQuestions, sectionsCount: payload.sections.length, groupsCount };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function processJob(jobId, files, input) {
    const warnings = [];
    try {
        await updateJob(jobId, { status: 'processing', progress: 10 });

        const pdfText = await extractPdfText(files.examPdf, warnings);
        if (!pdfText.trim()) throw new Error('Không extract được nội dung đề PDF.');
        await updateJob(jobId, { progress: 30, raw_text: truncateText(pdfText) });

        const answerText = await extractAnswerText(files.answerFile, warnings);
        if (!answerText.trim()) throw new Error('Không extract được nội dung file đáp án.');
        await updateJob(jobId, { progress: 45, warnings });

        const structured = await structureWithAi({
            ...input,
            pdfText,
            answerText,
        });
        const payload = normalizePayload(structured, input);
        const validation = validatePayload(payload, input);
        const allWarnings = [...warnings, ...validation.warnings];

        await updateJob(jobId, {
            progress: 70,
            structured_json: JSON.stringify(payload),
            warnings: allWarnings,
            errors: validation.errors,
        });

        if (validation.errors.length) {
            throw new Error(`Validate import failed: ${validation.errors.join('; ')}`);
        }

        // 3c: best-effort image extraction via Cloud Run (off-droplet — no OOM
        // risk). Điền question_image (ảnh 1 câu) + group.content.items[].image_url
        // (lưới ảnh A-F). Never blocks the text import: lỗi → warning.
        if (pdfImageExtract.isConfigured()) {
            try {
                const pdfGs = await uploadPdfToGcs(files.examPdf, jobId);
                if (pdfGs) {
                    const { images, warnings: imgWarn } = await pdfImageExtract.extractImages({
                        pdfGs,
                        jobId,
                        level: input.hskLevel,
                    });
                    const applied = applyExtractedImages(payload, images, allWarnings);
                    allWarnings.push(...imgWarn);
                    allWarnings.push(`Tách ảnh PDF: gán ${applied}/${images.length} ảnh (gồm cả lưới ảnh A-F).`);
                    // Re-save preview để admin thấy đúng bản sẽ insert (đã có ảnh).
                    await updateJob(jobId, { structured_json: JSON.stringify(payload), warnings: allWarnings });
                } else {
                    allWarnings.push('Không upload được PDF lên GCS để tách ảnh (thiếu bucket ảnh) — ảnh sẽ trống.');
                }
            } catch (e) {
                allWarnings.push(`Tách ảnh PDF lỗi (bỏ qua, giữ text): ${e.publicMessage || e.message}`);
            }
        } else {
            allWarnings.push('Tách ảnh PDF CHƯA BẬT (thiếu env PDF_EXTRACT_URL) — ảnh đề và lưới ảnh A-F sẽ trống, cần gán tay trong editor.');
        }

        const audioUrl = await uploadAudio(files.audioFile, jobId);
        if (input.examType === 'exam' && !audioUrl) {
            throw new Error('Chế độ thi cần upload audio file cho section listening.');
        }
        await updateJob(jobId, { progress: 82 });

        const summary = await insertDraftExam(payload, { audioUrl });
        await updateJob(jobId, {
            status: 'completed',
            progress: 100,
            exam_id: summary.examId,
            summary,
            warnings: allWarnings,
            completed_at: new Date(),
        });
    } catch (error) {
        const errorList = [error.message];
        if (error.finishReason) {
            errorList.push(`AI finishReason: ${error.finishReason}`);
        }
        if (error.usage) {
            errorList.push(`AI usage: ${JSON.stringify(error.usage)}`);
        }
        if (error.aiResponsePreview) {
            errorList.push(`AI response preview: ${error.aiResponsePreview}`);
        }
        await updateJob(jobId, {
            status: 'failed',
            errors: errorList,
            completed_at: new Date(),
        }).catch(() => {});
        console.error('[hskImport] job failed:', jobId, error);
    }
}

/* ─────────────────────────────────────────────────────────────────────────
 * OCR v2 — blueprint-driven (HSK1-3): cấu trúc CỐ ĐỊNH từ blueprint, AI CHỈ điền
 * nội dung từ PDF + đáp án. Tách khỏi OCR v1 (structureWithAi). Ra đề format_version=2.
 * ───────────────────────────────────────────────────────────────────────── */

// Mỗi loại câu cần AI điền field gì (hướng dẫn ngắn cho prompt).
const V2_QUESTION_FIELDS = {
    true_false: 'statement (câu nhận định ngắn), transcript (lời thoại nghe nếu có), correct_answer (A=Đúng, B=Sai)',
    multiple_choice: 'question_text hoặc transcript (đoạn nghe), options [{label,text,pinyin}] ĐÚNG số đáp án, correct_answer (nhãn)',
    image_match: 'transcript (lời nghe), correct_answer (nhãn ảnh đúng). KHÔNG cần ảnh.',
    image_grid_match: 'transcript hoặc question_text (câu/đối thoại), correct_answer (chữ cái trong lưới). KHÔNG cần ảnh.',
    reply_match: 'question_text (câu hỏi/lời nói), correct_answer (chữ cái câu trả lời)',
    word_bank_fill: 'question_text (câu có chỗ trống), correct_answer (chữ cái từ trong bank)',
    sentence_assembly: 'question_text (các mảnh "词1 / 词2 / 词3"), correct_answer (câu hoàn chỉnh)',
    fill_hanzi: 'question_text (pinyin gợi ý), correct_answer (chữ Hán), meta.context (câu chứa chữ)',
};

// Blueprint chỉ-giữ-cấu-trúc (xóa nội dung mẫu) để AI điền nội dung thật.
function buildV2StructureOnly(bp) {
    return {
        level: bp.level,
        exam_code: bp.exam_code,
        total_questions: bp.total_questions,
        duration_minutes: bp.duration_minutes,
        passing_score: bp.passing_score,
        audio_file: bp.audio_file,
        sections: bp.sections.map(s => ({
            section_type: s.section_type,
            title_vi: s.title_vi,
            instructions_vi: s.instructions_vi,
            parts: s.parts.map(p => ({
                range: p.range,
                question_type: p.question_type,
                options_count: p.options_count,
                option_style: p.option_style,
                image_style: p.image_style,
                group: p.group ? { type: p.group.type, items: p.group.items, labels: p.group.labels, content: {} } : null,
                questions: p.questions.map(q => ({ number: q.number })),
            })),
        })),
    };
}

function buildV2ContentPrompt(level, section, pdfText, answerText) {
    const partLines = section.parts.map(p => {
        const last = String.fromCharCode(64 + (p.options_count || (p.group ? p.group.items : 3)));
        const grp = p.group ? ` + group ${p.group.type} (${p.group.items} ô A-${String.fromCharCode(64 + p.group.items)})` : '';
        return `- Câu ${p.range[0]}-${p.range[1]}: ${p.question_type}, ${p.options_count} đáp án (A-${last})${grp}. Điền: ${V2_QUESTION_FIELDS[p.question_type] || 'question_text, correct_answer'}.`;
    }).join('\n');

    return [
        `Bạn là bộ ĐIỀN NỘI DUNG đề thi HSK${level} cho HanXue. Cấu trúc đề ĐÃ CỐ ĐỊNH — bạn CHỈ điền nội dung từ PDF + đáp án.`,
        'QUY TẮC: KHÔNG đổi loại câu/số đáp án/cấu trúc. Copy nguyên văn tiếng Trung từ PDF. correct_answer lấy từ ANSWER TEXT theo SỐ CÂU. KHÔNG dịch sang tiếng Việt. Thiếu thì để rỗng, KHÔNG bịa.',
        '',
        `Section: ${section.section_type}. Các cụm câu cần điền:`,
        partLines,
        '',
        'Trả về CHỈ JSON:',
        '{ "questions": { "<số câu>": { "statement"?, "question_text"?, "transcript"?, "passage"?, "options"?: [{"label":"A","text":"","pinyin":""}], "correct_answer": "" } }, "groups": { "<range vd 11-15>": { ...nội dung dùng chung... } } }',
        'Nội dung group theo type:',
        '- image_grid: {} (ảnh để hệ thống tự gán).',
        '- word_bank: { "items": [ {"label":"A","word":"<từ>","pinyin":"<nếu có>"}, ... ] }',
        '- reply_bank: { "items": [ {"label":"A","sentence_zh":"<câu>","pinyin":"<nếu có>"}, ... ] }',
        '- passage / passage_multi: { "passage_zh": "<đoạn văn>" }',
        '',
        '--- PDF TEXT ---',
        truncateText(pdfText),
        '',
        '--- ANSWER TEXT ---',
        truncateText(answerText),
    ].join('\n');
}

function mergeV2Content(section, ai, warnings) {
    const qmap = (ai && ai.questions) || {};
    const gmap = (ai && ai.groups) || {};
    for (const part of section.parts) {
        if (part.group) {
            const key = `${part.range[0]}-${part.range[1]}`;
            const gc = gmap[key] || gmap[String(part.range[0])] || null;
            if (gc && typeof gc === 'object') part.group.content = gc;
        }
        for (const q of part.questions) {
            const c = qmap[String(q.number)] || qmap[q.number];
            if (!c || typeof c !== 'object') {
                warnings.push(`Câu ${q.number}: AI chưa điền nội dung — bổ sung tay.`);
                continue;
            }
            if (c.statement) q.statement = String(c.statement);
            if (c.question_text) q.question_text = String(c.question_text);
            if (c.transcript) q.transcript = String(c.transcript);
            if (c.passage) q.passage = String(c.passage);
            if (Array.isArray(c.options)) q.options = c.options;
            if (c.correct_answer) q.correct_answer = normalizeCorrectAnswer(c.correct_answer, part.question_type);
            if (c.pinyin) q.pinyin = String(c.pinyin);
            if (c.meta && typeof c.meta === 'object') q.meta = c.meta;
        }
    }
}

// Best-effort ảnh: per_question → question_image; group_grid → 1 ảnh đại diện; image_match → admin tự upload.
function applyV2Images(filled, images, warnings) {
    const sorted = (images || [])
        .filter(im => im && im.gs_url && Number.isFinite(Number(im.question_number)))
        .map(im => {
            const b = Array.isArray(im.bbox) ? im.bbox : [0, 0, 0, 0];
            return { n: Number(im.question_number), gs: String(im.gs_url), page: Number(im.page) || 0, y: Number(b[1]) || 0, x: Number(b[0]) || 0 };
        })
        .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    const byNum = new Map();
    for (const im of sorted) if (!byNum.has(im.n)) byNum.set(im.n, im.gs);

    let applied = 0;
    for (const s of filled.sections) {
        for (const p of s.parts) {
            if (p.image_style === 'per_question') {
                for (const q of p.questions) if (byNum.has(q.number)) { q.question_image = byNum.get(q.number); applied += 1; }
            } else if (p.image_style === 'group_grid' && p.group) {
                for (let n = p.range[0]; n <= p.range[1]; n += 1) {
                    if (byNum.has(n)) { p.group.content = { ...(p.group.content || {}), image_url: byNum.get(n) }; applied += 1; break; }
                }
            } else if (p.image_style === 'option_images') {
                warnings.push(`Câu ${p.range[0]}-${p.range[1]} (image_match): ảnh đáp án cần upload tay trong editor.`);
            }
        }
    }
    return applied;
}

/**
 * OCR v2 cho HSK1-3: dựng đề format_version=2 từ blueprint, AI điền nội dung.
 */
async function processJobV2(jobId, files, input) {
    const warnings = [`OCR v2 (HSK${input.hskLevel}) — cấu trúc khóa theo blueprint, AI chỉ điền nội dung.`];
    try {
        await updateJob(jobId, { status: 'processing', progress: 10 });

        const struct = hskV2.loadBlueprint(input.hskLevel);
        if (!struct) throw new Error(`OCR v2 chỉ hỗ trợ HSK 1-3 (level=${input.hskLevel}).`);

        const pdfText = await extractPdfText(files.examPdf, warnings);
        if (!pdfText.trim()) throw new Error('Không extract được nội dung đề PDF.');
        await updateJob(jobId, { progress: 30, raw_text: truncateText(pdfText) });

        const answerText = await extractAnswerText(files.answerFile, warnings);
        if (!answerText.trim()) throw new Error('Không extract được nội dung file đáp án.');
        await updateJob(jobId, { progress: 42, warnings });

        const filled = buildV2StructureOnly(struct);
        let prog = 42;
        const step = Math.floor(36 / filled.sections.length);
        for (const section of filled.sections) {
            const prompt = buildV2ContentPrompt(input.hskLevel, section, pdfText, answerText);
            const ai = await generateImportJson(prompt, {
                label: `HSK${input.hskLevel} v2 ${section.section_type}`,
                maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, 40000),
            });
            mergeV2Content(section, ai, warnings);
            prog += step;
            await updateJob(jobId, { progress: prog });
        }

        // Ảnh best-effort qua Cloud Run.
        if (pdfImageExtract.isConfigured()) {
            try {
                const pdfGs = await uploadPdfToGcs(files.examPdf, jobId);
                if (pdfGs) {
                    const { images, warnings: imgWarn } = await pdfImageExtract.extractImages({ pdfGs, jobId, level: input.hskLevel });
                    const applied = applyV2Images(filled, images, warnings);
                    warnings.push(...imgWarn, `Tách ảnh PDF: gán ${applied} ảnh (per-câu + 1 ảnh/lưới).`);
                }
            } catch (e) {
                warnings.push(`Tách ảnh PDF lỗi (bỏ qua): ${e.publicMessage || e.message}`);
            }
        } else {
            warnings.push('Tách ảnh PDF CHƯA BẬT (PDF_EXTRACT_URL) — ảnh để trống, upload tay.');
        }

        const audioUrl = await uploadAudio(files.audioFile, jobId);
        if (input.examType === 'exam' && !audioUrl) throw new Error('Chế độ thi cần audio cho cả đề.');
        await updateJob(jobId, { progress: 85, structured_json: JSON.stringify(filled), warnings });

        const summary = await hskV2.instantiateBlueprint(filled, {
            seed: true,
            title: input.title,
            examType: input.examType,
            audioUrl,
        });
        await updateJob(jobId, {
            status: 'completed',
            progress: 100,
            exam_id: summary.examId,
            summary,
            warnings,
            completed_at: new Date(),
        });
    } catch (error) {
        const errorList = [error.message];
        if (error.aiResponsePreview) errorList.push(`AI preview: ${error.aiResponsePreview}`);
        await updateJob(jobId, { status: 'failed', errors: errorList, completed_at: new Date() }).catch(() => {});
        console.error('[hskImportV2] job failed:', jobId, error);
    }
}

module.exports = {
    createJob,
    getJob,
    processJob,
    processJobV2,
};
