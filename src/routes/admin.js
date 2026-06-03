const express = require('express');
const router = express.Router();
const adminAuthController = require('../controllers/adminAuth.controller');
const adminMiddleware = require('../middleware/admin.middleware');
const audioGenController = require('../controllers/audioGen.controller');
const adminUserController = require('../controllers/adminUser.controller');
const grammarQuizAdminController = require('../controllers/grammarQuizAdmin.controller');

// Public admin routes
router.post('/login', adminAuthController.login);

// Protected admin routes
router.get('/me', adminMiddleware, adminAuthController.getMe);
router.get('/stats', adminMiddleware, adminAuthController.getStats);
router.get('/users', adminMiddleware, adminUserController.listUsers);
router.get('/users/stats', adminMiddleware, adminUserController.getUserStats);
router.get('/jobs/:jobId', adminMiddleware, audioGenController.getJob);
router.post('/vocab/:id/gen-audio', adminMiddleware, audioGenController.genVocabAudio);
router.post('/gen-audio-text', adminMiddleware, audioGenController.genTextAudio);
router.post('/hsk-questions/:id/gen-audio', adminMiddleware, audioGenController.genHskQuestionAudio);
router.post('/lessons/:id/gen-audio', adminMiddleware, audioGenController.genLessonAudio);
router.post('/examples/:id/gen-audio', adminMiddleware, audioGenController.genExampleAudio);
router.post('/gen-image', adminMiddleware, audioGenController.genImage);

// Grammar quiz questions CRUD
router.get('/grammar-quiz',        adminMiddleware, grammarQuizAdminController.list);
router.get('/grammar-quiz/:id',    adminMiddleware, grammarQuizAdminController.getById);
router.post('/grammar-quiz',       adminMiddleware, grammarQuizAdminController.create);
router.put('/grammar-quiz/:id',    adminMiddleware, grammarQuizAdminController.update);
router.delete('/grammar-quiz/:id', adminMiddleware, grammarQuizAdminController.delete);

module.exports = router;
