/**
 * Grammar Controller
 * Handles HTTP request/response for grammar endpoints
 */

const GrammarModel = require('../models/grammar.model');
const db = require('../config/database');

function validateGrammarPayload(body, { partial = false } = {}) {
    const errors = [];
    const isStr = (v) => typeof v === 'string' && v.trim();
    if (!partial || body.grammar_point !== undefined) {
        if (!isStr(body.grammar_point) && !isStr(body.title)) errors.push('grammar_point (hoặc title)');
    }
    if (!partial || body.explanation !== undefined) {
        if (!isStr(body.explanation) && !isStr(body.explanation_vi)) errors.push('explanation');
    }
    if (body.hsk_level !== undefined && body.hsk_level !== null && body.hsk_level !== '') {
        const lvl = parseInt(body.hsk_level, 10);
        if (!Number.isFinite(lvl) || lvl < 1 || lvl > 6) errors.push('hsk_level (phải 1-6)');
    }
    return errors;
}

/**
 * Format grammar row to API response
 */
function formatGrammar(row) {
    let pattern = row.pattern;
    let patternPinyin = row.pattern_pinyin;
    let examples = row.examples;

    // Parse JSON fields if they're strings
    try {
        if (typeof pattern === 'string') pattern = JSON.parse(pattern);
    } catch { pattern = []; }

    try {
        if (typeof patternPinyin === 'string') patternPinyin = JSON.parse(patternPinyin);
    } catch { patternPinyin = null; }

    try {
        if (typeof examples === 'string') examples = JSON.parse(examples);
    } catch { examples = []; }

    return {
        id: row.id,
        pattern,
        patternPinyin,
        patternFormula: row.pattern_formula,
        grammarPoint: row.grammar_point,
        explanation: row.explanation,
        examples,
        hskLevel: row.hsk_level,
        audioUrl: row.audio_url,
        createdAt: row.created_at
    };
}

/**
 * GET /api/grammar
 */
async function list(req, res) {
    try {
        const { hsk, q, page = 1, limit = 20 } = req.query;

        const { rows, total } = await GrammarModel.getList({
            hsk,
            q,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({
            data: rows.map(row => formatGrammar(row)),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Get grammar list error:', err);
        res.status(500).json({ error: 'Failed to get grammar list' });
    }
}

/**
 * GET /api/grammar/:id
 */
async function getById(req, res) {
    try {
        const grammar = await GrammarModel.getById(req.params.id);

        if (!grammar) {
            return res.status(404).json({ error: 'Grammar not found' });
        }

        res.json(formatGrammar(grammar));
    } catch (err) {
        console.error('Get grammar by id error:', err);
        res.status(500).json({ error: 'Failed to get grammar' });
    }
}

/**
 * POST /api/grammar (Admin)
 */
async function create(req, res) {
    try {
        const errors = validateGrammarPayload(req.body);
        if (errors.length) {
            return res.status(400).json({ success: false, message: `Thiếu/sai trường: ${errors.join(', ')}` });
        }
        const id = await GrammarModel.create(req.body);
        const grammar = await GrammarModel.getById(id);
        res.status(201).json({ success: true, data: formatGrammar(grammar) });
    } catch (err) {
        console.error('Create grammar error:', err);
        res.status(500).json({ success: false, message: 'Failed to create grammar', error: err.message });
    }
}

/**
 * PUT /api/grammar/:id (Admin)
 */
async function update(req, res) {
    try {
        const errors = validateGrammarPayload(req.body, { partial: true });
        if (errors.length) {
            return res.status(400).json({ success: false, message: `Trường không hợp lệ: ${errors.join(', ')}` });
        }
        const affected = await GrammarModel.update(req.params.id, req.body);
        if (affected === 0) {
            const grammar = await GrammarModel.getById(req.params.id);
            if (!grammar) return res.status(404).json({ success: false, message: 'Grammar not found' });
            return res.json({ success: true, data: formatGrammar(grammar), info: 'No changes' });
        }
        const grammar = await GrammarModel.getById(req.params.id);
        res.json({ success: true, data: formatGrammar(grammar) });
    } catch (err) {
        console.error('Update grammar error:', err);
        res.status(500).json({ success: false, message: 'Failed to update grammar', error: err.message });
    }
}

/**
 * DELETE /api/grammar/:id (Admin)
 */
async function deleteGrammar(req, res) {
    try {
        let lessonRefCount = 0;
        try {
            const [[row]] = await db.execute(
                'SELECT COUNT(*) AS cnt FROM lesson_grammar WHERE grammar_id = ?',
                [req.params.id]
            );
            lessonRefCount = row?.cnt || 0;
        } catch (e) {
            if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        }
        if (lessonRefCount > 0) {
            return res.status(409).json({
                success: false,
                code: 'GRAMMAR_IN_USE',
                message: `Mẫu ngữ pháp đang được dùng ở ${lessonRefCount} bài học. Hãy gỡ liên kết trước.`,
            });
        }
        const affected = await GrammarModel.deleteById(req.params.id);
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Grammar not found' });
        }
        res.json({ success: true, message: 'Grammar deleted' });
    } catch (err) {
        console.error('Delete grammar error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete grammar', error: err.message });
    }
}

/**
 * GET /api/lessons/:id/grammar
 */
async function getByLesson(req, res) {
    try {
        const rows = await GrammarModel.getByLessonId(req.params.id);
        res.json({ data: rows.map(row => formatGrammar(row)) });
    } catch (err) {
        console.error('Get lesson grammar error:', err);
        res.status(500).json({ error: 'Failed to get lesson grammar' });
    }
}

module.exports = {
    list,
    getById,
    create,
    update,
    deleteGrammar,
    getByLesson
};
