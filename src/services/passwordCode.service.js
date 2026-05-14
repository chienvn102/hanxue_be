const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const PasswordResetCodeModel = require('../models/passwordResetCode.model');
const { sendPasswordCode } = require('./email.service');

const PASSWORD_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_PASSWORD_CODE_ATTEMPTS = 5;

function generateCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

async function createAndSendPasswordCode(user, purpose = 'password_reset') {
    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + PASSWORD_CODE_TTL_MS);

    await PasswordResetCodeModel.consumeActiveForUser(user.id, purpose);
    await PasswordResetCodeModel.create({
        userId: user.id,
        purpose,
        codeHash,
        expiresAt
    });
    await sendPasswordCode(user.email, code, purpose);
}

async function verifyPasswordCode(userId, code, purpose = 'password_reset') {
    const resetCode = await PasswordResetCodeModel.findLatestActiveByUserId(userId, purpose);

    if (!resetCode) {
        return { valid: false, error: 'Invalid or expired verification code' };
    }

    if (resetCode.attempts >= MAX_PASSWORD_CODE_ATTEMPTS) {
        await PasswordResetCodeModel.markConsumed(resetCode.id);
        return { valid: false, error: 'Invalid or expired verification code' };
    }

    const valid = await bcrypt.compare(String(code || '').trim(), resetCode.code_hash);
    if (!valid) {
        await PasswordResetCodeModel.incrementAttempts(resetCode.id);
        return { valid: false, error: 'Invalid or expired verification code' };
    }

    await PasswordResetCodeModel.markConsumed(resetCode.id);
    return { valid: true };
}

module.exports = {
    createAndSendPasswordCode,
    verifyPasswordCode
};
