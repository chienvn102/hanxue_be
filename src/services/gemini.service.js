/**
 * Google Gen AI SDK wrapper (Vertex AI backend).
 *
 * SDK: `@google/genai` v2.x — thay thế `@google-cloud/vertexai` đã deprecated
 * (sẽ remove June 2026).
 *
 * Public API giữ nguyên để controller không cần đổi:
 *   - chat(messages, opts)              → { text, usage, raw }
 *   - sendMessage(messages, requestId)  → { text, tokensUsed }
 *   - generateExamples(...)             → array
 *   - gradeTranslate(...)               → { score, feedback_vi, correct_zh }
 *   - unwrapJsonFence(text)             → text
 */

// Default model — gemini-2.5-flash-lite is the speed-optimised variant:
// ~3-4× faster TTFT than gemini-2.5-flash, ~10× cheaper, slight quality drop
// (still strong for short outputs: chat replies, translate grading, examples gen).
// Override via env if you need higher quality (gemini-2.5-flash, gemini-2.5-pro)
// or want to test newer models (gemini-3-pro, gemini-3-flash-preview).
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const DEFAULT_LOCATION = process.env.GCP_LOCATION || 'asia-southeast1';
const REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10);

const aiClients = new Map();

function getClient(location = DEFAULT_LOCATION) {
    const resolvedLocation = location || DEFAULT_LOCATION;
    if (aiClients.has(resolvedLocation)) return aiClients.get(resolvedLocation);

    const project = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
        const err = new Error('GCP_PROJECT_ID is not configured');
        err.publicMessage = 'Dich vu AI chua duoc cau hinh.';
        err.status = 500;
        throw err;
    }

    const { GoogleGenAI } = require('@google/genai');
    const aiClient = new GoogleGenAI({
        vertexai: true,
        project,
        location: resolvedLocation,
    });
    aiClients.set(resolvedLocation, aiClient);
    return aiClient;
}

/**
 * Convert messages array sang shape của @google/genai:
 *   - `contents: [{ role: 'user'|'model'|'function', parts: [...] }]`
 *   - `systemInstruction` tách riêng ra option-level.
 * Vẫn accept Groq-compatible shape `{ role: 'system'|'user'|'assistant'|'function', content?, parts? }`.
 */
function toGenAiContents(messages = []) {
    const contents = [];
    const systemParts = [];

    for (const msg of messages) {
        const rawRole = msg.role === 'assistant' ? 'model' : msg.role;
        if (Array.isArray(msg.parts)) {
            if (rawRole === 'system') {
                systemParts.push(...msg.parts.filter(p => p.text));
                continue;
            }
            contents.push({
                role: rawRole === 'function' ? 'function' : rawRole === 'model' ? 'model' : 'user',
                parts: msg.parts,
            });
            continue;
        }
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (!text.trim()) continue;
        if (rawRole === 'system') {
            systemParts.push({ text });
            continue;
        }
        contents.push({
            role: rawRole === 'model' ? 'model' : 'user',
            parts: [{ text }],
        });
    }

    return { contents, systemParts };
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
    // @google/genai exposes enums under HarmCategory / HarmBlockThreshold (camelCase).
    let HarmCategory, HarmBlockThreshold;
    try {
        ({ HarmCategory, HarmBlockThreshold } = require('@google/genai'));
    } catch {
        return undefined; // SDK version không có enums → bỏ qua
    }
    if (!HarmCategory || !HarmBlockThreshold) return undefined;
    return [
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        HarmCategory.HARM_CATEGORY_HARASSMENT,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    ]
        .filter(Boolean)
        .map(category => ({
            category,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        }));
}

/**
 * Extract text từ response của @google/genai v2.x.
 *   - response.text (string accessor — preferred)
 *   - response.candidates[0].content.parts[*].text fallback
 */
function extractText(response) {
    if (!response) return '';
    if (typeof response.text === 'string' && response.text.length) return response.text;
    const parts = response.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p.text || '').join('');
}

async function chat(messages, {
    tools,
    systemInstruction,
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxOutputTokens = 2048,
    timeoutMs = REQUEST_TIMEOUT_MS,
    location = DEFAULT_LOCATION,
    responseMimeType,
    responseSchema,
    responseJsonSchema,
    thinkingBudget,
} = {}) {
    try {
        const ai = getClient(location);
        const { contents, systemParts } = toGenAiContents(messages);
        const finalSystemInstruction = systemInstruction
            ? [{ text: systemInstruction }]
            : (systemParts.length ? systemParts : undefined);

        const config = {
            temperature,
            maxOutputTokens,
        };
        if (finalSystemInstruction) config.systemInstruction = finalSystemInstruction;
        if (responseMimeType) config.responseMimeType = responseMimeType;
        if (responseSchema) config.responseSchema = responseSchema;
        if (responseJsonSchema) config.responseJsonSchema = responseJsonSchema;
        if (typeof thinkingBudget === 'number') {
            config.thinkingConfig = { thinkingBudget };
        }
        const safety = getSafetySettings();
        if (safety) config.safetySettings = safety;
        if (tools) config.tools = tools;

        const result = await withTimeout(
            ai.models.generateContent({ model, contents, config }),
            timeoutMs,
            'Gemini'
        );

        const finishReason = result?.candidates?.[0]?.finishReason || null;
        return {
            text: extractText(result),
            usage: result.usageMetadata || null,
            finishReason,
            raw: result,
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
