/**
 * Role management routes
 */
const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roles');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');

// All routes require authentication
router.use(authenticate);

// Get all system roles
router.get('/system', authorize(PERMISSIONS.READ_USER), roleController.getSystemRoles);

// Get all permissions
router.get('/permissions', authorize(PERMISSIONS.READ_USER), roleController.getPermissions);

// Get permissions for a specific role
router.get('/system/:role/permissions', authorize(PERMISSIONS.READ_USER), roleController.getRolePermissions);

// Custom roles management (admin only)
router.get('/custom', authorize(PERMISSIONS.MANAGE_ROLES), roleController.getCustomRoles);
router.post('/custom', authorize(PERMISSIONS.MANAGE_ROLES), roleController.createCustomRole);
router.put('/custom/:id', authorize(PERMISSIONS.MANAGE_ROLES), roleController.updateCustomRole);
router.delete('/custom/:id', authorize(PERMISSIONS.MANAGE_ROLES), roleController.deleteCustomRole);

// User role assignments
router.post('/assign', authorize(PERMISSIONS.MANAGE_ROLES), roleController.assignCustomRoleToUser);
router.delete('/user/:userId/role/:roleId', authorize(PERMISSIONS.MANAGE_ROLES), roleController.removeCustomRoleFromUser);
router.get('/user/:userId', authorize(PERMISSIONS.READ_USER), roleController.getUserCustomRoles);

module.exports = router; 