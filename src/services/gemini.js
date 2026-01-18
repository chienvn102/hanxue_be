/**
 * Gemini AI Service
 * Generate example sentences for vocabulary
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate example sentences for a Chinese word
 * @param {string} simplified - Chinese word
 * @param {string} pinyin - Pinyin
 * @param {string} meaningVi - Vietnamese meaning
 * @returns {Promise<Array>} - Array of {zh, vi} examples
 */
async function generateExamples(simplified, pinyin, meaningVi) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Tạo 3 câu ví dụ đơn giản cho từ tiếng Trung "${simplified}" (${pinyin}).
Nghĩa: ${meaningVi || 'không rõ'}

Yêu cầu:
- Mỗi câu ngắn gọn, dễ hiểu (HSK 1-4)
- Trả về JSON array

Format output (CHỈ JSON, không có text khác):
[
  {"zh": "câu tiếng Trung 1", "vi": "dịch tiếng Việt 1"},
  {"zh": "câu tiếng Trung 2", "vi": "dịch tiếng Việt 2"},
  {"zh": "câu tiếng Trung 3", "vi": "dịch tiếng Việt 3"}
]`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // Parse JSON from response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const examples = JSON.parse(jsonMatch[0]);
            return examples;
        }

        return [];
    } catch (error) {
        console.error('Gemini generate error:', error.message);
        return [];
    }
}

module.exports = {
    generateExamples
};
