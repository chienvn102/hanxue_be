const express = require('express');
const router = express.Router();
const notebookController = require('../controllers/notebook.controller');
const { authMiddleware } = require('../middleware/auth');

// All routes require authentication
router.use(authMiddleware);

// Notebook CRUD
router.get('/', notebookController.getNotebooks);
router.post('/', notebookController.createNotebook);
router.put('/:id', notebookController.updateNotebook);
router.delete('/:id', notebookController.deleteNotebook);

// Notebook items
router.get('/:id/items', notebookController.getNotebookItems);
router.post('/:id/items', notebookController.addVocabToNotebook);
router.delete('/:id/items/:vocabId', notebookController.removeVocabFromNotebook);

// Get all saved vocab IDs (for checking saved status on frontend)
router.get('/saved-ids', notebookController.getSavedVocabIds);

module.exports = router;
