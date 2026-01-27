require('dotenv').config();
const db = require('./src/config/database');

async function listUsers() {
    try {
        const [rows] = await db.execute('SELECT id, email, display_name, role, is_active FROM users');
        console.log('--- DANH SÁCH TÀI KHOẢN ---');
        if (rows.length === 0) {
            console.log('Chưa có tài khoản nào.');
        } else {
            console.table(rows);
        }
        process.exit(0);
    } catch (err) {
        console.error('Lỗi:', err.message);
        process.exit(1);
    }
}

listUsers();
