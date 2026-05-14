require('dotenv').config();

const { verifyEmailTransport } = require('../src/services/email.service');

verifyEmailTransport()
    .then(() => {
        console.log('Email transport verified');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Email transport verification failed:', err.message);
        process.exit(1);
    });
