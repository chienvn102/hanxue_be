/**
 * Grammar Quiz Admin Controller
 * CRUD over grammar_quiz_questions for the admin panel.
 * All routes are gated by adminMiddleware (sets req.admin, not req.user).
 */

const GrammarQuiz = require('../models/grammarQuiz.model');

const QUESTION_TYPES = new Set([
    'multiple_choice',
    'fill_blank',
    'error_identify',
    'sentence_order',
]);

/**
 * Validate a payload for create (strict) or update (partial=true).
 * Returns array of error strings (empty if OK).
 */
function validatePayload(body, { partial = false } = {}) {
    const errors = [];
    const isStr = v => typeof v === 'string' && v.trim().length > 0;

    if (!partial || body.grammar_pattern_id !== undefined) {
        const gid = parseInt(body.grammar_pattern_id, 10);
        if (!Number.isFinite(gid) || gid <= 0) errors.push('grammar_pattern_id phải là số nguyên dương');
    }
    if (!partial || body.question_type !== undefined) {
        if (!QUESTION_TYPES.has(body.question_type)) {
            errors.push(`question_type phải là một trong: ${[...QUESTION_TYPES].join(', ')}`);
        }
    }
    if (!partial || body.question_text !== undefined) {
        if (!isStr(body.question_text)) errors.push('question_text không được rỗng');
    }
    if (!partial || body.options !== undefined) {
        if (!Array.isArray(body.options) || body.options.length !== 4 || !body.options.every(isStr)) {
            errors.push('options phải là mảng đúng 4 chuỗi không rỗng');
        }
    }
    if (!partial || body.correct_answer !== undefined) {
        if (!isStr(body.correct_answer)) errors.push('correct_answer không được rỗng');
        else if (Array.isArray(body.options) && !body.options.map(String).includes(String(body.correct_answer))) {
            errors.push('correct_answer phải khớp một phần tử trong options');
        }
    }
    if (body.points !== undefined && body.points !== null && body.points !== '') {
        const p = parseInt(body.points, 10);
        if (!Number.isFinite(p) || p < 1 || p > 10) errors.push('points phải là số nguyên 1-10');
    }
    return errors;
}

const grammarQuizAdminController = {
    /**
     * GET /api/admin/grammar-quiz
     * Query: grammar_pattern_id?, hsk_level?, page=1, limit=20
     */
    list: async (req, res) => {
        try {
            const { grammar_pattern_id, hsk_level, page, limit } = req.query;
            const data = await GrammarQuiz.adminList({
                grammarId: grammar_pattern_id,
                hskLevel: hsk_level,
                page,
                limit,
            });
            res.json({
                success: true,
                data: data.rows,
                pagination: {
                    page: data.page,
                    limit: data.limit,
                    total: data.total,
                    totalPages: Math.ceil(data.total / data.limit),
                },
            });
        } catch (err) {
            console.error('Admin grammar-quiz list error:', err);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    /**
     * GET /api/admin/grammar-quiz/:id
     */
    getById: async (req, res) => {
        try {
            const row = await GrammarQuiz.adminGetById(req.params.id);
            if (!row) return res.status(404).json({ success: false, message: 'Không tìm thấy câu hỏi' });
            res.json({ success: true, data: row });
        } catch (err) {
            console.error('Admin grammar-quiz getById error:', err);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    /**
     * POST /api/admin/grammar-quiz
     */
    create: async (req, res) => {
        try {
            const errors = validatePayload(req.body);
            if (errors.length) return res.status(400).json({ success: false, message: errors.join('; ') });

            const result = await GrammarQuiz.adminCreate(req.body);
            if (result.notFound) {
                return res.status(404).json({ success: false, message: 'grammar_pattern_id không tồn tại' });
            }
            res.status(201).json({ success: true, data: { id: result.id }, message: 'Tạo câu hỏi thành công' });
        } catch (err) {
            console.error('Admin grammar-quiz create error:', err);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    /**
     * PUT /api/admin/grammar-quiz/:id
     * Partial update — any subset of fields is OK.
     */
    update: async (req, res) => {
        try {
            const errors = validatePayload(req.body, { partial: true });
            if (errors.length) return res.status(400).json({ success: false, message: errors.join('; ') });

            const result = await GrammarQuiz.adminUpdate(req.params.id, req.body);
            if (result.notFound) {
                return res.status(404).json({ success: false, message: 'grammar_pattern_id không tồn tại' });
            }
            if (result.affected === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy câu hỏi' });
            }
            res.json({ success: true, message: 'Cập nhật thành công' });
        } catch (err) {
            console.error('Admin grammar-quiz update error:', err);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    /**
     * DELETE /api/admin/grammar-quiz/:id
     */
    delete: async (req, res) => {
        try {
            const affected = await GrammarQuiz.adminDelete(req.params.id);
            if (affected === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy câu hỏi' });
            res.json({ success: true, message: 'Đã xóa câu hỏi' });
        } catch (err) {
            console.error('Admin grammar-quiz delete error:', err);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },
};

module.exports = grammarQuizAdminController;
