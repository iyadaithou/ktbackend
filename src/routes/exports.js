const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/exports');

router.use(authenticate);

// School-specific exports
router.get('/schools/:schoolId/applications.csv', ctrl.exportApplicationsCSV);
router.get('/schools/:schoolId/applications.xlsx', ctrl.exportApplicationsXLSX);

// Admin exports (all applications)
router.get('/applications.csv', ctrl.exportAllApplications);
router.get('/applications.xlsx', ctrl.exportAllApplications);

module.exports = router;

