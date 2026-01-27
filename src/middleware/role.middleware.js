/**
 * Middleware to check user role
 * @param {Array} roles - List of allowed roles
 */
module.exports = (roles = []) => {
    return (req, res, next) => {
        // req.user is set by auth middleware (or req.admin by admin middleware)
        const user = req.user || req.admin;

        if (!user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Should also check if role exists on user object
        if (!roles.includes(user.role)) {
            // Special case: 'super_admin' implies access to everything? 
            // Or just explicit listing. For now assume explicit.

            // Allow if user is admin and we are checking for 'admin' role?
            // Current user model has 'role' field.

            // If checking for 'admin' but user has 'super_admin', usually that's allowed.
            if (roles.includes('admin') && (user.role === 'super_admin' || user.role === 'editor')) {
                // If we asked for 'admin' generic role, let's assume super_admin/editor counts?
                // But the route definition used: roleMiddleware(['admin'])
                // And admin table has: 'super_admin', 'editor'.
                // Regular users have: 'user', 'admin' (maybe?). Let's check User model roles.
                // User model says: role DEFAULT 'user'.
                // So if I'm using this for Admin routes, I should probably check specific roles.

                // For simplicity in this project:
                // If req.admin is present (from admin.middleware), they are an admin.
                if (req.admin && req.admin.isAdmin) {
                    return next();
                }
            }

            return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
        }

        next();
    };
};
