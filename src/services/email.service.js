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

async function sendPasswordCode(to, code, purpose = 'password_reset') {
    const transporter = getTransporter();
    const from = process.env.MAIL_FROM || `HanXue <${process.env.GMAIL_USER}>`;
    const content = getPasswordCodeContent(purpose);

    await transporter.sendMail({
        from,
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
    });
}

async function sendPasswordResetCode(to, code) {
    return sendPasswordCode(to, code, 'password_reset');
}

async function verifyEmailTransport() {
    const transporter = getTransporter();
    await transporter.verify();
}

module.exports = {
    sendPasswordCode,
    sendPasswordResetCode,
    verifyEmailTransport
};
