const dns = require('dns');
const nodemailer = require('nodemailer');

let cachedTransporter = null;

try {
    dns.setDefaultResultOrder('ipv4first');
} catch (err) {
    // Older Node versions may not support this setting.
}

function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    return String(value).toLowerCase() === 'true';
}

function getTransporter() {
    if (cachedTransporter) {
        return cachedTransporter;
    }

    const user = process.env.GMAIL_USER;
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    const appPassword = process.env.GMAIL_APP_PASSWORD;
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const parsedPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpPort = Number.isFinite(parsedPort) ? parsedPort : 587;
    const smtpSecure = parseBoolean(process.env.SMTP_SECURE, smtpPort === 465);
    const smtpRequireTls = parseBoolean(process.env.SMTP_REQUIRE_TLS, !smtpSecure);
    const baseTransport = {
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        requireTLS: smtpRequireTls,
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        dnsTimeout: 10000,
        tls: {
            servername: smtpHost
        }
    };

    if (!user) {
        throw new Error('GMAIL_USER is not configured');
    }

    if (clientId && clientSecret && refreshToken) {
        cachedTransporter = nodemailer.createTransport({
            ...baseTransport,
            auth: {
                type: 'OAuth2',
                user,
                clientId,
                clientSecret,
                refreshToken
            }
        });
        return cachedTransporter;
    }

    if (appPassword) {
        cachedTransporter = nodemailer.createTransport({
            ...baseTransport,
            auth: {
                user,
                pass: appPassword
            }
        });
        return cachedTransporter;
    }

    throw new Error('Gmail OAuth2 or app password credentials are not configured');
}

function getEmailProvider() {
    return String(process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'smtp')).toLowerCase();
}

function getFromAddress() {
    return process.env.RESEND_FROM || process.env.MAIL_FROM || `HanXue <${process.env.GMAIL_USER}>`;
}

function getPasswordCodeContent(purpose) {
    if (purpose === 'password_change') {
        return {
            subject: 'HanXue password change code',
            intro: 'Your HanXue password change confirmation code is:'
        };
    }

    return {
        subject: 'HanXue password reset code',
        intro: 'Your HanXue password reset code is:'
    };
}

async function sendSmtpEmail({ to, subject, text, html }) {
    const transporter = getTransporter();
    const from = getFromAddress();

    await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html
    });
}

async function sendResendEmail({ to, subject, text, html }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = getFromAddress();
    const apiUrl = process.env.RESEND_API_URL || 'https://api.resend.com/emails';

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is not configured');
    }

    if (!from || from.includes('<undefined>')) {
        throw new Error('MAIL_FROM or RESEND_FROM is not configured');
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to,
            subject,
            text,
            html
        })
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || body.error || `Resend API failed with HTTP ${response.status}`);
    }

    return response.json();
}

async function sendPasswordCode(to, code, purpose = 'password_reset') {
    const content = getPasswordCodeContent(purpose);
    const message = {
        to,
        subject: content.subject,
        text: [
            content.intro,
            '',
            code,
            '',
            'This code expires in 10 minutes. If you did not request it, ignore this email.'
        ].join('\n'),
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                <p>${content.intro}</p>
                <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
                <p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>
            </div>
        `
    };

    if (getEmailProvider() === 'resend') {
        await sendResendEmail(message);
        return;
    }

    await sendSmtpEmail(message);
}

async function sendPasswordResetCode(to, code) {
    return sendPasswordCode(to, code, 'password_reset');
}

/**
 * SRS due reminder email. Triggered by notificationScheduler when a user has
 * ≥5 items past their next_review across vocab + grammar + writing and has
 * `notification_preferences.srs_review_email_enabled = 1`.
 *
 * @param {{email: string, displayName?: string}} user
 * @param {{dueCount: number, breakdown: {vocab: number, grammar: number, writing: number}}} payload
 */
async function sendSrsDueEmail(user, { dueCount, breakdown }) {
    if (!user?.email) return;
    const appUrl = process.env.APP_URL || 'https://hanxue.app';
    const practiceUrl = `${appUrl.replace(/\/$/, '')}/practice`;
    const name = user.displayName || 'bạn';

    const parts = [];
    if (breakdown?.vocab)   parts.push(`${breakdown.vocab} từ vựng`);
    if (breakdown?.grammar) parts.push(`${breakdown.grammar} điểm ngữ pháp`);
    if (breakdown?.writing) parts.push(`${breakdown.writing} chữ viết`);
    const detail = parts.length ? parts.join(' + ') : `${dueCount} mục`;

    const message = {
        to: user.email,
        subject: `Có ${dueCount} mục đang chờ ôn tập — HanXue`,
        text: [
            `Chào ${name},`,
            '',
            `Bạn đang có ${detail} đã đến hạn ôn tập.`,
            'Vào ôn 5 phút để giữ trí nhớ lâu dài: ' + practiceUrl,
            '',
            'Bạn có thể tắt email này trong Hồ sơ > Thông báo.',
            '— HanXue'
        ].join('\n'),
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color:#222; max-width: 480px;">
                <p>Chào <strong>${name}</strong>,</p>
                <p>Bạn đang có <strong>${detail}</strong> đã đến hạn ôn tập.</p>
                <p style="margin: 24px 0;">
                    <a href="${practiceUrl}" style="background:#e63946;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
                        Vào ôn tập ngay
                    </a>
                </p>
                <p style="font-size:12px;color:#888;">Tắt email nhắc nhở trong Hồ sơ > Thông báo.<br/>— HanXue</p>
            </div>
        `
    };

    if (getEmailProvider() === 'resend') {
        await sendResendEmail(message);
        return;
    }
    await sendSmtpEmail(message);
}

async function verifyEmailTransport() {
    if (getEmailProvider() === 'resend') {
        if (!process.env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY is not configured');
        }

        if (!process.env.RESEND_FROM && !process.env.MAIL_FROM) {
            throw new Error('RESEND_FROM or MAIL_FROM is not configured');
        }

        if (process.env.RESEND_VERIFY_SEND_TO) {
            await sendResendEmail({
                to: process.env.RESEND_VERIFY_SEND_TO,
                subject: 'HanXue email verification test',
                text: 'HanXue Resend email configuration is working.',
                html: '<p>HanXue Resend email configuration is working.</p>'
            });
            return {
                provider: 'resend',
                message: `Resend test email sent to ${process.env.RESEND_VERIFY_SEND_TO}`
            };
        }

        return {
            provider: 'resend',
            message: 'Resend configuration present. Set RESEND_VERIFY_SEND_TO to send a real test email.'
        };
    }

    const transporter = getTransporter();
    await transporter.verify();
    return {
        provider: 'smtp',
        message: 'SMTP transport verified'
    };
}

module.exports = {
    sendPasswordCode,
    sendPasswordResetCode,
    sendSrsDueEmail,
    verifyEmailTransport
};
