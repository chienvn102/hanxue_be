/**
 * Vertex AI Gemini service.
 *
 * This is the primary AI provider for HanXue. It keeps a Groq-compatible
 * `sendMessage()` adapter so existing controllers can migrate without changing
 * API response shapes.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULT_LOCATION = process.env.GCP_LOCATION || 'asia-southeast1';
const REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10);

let vertexClient;

function getVertexClient() {
    if (vertexClient) return vertexClient;

    const project = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
        const err = new Error('GCP_PROJECT_ID is not configured');
        err.publicMessage = 'Dich vu AI chua duoc cau hinh.';
        err.status = 500;
        throw err;
    }

    const { VertexAI } = require('@google-cloud/vertexai');
    vertexClient = new VertexAI({ project, location: DEFAULT_LOCATION });
    return vertexClient;
}

function toGeminiContents(messages = []) {
    const contents = [];
    const systemParts = [];

    for (const msg of messages) {
        const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : msg.role;
        if (Array.isArray(msg.parts)) {
            if (role === 'system') {
                systemParts.push(...msg.parts.filter(p => p.text));
            } else {
                contents.push({
                    role: role === 'function' ? 'function' : role === 'model' ? 'model' : 'user',
                    parts: msg.parts,
                });
            }
            continue;
        }
        const text = typeof msg.content === 'string'
            ? msg.content
            : '';

        if (!text.trim()) continue;

        if (role === 'system') {
            systemParts.push({ text });
            continue;
        }

        contents.push({
            role: role === 'model' ? 'model' : 'user',
            parts: [{ text }],
        });
    }

    return {
        contents,
        systemInstruction: systemParts.length ? { role: 'system', parts: systemParts } : undefined,
    };
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`${label} timed out after ${ms}ms`);
                err.publicMessage = 'AI phan hoi qua cham, vui long thu lai.';
                err.status = 504;
                reject(err);
            }, ms);
        }),
    ]);
}

function unwrapJsonFence(text) {
    return String(text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function getSafetySettings() {
    const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
    return [
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        HarmCategory.HARM_CATEGORY_HARASSMENT,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    ].map(category => ({
        category,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    }));
}

async function chat(messages, {
    tools,
    systemInstruction,
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxOutputTokens = 2048,
} = {}) {
    try {
        const vertex = getVertexClient();
        const converted = toGeminiContents(messages);
        const finalSystemInstruction = systemInstruction
            ? { role: 'system', parts: [{ text: systemInstruction }] }
            : converted.systemInstruction;

        const generativeModel = vertex.getGenerativeModel({
            model,
            systemInstruction: finalSystemInstruction,
            tools,
            generationConfig: { temperature, maxOutputTokens },
            safetySettings: getSafetySettings(),
        });

        const result = await withTimeout(
            generativeModel.generateContent({ contents: converted.contents }),
            REQUEST_TIMEOUT_MS,
            'Gemini'
        );

        const response = result.response;
        const text = typeof response.text === 'function'
            ? response.text()
            : response.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

        return {
            text,
            usage: response.usageMetadata || null,
            raw: response,
        };
    } catch (error) {
        const err = new Error(error.message || 'Gemini request failed');
        err.publicMessage = error.publicMessage || 'Loi ket noi AI. Vui long thu lai sau.';
        err.status = error.status || 502;
        throw err;
    }
}

async function sendMessage(messages, requestId) {
    const logPrefix = requestId ? `[${requestId}]` : '[gemini]';
    try {
        const result = await chat(messages);
        const tokensUsed = result.usage?.totalTokenCount || result.usage?.totalTokens || 0;
        return { text: result.text, tokensUsed };
    } catch (error) {
        console.error(`${logPrefix} Gemini failed:`, error.message);
        throw error;
    }
}

async function generateExamples(simplified, pinyin, meaningVi) {
    const prompt = `Tao 3 cau vi du don gian cho tu tieng Trung "${simplified}" (${pinyin}).
Nghia tieng Viet: ${meaningVi || 'khong ro'}

Yeu cau:
- Moi cau ngan gon, de hieu, phu hop HSK 1-4.
- Tra ve CHI JSON array, khong markdown.
- Format: [{"zh":"...","vi":"..."}]`;

    try {
        const { text } = await chat([{ role: 'user', content: prompt }], {
            temperature: 0.4,
            maxOutputTokens: 800,
        });
        const parsed = JSON.parse(unwrapJsonFence(text).match(/\[[\s\S]*\]/)?.[0] || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Gemini generateExamples error:', error.message);
        return [];
    }
}

async function gradeTranslate({ vi, expectedZh, userZh }) {
    const messages = [
        {
            role: 'system',
            content: 'Ban la giao vien cham bai dich tieng Trung. Tra ve CHI JSON hop le.',
        },
        {
            role: 'user',
            content:
                `Cau goc tieng Viet: "${vi}"\n` +
                `Ban dich mau: "${expectedZh}"\n` +
                `Ban dich hoc vien: "${userZh}"\n\n` +
                'Cham theo dung nghia, ngu phap, tu vung. JSON keys: score 0-100, feedback_vi, correct_zh.',
        },
    ];
    const { text } = await chat(messages, { temperature: 0.2, maxOutputTokens: 700 });
    return JSON.parse(unwrapJsonFence(text));
}

module.exports = {
    chat,
    sendMessage,
    generateExamples,
    gradeTranslate,
    unwrapJsonFence,
};
