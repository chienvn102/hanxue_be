const nodemailer = require('nodemailer');

let cachedTransporter = null;

function getTransporter() {
    if (cachedTransporter) {
        return cachedTransporter;
    }

    const user = process.env.GMAIL_USER;
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    const appPassword = process.env.GMAIL_APP_PASSWORD;

    if (!user) {
        throw new Error('GMAIL_USER is not configured');
    }

    if (clientId && clientSecret && refreshToken) {
        cachedTransporter = nodemailer.createTransport({
            service: 'gmail',
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
            service: 'gmail',
            auth: {
                user,
                pass: appPassword
            }
        });
        return cachedTransporter;
    }

    throw new Error('Gmail OAuth2 or app password credentials are not configured');
}

async function sendPasswordResetCode(to, code) {
    const transporter = getTransporter();
    const from = process.env.MAIL_FROM || `HanXue <${process.env.GMAIL_USER}>`;

    await transporter.sendMail({
        from,
        to,
        subject: 'HanXue password reset code',
        text: [
            'Your HanXue password reset code is:',
            '',
            code,
            '',
            'This code expires in 10 minutes. If you did not request it, ignore this email.'
        ].join('\n'),
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                <p>Your HanXue password reset code is:</p>
                <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
                <p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>
            </div>
        `
    });
}

module.exports = {
    sendPasswordResetCode
};
