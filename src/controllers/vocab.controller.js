/**
 * Vocabulary Controller
 * Handles HTTP request/response for vocabulary endpoints
 */

const VocabModel = require('../models/vocab.model');

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
        const { hsk, q, page = 1, limit = 20 } = req.query;

        const { rows, total } = await VocabModel.getList({
            hsk,
            q,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({
            data: rows.map(row => formatVocab(row)),
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

        res.json(formatVocab(vocab, true));
    } catch (err) {
        console.error('Get vocab by id error:', err);
        res.status(500).json({ error: 'Failed to get vocabulary' });
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
 * POST /api/vocab (Admin)
 */
async function create(req, res) {
    try {
        const id = await VocabModel.create(req.body);
        const vocab = await VocabModel.getById(id);
        res.status(201).json({ success: true, data: formatVocab(vocab, true) });
    } catch (err) {
        console.error('Create vocab error:', err);
        res.status(500).json({ success: false, message: 'Failed to create vocabulary', error: err.message });
    }
}

/**
 * PUT /api/vocab/:id (Admin)
 */
async function update(req, res) {
    try {
        const affected = await VocabModel.update(req.params.id, req.body);
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Vocabulary not found or no changes made' });
        }
        const vocab = await VocabModel.getById(req.params.id);
        res.json({ success: true, data: formatVocab(vocab, true) });
    } catch (err) {
        console.error('Update vocab error:', err);
        res.status(500).json({ success: false, message: 'Failed to update vocabulary', error: err.message });
    }
}

/**
 * DELETE /api/vocab/:id (Admin)
 */
async function deleteVocab(req, res) {
    try {
        const affected = await VocabModel.deleteById(req.params.id);
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
    deleteVocab
};
