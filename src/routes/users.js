/**
 * User routes
 */
const express = require('express');
const router = express.Router();
const userController = require('../controllers/users');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');

// Public routes
router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);
// Allow public access to Clerk ID lookup for admin verification flow
router.get('/clerk/:clerkId', userController.getUserByClerkId);

// Protected routes
router.use(authenticate);

// User profile routes
router.get('/me', userController.getCurrentUser);
router.put('/me', userController.updateUser);

// Route to get user by Clerk ID (kept here for ordering reference)

// Subscription stats route
router.get('/stats/subscriptions', authorize(PERMISSIONS.READ_SUBSCRIPTION_STATS), userController.getSubscriptionStats);

// Bulk operations
router.post('/bulk-update', authorize(PERMISSIONS.BULK_UPDATE_USERS), userController.bulkUpdateUsers);

// User management routes (admin only)
router.get('/', authorize(PERMISSIONS.READ_ALL_USERS), userController.getAllUsers);

// Individual user routes
router.get('/:id', authorize(PERMISSIONS.READ_USER_DETAILS), userController.getUserById);
router.put('/:id', authorize(PERMISSIONS.UPDATE_USER), userController.updateUser);
router.delete('/:id', authorize(PERMISSIONS.DELETE_USER), userController.deleteUser);
router.put('/:id/subscription', authorize(PERMISSIONS.UPDATE_SUBSCRIPTION), userController.updateUserSubscription);

module.exports = router;
