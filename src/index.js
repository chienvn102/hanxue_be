require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const vocabRoutes = require('./routes/vocab');
const characterRoutes = require('./routes/characters');
const hskRoutes = require('./routes/hsk');
const flashcardRoutes = require('./routes/flashcard');
const progressRoutes = require('./routes/progress');
const userRoutes = require('./routes/user');

const app = express();

// Trust proxy (for nginx reverse proxy)
app.set('trust proxy', 1);

// Security - helmet với config cho audio
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const configuredCorsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const corsOptions = {
    origin: process.env.CORS_ORIGIN === '*'
        ? '*'
        : configuredCorsOrigins,
    credentials: process.env.CORS_ORIGIN !== '*'
};
app.use(cors(corsOptions));

// Rate limiting — tắt ngầm cho test project (limit cao gần như vô hạn).
// Bật lại bằng cách set RATE_LIMIT_MAX=100 trong .env nếu cần.
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100000
});
app.use(limiter);

// Body parser
app.use(express.json());

// Static files - Audio
app.use('/audio', express.static(path.join(__dirname, '../public/audio')));
// Static files - Uploads (for admin uploaded files)
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/vocab', vocabRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/hsk', hskRoutes);
app.use('/api/flashcard', flashcardRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/courses', require('./routes/courses'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/user', userRoutes);
app.use('/api/upload', require('./routes/upload'));
app.use('/api/grammar', require('./routes/grammar'));
app.use('/api/notebooks', require('./routes/notebooks'));
app.use('/api/hsk-exams', require('./routes/hskExam'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/speech', require('./routes/speech'));
app.use('/api/practice', require('./routes/practice'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/achievements', require('./routes/achievements'));
app.use('/api/realtime', require('./routes/realtime'));
app.use('/api/pronunciation', require('./routes/pronunciation'));
app.use('/api/writing', require('./routes/writingPractice'));
app.use('/api/media', require('./routes/media'));
app.use('/api', require('./routes/lessonFeedback'));

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 HanXue API running on port ${PORT}`);
    // Start scheduled notifications (daily streak reminder, SRS overdue, etc.)
    try {
        require('./services/notificationScheduler.service').start();
    } catch (e) {
        console.error('Notification scheduler failed to start:', e.message);
    }
});
