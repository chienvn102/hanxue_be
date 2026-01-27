require('dotenv').config();
const db = require('./src/config/database');

async function updateSchema() {
    try {
        console.log('🔄 Starting database update for Module 2a...');

        // 1. Add columns to users table
        console.log('1. Checking and updating users table...');
        const [columns] = await db.execute('SHOW COLUMNS FROM users');
        const existingColumns = columns.map(c => c.Field);

        const newColumns = [
            { name: 'native_language', type: "VARCHAR(10) DEFAULT 'vn'" },
            { name: 'total_study_days', type: "INT DEFAULT 0" },
            { name: 'longest_streak', type: "INT DEFAULT 0" },
            { name: 'last_study_date', type: "DATE" }
        ];

        for (const col of newColumns) {
            if (!existingColumns.includes(col.name)) {
                await db.execute(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
                console.log(`   ✅ Added column: ${col.name}`);
            } else {
                console.log(`   ℹ️ Column ${col.name} already exists.`);
            }
        }

        // 2. Create user_lesson_progress table
        console.log('\n2. Creating user_lesson_progress table...');
        await db.execute(`
            CREATE TABLE IF NOT EXISTS user_lesson_progress (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                lesson_id INT NOT NULL,
                status ENUM('not_started', 'in_progress', 'completed') DEFAULT 'not_started',
                score_percentage DECIMAL(5,2),
                completed_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user (user_id),
                INDEX idx_user_lesson (user_id, lesson_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('   ✅ Table user_lesson_progress ensures exists.');

        console.log('\n🎉 Database update completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error updating database:', err);
        process.exit(1);
    }
}

updateSchema();
