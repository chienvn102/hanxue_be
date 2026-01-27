const Course = require('../models/course.model');

// Get all courses (public/private)
exports.getCourses = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;
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

        if (!hsk_level || !title) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

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
        const affected = await Course.update(req.params.id, req.body);
        if (affected === 0) {
            return res.status(404).json({ success: false, message: 'Course not found or no changes' });
        }
        res.json({ success: true, message: 'Course updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin: Delete (Soft Delete)
exports.deleteCourse = async (req, res) => {
    try {
        await Course.delete(req.params.id);
        res.json({ success: true, message: 'Course deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
