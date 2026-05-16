/**
 * Vocabulary Controller
 * Handles HTTP request/response for vocabulary endpoints
 */

const VocabModel = require('../models/vocab.model');
const db = require('../config/database');
const { resolveAudioUrl } = require('../services/audioUrl.service');

/**
 * Format vocabulary row to API response
 */
function formatVocab(row, includeExamples = false) {
    const formatted = {
        id: row.id,
        simplified: row.simplified,
        traditional: row.traditional,
        pinyin: row.pinyin,
        hanViet: row.han_viet,
        meaningVi: row.meaning_vi,
        meaningEn: row.meaning_en,
        hskLevel: row.hsk_level,
        wordType: row.word_type,
        audioUrl: row.audio_url,
        frequencyRank: row.frequency_rank
    };

    if (includeExamples && row.examples) {
        try {
            formatted.examples = JSON.parse(row.examples);
        } catch {
            formatted.examples = [];
        }
    }

    return formatted;
}

/**
 * GET /api/vocab
 */
async function list(req, res) {
    try {
        const { hsk, q, theme, lesson, page = 1, limit = 20 } = req.query;

        const { rows, total } = await VocabModel.getList({
            hsk,
            q,
            theme: theme && String(theme).trim() ? String(theme).trim() : undefined,
            lesson: lesson && String(lesson).trim() ? String(lesson).trim() : undefined,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        const formatted = await Promise.all(rows.map(async row => {
            const v = formatVocab(row);
            v.audioUrl = await resolveAudioUrl(v.audioUrl);
            return v;
        }));

        res.json({
            data: formatted,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Get vocab error:', err);
        res.status(500).json({ error: 'Failed to get vocabulary' });
    }
}

/**
 * GET /api/vocab/:id
 */
async function getById(req, res) {
    try {
        const vocab = await VocabModel.getById(req.params.id);

        if (!vocab) {
            return res.status(404).json({ error: 'Vocabulary not found' });
        }

        const formatted = formatVocab(vocab, true);
        formatted.audioUrl = await resolveAudioUrl(formatted.audioUrl);
        // Attach themes (graceful fallback nếu bảng chưa migrate)
        try {
            formatted.themes = await VocabModel.getThemesForVocab(vocab.id);
        } catch {
            formatted.themes = [];
        }

        res.json(formatted);
    } catch (err) {
        console.error('Get vocab by id error:', err);
        res.status(500).json({ error: 'Failed to get vocabulary' });
    }
}

/**
 * GET /api/vocab/themes — list all canonical themes
 */
async function listThemes(req, res) {
    try {
        const themes = await VocabModel.listThemes();
        res.json({ data: themes });
    } catch (err) {
        // Bảng chưa migrate → return empty list (FE sẽ ẩn pill row)
        console.error('List themes error:', err.message);
        res.json({ data: [] });
    }
}

/**
 * GET /api/vocab/search/fulltext
 */
async function searchFulltext(req, res) {
    try {
        const { q } = req.query;

        if (!q || q.length < 1) {
            return res.status(400).json({ error: 'Query required' });
        }

        const rows = await VocabModel.searchFulltext(q);

        res.json({
            data: rows.map(row => ({
                id: row.id,
                simplified: row.simplified,
                traditional: row.traditional,
                pinyin: row.pinyin,
                hanViet: row.han_viet,
                meaningVi: row.meaning_vi,
                hskLevel: row.hsk_level
            }))
        });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
}

/**
 * GET /api/vocab/:id/examples
 */
async function getExamples(req, res) {
    try {
        const vocab = await VocabModel.getWithExamples(req.params.id);

        if (!vocab) {
            return res.status(404).json({ error: 'Vocabulary not found' });
        }

        let examples = [];
        let source = 'database';

        // Check if we have examples in DB
        if (vocab.examples) {
            try {
                examples = JSON.parse(vocab.examples);
                if (Array.isArray(examples) && examples.length > 0) {
                    return res.json({ source, examples });
                }
            } catch {
                // Invalid JSON, continue to AI generation
            }
        }

        // No examples in DB, generate with AI
        try {
            const gemini = require('../services/gemini');
            examples = await gemini.generateExamples(
                vocab.simplified,
                vocab.pinyin,
                vocab.meaning_vi
            );
            source = 'ai';
        } catch (aiError) {
            console.error('AI generation failed:', aiError.message);
            examples = [];
            source = 'none';
        }

        res.json({ source, examples });
    } catch (err) {
        console.error('Get examples error:', err);
        res.status(500).json({ error: 'Failed to get examples' });
    }
}

/**
 * Validate input cho create/update — return null nếu OK, message nếu lỗi.
 * Yêu cầu tối thiểu: simplified + pinyin + meaning_vi (sau khi trim).
 */
function validateVocabPayload(body, { partial = false } = {}) {
    const required = ['simplified', 'pinyin', 'meaning_vi'];
    for (const field of required) {
        if (partial && body[field] === undefined) continue; // PUT cho phép thiếu field
        const v = body[field];
        if (typeof v !== 'string' || !v.trim()) {
            return `Trường "${field}" là bắt buộc và không được để trống.`;
        }
    }
    if (body.hsk_level !== undefined) {
        const lvl = parseInt(body.hsk_level, 10);
        if (!Number.isFinite(lvl) || lvl < 1 || lvl > 6) {
            return `hsk_level phải là số 1-6.`;
        }
    }
    return null;
}

/**
 * POST /api/vocab (Admin)
 */
async function create(req, res) {
    try {
        const validationErr = validateVocabPayload(req.body);
        if (validationErr) {
            return res.status(400).json({ success: false, message: validationErr });
        }

        // Pre-check trùng simplified — UX rõ hơn dựa-vào-DB-throw.
        const existing = await VocabModel.findBySimplified(req.body.simplified);
        if (existing) {
            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_SIMPLIFIED',
                message: `Chữ Hán "${existing.simplified}" đã tồn tại (id ${existing.id}, HSK ${existing.hsk_level}, pinyin: ${existing.pinyin}).`,
                data: { existingId: existing.id, simplified: existing.simplified }
            });
        }

        const id = await VocabModel.create(req.body);
        const vocab = await VocabModel.getById(id);
        res.status(201).json({ success: true, data: formatVocab(vocab, true) });
    } catch (err) {
        // Race condition: 2 admin insert cùng lúc → DB unique throw.
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_SIMPLIFIED',
                message: 'Chữ Hán này vừa được người khác thêm. Refresh lại danh sách nhé.'
            });
        }
        console.error('Create vocab error:', err);
        res.status(500).json({ success: false, message: 'Failed to create vocabulary', error: err.message });
    }
}

/**
 * PUT /api/vocab/:id (Admin)
 */
async function update(req, res) {
    try {
        const validationErr = validateVocabPayload(req.body, { partial: true });
        if (validationErr) {
            return res.status(400).json({ success: false, message: validationErr });
        }

        // Nếu update làm đổi simplified → check không trùng vocab khác.
        if (typeof req.body.simplified === 'string' && req.body.simplified.trim()) {
            const conflict = await VocabModel.findBySimplified(req.body.simplified, req.params.id);
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    code: 'DUPLICATE_SIMPLIFIED',
                    message: `Chữ Hán "${conflict.simplified}" đã tồn tại ở từ vựng khác (id ${conflict.id}).`,
                    data: { existingId: conflict.id }
                });
            }
        }

        const affected = await VocabModel.update(req.params.id, req.body);
        if (affected === 0) {
            // Không có thay đổi cũng coi là OK — trả lại entity hiện tại.
            const vocab = await VocabModel.getById(req.params.id);
            if (!vocab) {
                return res.status(404).json({ success: false, message: 'Vocabulary not found' });
            }
            return res.json({ success: true, data: formatVocab(vocab, true), info: 'No changes' });
        }
        const vocab = await VocabModel.getById(req.params.id);
        res.json({ success: true, data: formatVocab(vocab, true) });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_SIMPLIFIED',
                message: 'Chữ Hán bị trùng với từ vựng khác.'
            });
        }
        console.error('Update vocab error:', err);
        res.status(500).json({ success: false, message: 'Failed to update vocabulary', error: err.message });
    }
}

/**
 * DELETE /api/vocab/:id (Admin)
 */
async function deleteVocab(req, res) {
    try {
        // Đếm reference từ 3 nguồn — bảng nào không tồn tại thì coi như 0.
        async function safeCount(sql, params) {
            try {
                const [[row]] = await db.execute(sql, params);
                return Number(row?.cnt || 0);
            } catch (e) {
                if (e.code === 'ER_NO_SUCH_TABLE') return 0;
                throw e;
            }
        }
        const id = req.params.id;
        const [notebookCnt, flashcardCnt, lessonCnt] = await Promise.all([
            safeCount('SELECT COUNT(*) AS cnt FROM notebook_items WHERE vocabulary_id = ?', [id]),
            safeCount('SELECT COUNT(*) AS cnt FROM flashcard_deck_items WHERE vocab_id = ?', [id]),
            safeCount('SELECT COUNT(*) AS cnt FROM lesson_vocabulary WHERE vocabulary_id = ?', [id]),
        ]);
        const total = notebookCnt + flashcardCnt + lessonCnt;
        if (total > 0) {
            const parts = [];
            if (notebookCnt) parts.push(`${notebookCnt} sổ tay`);
            if (flashcardCnt) parts.push(`${flashcardCnt} flashcard`);
            if (lessonCnt) parts.push(`${lessonCnt} bài học`);
            return res.status(409).json({
                success: false,
                code: 'VOCAB_IN_USE',
                message: `Từ vựng đang được dùng ở: ${parts.join(', ')}. Không thể xóa.`,
                data: { notebookCnt, flashcardCnt, lessonCnt },
            });
        }

        const affected = await VocabModel.deleteById(id);
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Vocabulary not found' });
        }
        res.json({ success: true, message: 'Vocabulary deleted' });
    } catch (err) {
        console.error('Delete vocab error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete vocabulary', error: err.message });
    }
}

module.exports = {
    list,
    getById,
    searchFulltext,
    getExamples,
    create,
    update,
    deleteVocab,
    listThemes
};
