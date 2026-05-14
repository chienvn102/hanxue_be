const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const SECRET_RE = /\b(?:password|passwd|secret|api[_-]?key|token|jwt|private[_-]?key)\b\s*[:=]\s*["']?[^"'\s]{6,}/gi;
const SQL_DUMP_RE = /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\s+.+\b(?:FROM|TABLE|INTO|SET)\b/gi;

const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|above|earlier)\s+(instructions|rules|messages)/gi,
    /you\s+are\s+now\s+/gi,
    /\bsystem\s*:/gi,
    /\bdeveloper\s*:/gi,
    /\[\[\s*admin\s*\]\]/gi,
    /reveal\s+(your\s+)?(prompt|system|instructions|secrets?)/gi,
];

// Apply replace-then-compare thay vì test+replace để tránh lỗi `lastIndex`
// advances khi RegExp dùng `/g`. Pattern: nếu replace đổi chuỗi → matched.
function applyReplacements(input, replacements) {
    let output = String(input || '');
    const flagReasons = [];
    for (const [pattern, replacement, reason] of replacements) {
        const next = output.replace(pattern, replacement);
        if (next !== output) {
            flagReasons.push(reason);
            output = next;
        }
    }
    return { output, flagReasons: [...new Set(flagReasons)] };
}

function sanitizeUserMessage(message) {
    const original = String(message || '');
    const replacements = PROMPT_INJECTION_PATTERNS.map(p => [p, '[removed]', 'prompt_injection_phrase']);
    const { output: sanitized, flagReasons } = applyReplacements(original, replacements);

    return {
        text: `<<<USER_MESSAGE>>>\n${sanitized.trim()}\n<<<END_USER_MESSAGE>>>`,
        original,
        flagReasons,
        flagged: flagReasons.length > 0,
    };
}

function redactSensitiveOutput(text) {
    const replacements = [
        [EMAIL_RE, '[redacted-email]', 'email'],
        [JWT_RE, '[redacted-token]', 'jwt'],
        [SECRET_RE, '[redacted-secret]', 'secret'],
        [SQL_DUMP_RE, '[redacted-sql]', 'sql'],
    ];
    const { output: redacted, flagReasons } = applyReplacements(text, replacements);

    return {
        text: redacted,
        flagReasons,
        flagged: flagReasons.length > 0,
    };
}

function safeJson(value) {
    if (value === undefined) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

module.exports = {
    sanitizeUserMessage,
    redactSensitiveOutput,
    safeJson,
};
