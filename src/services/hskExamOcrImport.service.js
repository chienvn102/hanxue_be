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

const IMPORT_MODEL = process.env.HSK_IMPORT_MODEL || 'gemini-2.5-flash';
const MAX_RAW_TEXT_CHARS = parseInt(process.env.HSK_IMPORT_MAX_RAW_TEXT_CHARS || '180000', 10);
const MAX_OUTPUT_TOKENS = parseInt(process.env.HSK_IMPORT_MAX_OUTPUT_TOKENS || '32768', 10);

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

const HSK_EXPECTED = {
    1: { total: 40, duration: 35, passing: 120, sections: { listening: 20, reading: 20 } },
    2: { total: 60, duration: 50, passing: 120, sections: { listening: 35, reading: 25 } },
    3: { total: 80, duration: 85, passing: 180, sections: { listening: 40, reading: 30, writing: 10 } },
    4: { total: 100, duration: 105, passing: 180, sections: { listening: 45, reading: 40, writing: 15 } },
    5: { total: 100, duration: 125, passing: 180, sections: { listening: 45, reading: 45, writing: 10 } },
    6: { total: 101, duration: 140, passing: 180, sections: { listening: 50, reading: 50, writing: 1 } },
};

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

async function updateJob(jobId, patch) {
    const fields = [];
    const params = [];
    const jsonFields = new Set(['file_names', 'summary', 'warnings', 'errors']);

    for (const [field, value] of Object.entries(patch)) {
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

function buildBlueprint(level) {
    if (level === 4) {
        return [
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
        ].join('\n');
    }

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
        'Không được tự tạo câu hỏi ngoài nội dung file. Nếu thiếu dữ liệu, để field rỗng và thêm warning.',
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

function extractJsonObject(text) {
    const clean = gemini.unwrapJsonFence(text);
    try {
        return JSON.parse(clean);
    } catch {
        const match = clean.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('AI response does not contain a JSON object');
        return JSON.parse(match[0]);
    }
}

async function structureWithAi(input) {
    const prompt = buildPrompt(input);
    const { text } = await gemini.chat([{ role: 'user', content: prompt }], {
        model: IMPORT_MODEL,
        temperature: 0.1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        systemInstruction: 'Return only valid JSON. Do not include markdown fences.',
    });
    return extractJsonObject(text);
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

        normalized.groups = normalized.groups.map((group, groupIdx) => ({
            local_id: group.local_id !== undefined ? String(group.local_id) : String(groupIdx),
            group_type: String(group.group_type || '').trim(),
            title_vi: group.title_vi ? String(group.title_vi) : null,
            instructions_vi: group.instructions_vi ? String(group.instructions_vi) : null,
            content: group.content && typeof group.content === 'object' ? group.content : null,
            order_index: Number(group.order_index || groupIdx + 1),
        }));

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
        }

        for (const question of section.questions) {
            if (!question.question_number) errors.push(`Có câu thiếu question_number trong section ${section.section_order}.`);
            if (seenNumbers.has(question.question_number)) warnings.push(`Trùng số câu ${question.question_number}.`);
            seenNumbers.add(question.question_number);
            if (!ALLOWED_QUESTION_TYPES.has(question.question_type)) {
                errors.push(`question_type không hợp lệ ở câu ${question.question_number}: ${question.question_type}`);
            }
            if (!question.correct_answer && !['short_answer', 'short_essay', 'summary_essay'].includes(question.question_type)) {
                errors.push(`Câu ${question.question_number} thiếu correct_answer.`);
            }
            if (question.question_type === 'image_keyword_sentence' && !question.question_image) {
                warnings.push(`Câu ${question.question_number} là image_keyword_sentence nhưng chưa có ảnh; admin cần upload ảnh sau.`);
            }
        }
    }

    if (expected) {
        if (total !== expected.total) {
            errors.push(`Sai tổng số câu: nhận ${total}, kỳ vọng HSK${input.hskLevel} là ${expected.total}.`);
        }
        for (const [sectionType, count] of Object.entries(expected.sections)) {
            if ((sectionCounts[sectionType] || 0) !== count) {
                errors.push(`Sai số câu section ${sectionType}: nhận ${sectionCounts[sectionType] || 0}, kỳ vọng ${count}.`);
            }
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
        await updateJob(jobId, {
            status: 'failed',
            errors: [error.message],
            completed_at: new Date(),
        }).catch(() => {});
        console.error('[hskImport] job failed:', jobId, error);
    }
}

module.exports = {
    createJob,
    getJob,
    processJob,
};
