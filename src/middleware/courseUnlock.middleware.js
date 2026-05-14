const Course = require('../models/course.model');
const Lesson = require('../models/lesson.model');

function lockedResponse(res, progress) {
    const total = Number(progress.total_lessons || 0);
    const completed = Number(progress.completed_lessons || 0);
    const needed = Math.max(0, total - completed);

    return res.status(403).json({
        success: false,
        code: 'COURSE_LOCKED',
        message: `Hoan thanh khoa "${progress.prerequisite_title || 'truoc do'}" truoc.`,
        data: {
            prerequisiteId: progress.course_id,
            totalLessons: total,
            completedLessons: completed,
            needed,
        },
    });
}

async function assertCourseUnlocked(req, res, next, courseId) {
    try {
        // User JWT payload có role 'user'|'admin' (xem auth.controller.js).
        // Admin-token routes dùng adminMiddleware riêng (set req.admin),
        // còn ở đây ta đứng sau authMiddleware nên check qua req.user.role.
        if (req.user?.role === 'admin' || req.admin) return next();

        const userId = req.user?.userId;
        if (!userId) {
            const course = await Course.findById(courseId);
            if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
            if (!course.prerequisite_course_id) {
                req.courseUnlock = { unlocked: true, course, prerequisiteProgress: null };
                return next();
            }
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const result = await Course.getUnlockStatus(userId, courseId);
        if (!result.course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        if (!result.unlocked) {
            return lockedResponse(res, result.prerequisiteProgress);
        }

        req.courseUnlock = result;
        next();
    } catch (error) {
        console.error('Course unlock check failed:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function checkCourseUnlocked(req, res, next) {
    const courseId = req.params.courseId || req.params.id || req.query.course;
    if (!courseId) return next();
    return assertCourseUnlocked(req, res, next, courseId);
}

async function checkLessonCourseUnlocked(req, res, next) {
    try {
        const lesson = await Lesson.findById(req.params.id);
        if (!lesson) return next();
        req.lessonForUnlock = lesson;
        return assertCourseUnlocked(req, res, next, lesson.course_id);
    } catch (error) {
        console.error('Lesson unlock check failed:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = {
    checkCourseUnlocked,
    checkLessonCourseUnlocked,
};
