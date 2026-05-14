require('dotenv').config();

const { verifyEmailTransport } = require('../src/services/email.service');

verifyEmailTransport()
    .then((result) => {
        console.log(result?.message || 'Email transport verified');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Email transport verification failed:', err.message);
        process.exit(1);
    });
