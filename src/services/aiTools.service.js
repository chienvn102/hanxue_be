const db = require('../config/database');
const gemini = require('./gemini.service');
const UserModel = require('../models/user.model');
const NotebookModel = require('../models/notebook.model');
const ProgressModel = require('../models/progress.model');
const VocabModel = require('../models/vocab.model');
const GrammarModel = require('../models/grammar.model');

const TOOL_QUOTAS = {
    get_user_profile: 100,
    search_user_vocabulary: 200,
    get_recent_mistakes: 50,
    get_vocab_by_hsk: 100,
    get_grammar_for_level: 100,
};

const AI_TOOLS = [
    {
        name: 'get_user_profile',
        capability: 'read_self',
        description: 'Lay thong tin level, streak, XP va completed HSK levels cua user hien tai.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: async (args, ctx) => UserModel.getLearningProfile(ctx.userId),
    },
    {
        name: 'search_user_vocabulary',
        capability: 'read_self',
        description: 'Tim vocab user da luu/dang hoc theo tu khoa.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                mastery: { type: 'string', enum: ['new', 'learning', 'mastered', 'all'] },
                limit: { type: 'integer' },
            },
            required: ['query'],
        },
        handler: async ({ query, mastery = 'all', limit = 10 }, ctx) =>
            NotebookModel.searchUserVocab(ctx.userId, query, mastery, limit),
    },
    {
        name: 'get_recent_mistakes',
        capability: 'read_self',
        description: 'Lay toi da 20 cau user tra loi sai gan day trong HSK practice/exam.',
        parameters: {
            type: 'object',
            properties: { days: { type: 'integer' } },
            required: [],
        },
        handler: async ({ days = 7 }, ctx) => ProgressModel.getRecentMistakes(ctx.userId, days),
    },
    {
        name: 'get_vocab_by_hsk',
        capability: 'read_self',
        description: 'Liet ke tu vung cua mot HSK level ma user chua mastered.',
        parameters: {
            type: 'object',
            properties: { hsk_level: { type: 'integer' } },
            required: ['hsk_level'],
        },
        handler: async ({ hsk_level }, ctx) =>
            VocabModel.findNotMasteredByUser(ctx.userId, Math.min(6, Math.max(1, Number(hsk_level) || 1)), 10),
    },
    {
        name: 'get_grammar_for_level',
        capability: 'read_public',
        description: 'Lay grammar points cua mot HSK level.',
        parameters: {
            type: 'object',
            properties: { hsk_level: { type: 'integer' }, limit: { type: 'integer' } },
            required: ['hsk_level'],
        },
        handler: async ({ hsk_level, limit = 20 }) =>
            GrammarModel.findByHskLevel(Math.min(6, Math.max(1, Number(hsk_level) || 1)), limit),
    },
];

const TOOL_MAP = new Map(AI_TOOLS.map(tool => [tool.name, tool]));

function getToolDeclarations(capabilities = ['read_self', 'read_public']) {
    return AI_TOOLS
        .filter(tool => capabilities.includes(tool.capability))
        .map(({ name, description, parameters }) => ({ name, description, parameters }));
}

async function incrementToolUsage(userId, toolName) {
    try {
        const [rows] = await db.execute(
            `SELECT tool_calls FROM daily_activity
              WHERE user_id = ? AND activity_date = CURDATE()`,
            [userId]
        );
        const rawToolCalls = rows[0]?.tool_calls;
        const current = rawToolCalls
            ? (typeof rawToolCalls === 'string' ? JSON.parse(rawToolCalls) : rawToolCalls)
            : {};
        const nextCount = Number(current[toolName] || 0) + 1;
        if (nextCount > (TOOL_QUOTAS[toolName] || 50)) {
            const err = new Error(`Tool quota exceeded: ${toolName}`);
            err.publicMessage = 'AI dang vuot gioi han truy van du lieu hom nay.';
            err.status = 429;
            throw err;
        }
        current[toolName] = nextCount;
        await db.execute(
            `INSERT INTO daily_activity (user_id, activity_date, tool_calls)
             VALUES (?, CURDATE(), ?)
             ON DUPLICATE KEY UPDATE tool_calls = VALUES(tool_calls)`,
            [userId, JSON.stringify(current)]
        );
    } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR' || error.code === 'ER_NO_SUCH_TABLE') return;
        throw error;
    }
}

async function executeToolCall(functionCall, ctx) {
    const tool = TOOL_MAP.get(functionCall.name);
    if (!tool) {
        return { error: `Unknown tool ${functionCall.name}` };
    }
    await incrementToolUsage(ctx.userId, tool.name);
    const args = functionCall.args || {};
    const result = await tool.handler(args, ctx);
    return { result };
}

function extractFunctionCalls(response) {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return parts.map(part => part.functionCall).filter(Boolean);
}

function getModelParts(response) {
    return response?.candidates?.[0]?.content?.parts || [];
}

async function runWithTools(messages, ctx, options = {}) {
    const tools = [{ functionDeclarations: getToolDeclarations(options.capabilities) }];
    const conversation = [...messages];
    const toolCalls = [];

    for (let i = 0; i < 5; i++) {
        const result = await gemini.chat(conversation, {
            tools,
            systemInstruction: options.systemInstruction,
            temperature: options.temperature ?? 0.5,
            maxOutputTokens: options.maxOutputTokens || 2048,
        });

        const calls = extractFunctionCalls(result.raw);
        if (!calls.length) {
            return { text: result.text, toolCalls };
        }

        const modelParts = getModelParts(result.raw);
        conversation.push({ role: 'model', parts: modelParts });

        for (const call of calls) {
            const toolResult = await executeToolCall(call, ctx);
            toolCalls.push({ name: call.name, args: call.args || {}, resultPreview: toolResult.error ? toolResult.error : 'ok' });
            conversation.push({
                role: 'function',
                parts: [{
                    functionResponse: {
                        name: call.name,
                        response: toolResult,
                    },
                }],
            });
        }
    }

    const err = new Error('Too many tool call iterations');
    err.publicMessage = 'AI can qua nhieu buoc xu ly. Vui long hoi ngan hon.';
    err.status = 429;
    throw err;
}

module.exports = {
    AI_TOOLS,
    getToolDeclarations,
    runWithTools,
};
