/**
 * Authorization middleware
 */
const { hasPermission } = require('../utils/roles');

/**
 * Authorize based on permission
 * @param {string} requiredPermission - Required permission
 * @returns {Function} Express middleware
 */
const authorize = (requiredPermission) => {
  return (req, res, next) => {
    // Skip if no required permission
    if (!requiredPermission) {
      return next();
    }

    // Check if user is present
    if (!req.user) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized: missing user'
      });
    }

    // System role permissions
    if (req.user.role && hasPermission(req.user.role, requiredPermission)) {
      return next();
    }

    // Custom roles aggregated permissions (set in auth middleware)
    const customPerms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (customPerms.includes(requiredPermission)) {
      return next();
    }

    return res.status(403).json({
      status: 'error',
      message: `Unauthorized: requires ${requiredPermission} permission`
    });
  };
};

module.exports = {
  authorize
}; 