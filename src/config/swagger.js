const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'HanXue API',
            version: '1.0.0',
            description: 'API for HanXue Chinese Learning Platform - Learn Chinese with Vietnamese translations',
            contact: {
                name: 'HanXue Team',
            },
        },
        servers: [
            { url: 'http://localhost:3636', description: 'Development' },
            { url: 'https://api.hanxue.io.vn/hanxue', description: 'Production' },
        ],
        tags: [
            { name: 'Auth', description: 'Authentication endpoints' },
            { name: 'Vocabulary', description: 'Vocabulary management' },
            { name: 'Characters', description: 'Chinese character details' },
            { name: 'HSK', description: 'HSK level statistics and data' },
            { name: 'Flashcard', description: 'Flashcard study sessions' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter your JWT token',
                },
            },
            schemas: {
                Vocabulary: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer', example: 1 },
                        simplified: { type: 'string', example: '你好' },
                        traditional: { type: 'string', example: '你好' },
                        pinyin: { type: 'string', example: 'nǐ hǎo' },
                        hanViet: { type: 'string', example: 'nể hảo' },
                        meaningVi: { type: 'string', example: 'xin chào' },
                        meaningEn: { type: 'string', example: 'hello' },
                        hskLevel: { type: 'integer', example: 1 },
                        wordType: { type: 'string', example: 'other' },
                        audioUrl: { type: 'string', example: '/audio/cmn-你好.mp3' },
                        frequencyRank: { type: 'integer', example: 100 },
                    },
                },
                Character: {
                    type: 'object',
                    properties: {
                        hanzi: { type: 'string', example: '你' },
                        pinyinMain: { type: 'string', example: 'nǐ' },
                        hanViet: { type: 'string', example: 'nể' },
                        meaningVi: { type: 'string', example: 'bạn, anh, chị' },
                        meaningEn: { type: 'string', example: 'you' },
                        strokeCount: { type: 'integer', example: 7 },
                        strokeOrder: { type: 'array', items: { type: 'string' } },
                        radical: { type: 'string', example: '亻' },
                    },
                },
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer', example: 1 },
                        email: { type: 'string', example: 'user@example.com' },
                        displayName: { type: 'string', example: 'John Doe' },
                        targetHsk: { type: 'integer', example: 3 },
                        totalXp: { type: 'integer', example: 1500 },
                        currentStreak: { type: 'integer', example: 7 },
                        isPremium: { type: 'boolean', example: false },
                    },
                },
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string', example: 'Error message' },
                    },
                },
                Pagination: {
                    type: 'object',
                    properties: {
                        page: { type: 'integer', example: 1 },
                        limit: { type: 'integer', example: 20 },
                        total: { type: 'integer', example: 100 },
                        totalPages: { type: 'integer', example: 5 },
                    },
                },
            },
        },
    },
    apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
