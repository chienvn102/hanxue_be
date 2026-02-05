const Notebook = require('../models/notebook.model');

const notebookController = {
    // Get all notebooks for current user
    getNotebooks: async (req, res) => {
        try {
            const notebooks = await Notebook.findAllByUser(req.user.userId);
            res.json({ success: true, data: notebooks });
        } catch (error) {
            console.error('Error getting notebooks:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Create new notebook
    createNotebook: async (req, res) => {
        try {
            const { name, color } = req.body;
            if (!name) {
                return res.status(400).json({ success: false, message: 'Tên sổ tay là bắt buộc' });
            }

            const id = await Notebook.create({
                user_id: req.user.userId,
                name,
                color
            });

            res.status(201).json({
                success: true,
                data: { id, name, color: color || '#EF7B7B' },
                message: 'Tạo sổ tay thành công'
            });
        } catch (error) {
            console.error('Error creating notebook:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Update notebook
    updateNotebook: async (req, res) => {
        try {
            const { id } = req.params;
            const { name, color } = req.body;

            const affected = await Notebook.update(id, req.user.userId, { name, color });
            if (affected === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy sổ tay' });
            }

            res.json({ success: true, message: 'Cập nhật thành công' });
        } catch (error) {
            console.error('Error updating notebook:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Delete notebook
    deleteNotebook: async (req, res) => {
        try {
            const { id } = req.params;
            const affected = await Notebook.delete(id, req.user.userId);

            if (affected === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể xóa sổ tay mặc định hoặc không tìm thấy'
                });
            }

            res.json({ success: true, message: 'Xóa thành công' });
        } catch (error) {
            console.error('Error deleting notebook:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Get items in notebook
    getNotebookItems: async (req, res) => {
        try {
            const { id } = req.params;
            const items = await Notebook.getItems(id, req.user.userId);
            res.json({ success: true, data: items });
        } catch (error) {
            console.error('Error getting notebook items:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Add vocab to notebook
    addVocabToNotebook: async (req, res) => {
        try {
            const { id } = req.params; // notebook id
            const { vocab_id, note } = req.body;

            if (!vocab_id) {
                return res.status(400).json({ success: false, message: 'vocab_id là bắt buộc' });
            }

            const result = await Notebook.addItem(id, vocab_id, note);
            if (!result.success) {
                return res.status(400).json({ success: false, message: result.message });
            }

            res.status(201).json({ success: true, message: 'Đã thêm vào sổ tay' });
        } catch (error) {
            console.error('Error adding vocab to notebook:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Remove vocab from notebook
    removeVocabFromNotebook: async (req, res) => {
        try {
            const { id, vocabId } = req.params;
            const affected = await Notebook.removeItem(id, vocabId, req.user.userId);

            if (affected === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy từ trong sổ tay' });
            }

            res.json({ success: true, message: 'Đã xóa khỏi sổ tay' });
        } catch (error) {
            console.error('Error removing vocab from notebook:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Quick save vocab to default notebook
    saveVocab: async (req, res) => {
        try {
            const { id } = req.params; // vocab id

            // Get or create default notebook
            const notebook = await Notebook.getOrCreateDefault(req.user.userId);

            // Add vocab to default notebook
            const result = await Notebook.addItem(notebook.id, id);
            if (!result.success) {
                return res.status(400).json({ success: false, message: result.message });
            }

            res.status(201).json({
                success: true,
                message: 'Đã lưu vào Sổ tay mặc định',
                notebook_id: notebook.id
            });
        } catch (error) {
            console.error('Error saving vocab:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Unsave vocab (remove from all notebooks)
    unsaveVocab: async (req, res) => {
        try {
            const { id } = req.params; // vocab id

            // Get default notebook and remove
            const notebook = await Notebook.getOrCreateDefault(req.user.userId);
            await Notebook.removeItem(notebook.id, id, req.user.userId);

            res.json({ success: true, message: 'Đã bỏ lưu' });
        } catch (error) {
            console.error('Error unsaving vocab:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    },

    // Get all saved vocab IDs for current user
    getSavedVocabIds: async (req, res) => {
        try {
            const ids = await Notebook.getSavedVocabIds(req.user.userId);
            res.json({ success: true, data: ids });
        } catch (error) {
            console.error('Error getting saved vocab ids:', error);
            res.status(500).json({ success: false, message: 'Lỗi server' });
        }
    }
};

module.exports = notebookController;
