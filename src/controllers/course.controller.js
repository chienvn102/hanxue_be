const Course = require('../models/course.model');
const db = require('../config/database');

function validateHskLevel(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1 || n > 6) return 'hsk_level phải là số 1-6';
    return null;
}

// Get all courses (public/private)
exports.getCourses = async (req, res) => {
    try {
        const userId = req.user ? req.user.userId : null;
        const courses = await Course.findAll(userId);

        // Add locked status logic here if needed based on prerequisite
        // For now, return list
        res.json({
            success: true,
            data: courses
        });
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get single course details
exports.getCourse = async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        res.json({ success: true, data: course });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Create Course
exports.createCourse = async (req, res) => {
    try {
        const { hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index } = req.body;

        if (!hsk_level || !title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ success: false, message: 'Thiếu title hoặc hsk_level' });
        }
        const hskErr = validateHskLevel(hsk_level);
        if (hskErr) return res.status(400).json({ success: false, message: hskErr });

        const id = await Course.create({
            hsk_level, title, description, thumbnail_url, prerequisite_course_id, order_index
        });

        res.status(201).json({ success: true, data: { id, ...req.body } });
    } catch (error) {
        console.error('Create course error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + (error.message || error.sqlMessage || 'Unknown error')
        });
    }
};

// Admin: Update Course
exports.updateCourse = async (req, res) => {
    try {
        if (req.body.hsk_level !== undefined) {
            const hskErr = validateHskLevel(req.body.hsk_level);
            if (hskErr) return res.status(400).json({ success: false, message: hskErr });
        }
        const affected = await Course.update(req.params.id, req.body);
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Course not found or no changes' });
        }
        res.json({ success: true, message: 'Course updated' });
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Delete (Soft Delete) — block khi còn lesson đang active
exports.deleteCourse = async (req, res) => {
    try {
        const [[row]] = await db.execute(
            'SELECT COUNT(*) AS cnt FROM lessons WHERE course_id = ? AND is_active = TRUE',
            [req.params.id]
        );
        const lessonCount = row?.cnt || 0;
        if (lessonCount > 0) {
            return res.status(409).json({
                success: false,
                code: 'COURSE_HAS_LESSONS',
                message: `Khóa học còn ${lessonCount} bài học đang hoạt động. Hãy xóa hoặc ẩn các bài học trước.`,
            });
        }
        await Course.delete(req.params.id);
        res.json({ success: true, message: 'Course deleted' });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
