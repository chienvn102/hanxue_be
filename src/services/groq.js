/**
 * Groq AI Service
 * Wrapper for Groq API chat completions
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 15000; // 15 second timeout

/**
 * Send messages to Groq API and get a response
 * @param {Array<{role: string, content: string}>} messages - Full message array including system prompt
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
async function sendMessage(messages) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY chưa được cấu hình');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    let res;
    try {
        res = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages,
                max_tokens: 1000,
                temperature: 0.7,
            }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    const data = await res.json();

    if (!res.ok) {
        const errMsg = data.error?.message || `Groq API error (${res.status})`;
        console.error('Groq API error:', errMsg);
        throw new Error(errMsg);
    }

    const text = data.choices?.[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;

    return { text, tokensUsed };
}

module.exports = {
    sendMessage
};
