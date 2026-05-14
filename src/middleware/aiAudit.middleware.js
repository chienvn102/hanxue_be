const db = require('../config/database');
const { safeJson } = require('../services/aiSafety.service');

async function logAiAudit({
    userId,
    requestId,
    userMessage,
    toolCalls = [],
    responseText,
    flagged = false,
    flagReasons = [],
}) {
    try {
        await db.execute(
            `INSERT INTO ai_audit_log
                (user_id, request_id, user_message, tool_calls, response_text, flagged, flag_reasons)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId || null,
                requestId,
                userMessage || null,
                safeJson(toolCalls),
                responseText || null,
                flagged ? 1 : 0,
                safeJson(flagReasons),
            ]
        );
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.warn('[ai-audit] ai_audit_log missing; run migration 012_ai_audit_log.sql');
            return;
        }
        console.error('[ai-audit] log failed:', error.message);
    }
}

module.exports = {
    logAiAudit,
};
