require('dotenv').config();
const db = require('./src/config/database');

async function checkSchema() {
    try {
        console.log('Checking USERS table...');
        const [usersColumns] = await db.execute('DESCRIBE users');
        console.table(usersColumns);

        console.log('\nChecking USER_LESSON_PROGRESS table...');
        try {
            const [progressColumns] = await db.execute('DESCRIBE user_lesson_progress');
            console.table(progressColumns);
        } catch (e) {
            console.log('user_lesson_progress table does not exist or error:', e.message);
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkSchema();
