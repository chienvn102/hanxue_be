const FlashcardDeck = require('../models/flashcardDeck.model');

function formatCard(row) {
    return {
        id: row.id,
        simplified: row.simplified,
        traditional: row.traditional,
        pinyin: row.pinyin,
        hanViet: row.han_viet,
        meaningVi: row.meaning_vi,
        meaningEn: row.meaning_en,
        hskLevel: row.hsk_level,
    };
}

exports.list = async (req, res) => {
    try {
        const decks = await FlashcardDeck.listByUser(req.user.userId);
        res.json({ success: true, data: decks });
    } catch (error) {
        console.error('List flashcard decks error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, description, source_type, source_ref } = req.body || {};
        if (!name) return res.status(400).json({ success: false, message: 'name required' });
        const id = await FlashcardDeck.create({
            userId: req.user.userId,
            name,
            description,
            sourceType: source_type || 'manual',
            sourceRef: source_ref || null,
        });
        res.status(201).json({ success: true, data: { id } });
    } catch (error) {
        console.error('Create flashcard deck error:', error);
        res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
    }
};

exports.addItem = async (req, res) => {
    try {
        const ok = await FlashcardDeck.addItem(req.params.id, req.user.userId, req.body?.vocab_id);
        if (!ok) return res.status(404).json({ success: false, message: 'Deck not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Add flashcard deck item error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.removeItem = async (req, res) => {
    try {
        const ok = await FlashcardDeck.removeItem(req.params.id, req.user.userId, req.params.vocabId);
        if (!ok) return res.status(404).json({ success: false, message: 'Deck not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Remove flashcard deck item error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteDeck = async (req, res) => {
    try {
        const affected = await FlashcardDeck.deleteDeck(req.params.id, req.user.userId);
        if (!affected) return res.status(404).json({ success: false, message: 'Deck not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete flashcard deck error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.session = async (req, res) => {
    try {
        const rows = await FlashcardDeck.getSession(req.params.id, req.user.userId, req.query.limit);
        if (!rows) return res.status(404).json({ success: false, message: 'Deck not found' });
        res.json({ count: rows.length, flashcards: rows.map(formatCard) });
    } catch (error) {
        console.error('Flashcard deck session error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
