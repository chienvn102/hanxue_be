/**
 * Groq AI Service
 * Wrapper for Groq API chat completions
 * Features: timeout, 1x retry on transient errors, JSON response guard
 *
 * Error convention:
 *   - throw GroqError with { publicMessage, status, retryable }
 *   - controller uses publicMessage for client, full message for logs
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 60000; // 60s — llama-3.3-70b thường mất 10-25s, peak có thể 30-45s
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // base delay; thực tế dùng exponential backoff: 1s, 2s, 4s

/** Network-level errors that are safe to retry */
const RETRYABLE_NETWORK_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
    'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

/**
 * Check if an error is a retryable network error (TypeError from fetch, or known codes)
 */
function isNetworkError(err) {
    if (err.name === 'AbortError') return true;
    if (err instanceof TypeError) return true; // fetch network failure
    const code = err.code || err.cause?.code;
    return code && RETRYABLE_NETWORK_CODES.has(code);
}

/**
 * Map upstream status to a public-safe user message (Vietnamese)
 * Internal details stay in logs only.
 */
function getPublicMessage(status, internalMsg) {
    if (status === 429) return 'AI đang quá tải, vui lòng thử lại sau 1 phút.';
    if (status === 503 || status === 502) return 'Dịch vụ AI tạm thời gián đoạn. Vui lòng thử lại.';
    if (status === 504) return 'AI phản hồi quá chậm, vui lòng thử lại.';
    return 'Lỗi kết nối AI. Vui lòng thử lại sau.';
}

/**
 * Internal: single fetch attempt to Groq API
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
async function _fetchGroq(messages) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        const err = new Error('GROQ_API_KEY chưa được cấu hình');
        err.publicMessage = 'Lỗi cấu hình hệ thống. Vui lòng liên hệ quản trị.';
        err.status = 500;
        err.retryable = false;
        throw err;
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
    } catch (fetchErr) {
        clearTimeout(timeout);
        // Network-level failure (AbortError, TypeError, ECONNRESET, etc.)
        const err = new Error(`Groq fetch failed: ${fetchErr.message}`);
        err.publicMessage = fetchErr.name === 'AbortError'
            ? 'AI phản hồi quá chậm, vui lòng thử lại.'
            : 'Lỗi kết nối AI. Vui lòng thử lại sau.';
        err.status = fetchErr.name === 'AbortError' ? 504 : 502;
        err.retryable = isNetworkError(fetchErr);
        throw err;
    } finally {
        clearTimeout(timeout);
    }

    // Guard: parse response body safely (may be HTML on 502/503)
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const bodySnippet = (await res.text()).slice(0, 200);
        const err = new Error(`Groq returned non-JSON (${res.status}): ${bodySnippet}`);
        err.publicMessage = getPublicMessage(res.status);
        err.status = res.status;
        err.retryable = RETRYABLE_STATUS.has(res.status);
        throw err;
    }

    try {
        data = await res.json();
    } catch (parseErr) {
        const err = new Error(`Groq response parse error (${res.status})`);
        err.publicMessage = getPublicMessage(res.status);
        err.status = res.status;
        err.retryable = RETRYABLE_STATUS.has(res.status);
        throw err;
    }

    if (!res.ok) {
        const internalMsg = data.error?.message || `Groq API error (${res.status})`;
        const err = new Error(internalMsg);
        err.publicMessage = getPublicMessage(res.status, internalMsg);
        err.status = res.status;
        err.retryable = RETRYABLE_STATUS.has(res.status);
        throw err;
    }

    const text = data.choices?.[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;

    return { text, tokensUsed };
}

/**
 * Send messages to Groq API with 1x retry on transient errors
 * @param {Array<{role: string, content: string}>} messages - Full message array including system prompt
 * @param {string} [requestId] - Optional request ID for log correlation
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
async function sendMessage(messages, requestId) {
    const logPrefix = requestId ? `[${requestId}]` : '[groq]';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await _fetchGroq(messages);
            if (attempt > 0) {
                console.log(`${logPrefix} Groq retry #${attempt} succeeded`);
            }
            return result;
        } catch (err) {
            const isLastAttempt = attempt >= MAX_RETRIES;
            const isRetryable = err.retryable || isNetworkError(err);

            if (isRetryable && !isLastAttempt) {
                const backoff = RETRY_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
                console.warn(`${logPrefix} Groq attempt #${attempt + 1} failed (${err.message}), retrying in ${backoff}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
                continue;
            }

            // Final failure — log full error, throw with public-safe message
            console.error(`${logPrefix} Groq failed after ${attempt + 1} attempt(s):`, err.message);

            // Preserve publicMessage and status for controller
            const finalErr = new Error(err.message);
            finalErr.publicMessage = err.publicMessage || 'Lỗi kết nối AI. Vui lòng thử lại sau.';
            finalErr.status = err.status || 500;
            throw finalErr;
        }
    }
}

module.exports = {
    sendMessage
};
