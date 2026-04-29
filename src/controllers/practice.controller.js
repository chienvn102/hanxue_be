/**
 * Practice Controller
 * Handles practice text endpoints
 * - GET /api/practice/text?level=1 - Get practice text by HSK level
 */

const practiceTexts = require('../config/practiceTexts');

async function getPracticeText(req, res) {
    try {
        const userId = req.user.userId;
        const level = parseInt(req.query.level) || 1;
        const generateExamples = req.query.examples === 'true';

        console.log(`[practice] Get text: userId=${userId}, level=${level}, examples=${generateExamples}`);

        const text = await practiceTexts.getPracticeText(level, generateExamples);

        return res.json({
            success: true,
            data: text
        });
    } catch (error) {
        console.error('Get practice text error:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi lấy văn bản luyện tập'
        });
    }
}

module.exports = {
    getPracticeText
};