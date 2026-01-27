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
const corsOptions = {
    origin: process.env.CORS_ORIGIN === '*'
        ? '*'
        : (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
    credentials: process.env.CORS_ORIGIN !== '*'
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100
});
app.use(limiter);

// Body parser
app.use(express.json());

// Static files - Audio
app.use('/audio', express.static(path.join(__dirname, '../public/audio')));

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
app.use('/api/user', userRoutes);

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
});
