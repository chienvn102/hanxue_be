const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/admin.model');
const db = require('../config/database');

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        const admin = await Admin.findByUsername(username);
        if (!admin) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, admin.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Create admin-specific token
        const token = jwt.sign(
            { id: admin.id, role: admin.role, isAdmin: true },
            process.env.JWT_SECRET,
            { expiresIn: '12h' } // Longer session for admins
        );

        res.json({
            success: true,
            token,
            admin: {
                id: admin.id,
                username: admin.username,
                role: admin.role
            }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getMe = async (req, res) => {
    try {
        // req.admin is set by adminMiddleware
        const admin = await Admin.findById(req.admin.id);
        if (!admin) return res.status(404).json({ message: 'Admin not found' });

        res.json({ success: true, admin });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getStats = async (req, res) => {
    try {
        const [[users], [courses], [lessons], [vocab], [grammar], [exams]] = await Promise.all([
            db.execute('SELECT COUNT(*) as count FROM users'),
            db.execute('SELECT COUNT(*) as count FROM courses'),
            db.execute('SELECT COUNT(*) as count FROM lessons'),
            db.execute('SELECT COUNT(*) as count FROM vocabulary'),
            db.execute('SELECT COUNT(*) as count FROM grammar_patterns'),
            db.execute('SELECT COUNT(*) as count FROM hsk_exams'),
        ]);

        res.json({
            success: true,
            data: {
                userCount: users[0].count,
                courseCount: courses[0].count,
                lessonCount: lessons[0].count,
                vocabCount: vocab[0].count,
                grammarCount: grammar[0].count,
                examCount: exams[0].count,
            }
        });
    } catch (error) {
        console.error('Get admin stats error:', error);
        res.status(500).json({ message: 'Failed to get stats' });
    }
};
