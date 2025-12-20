const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');
const ctrl = require('../controllers/schools');

router.use(authenticate);

// List/create before dynamic :id
router.get('/', ctrl.listSchools);
router.post('/', ctrl.createSchool);

// Specific "me" routes MUST come before any ":id" routes
router.get('/me/managed', ctrl.listMyManagedSchools);
router.get('/me/applications', ctrl.listMyApplications);

// ID-based routes
router.get('/:id', ctrl.getSchool);
router.put('/:id', ctrl.updateSchool);
router.delete('/:id', ctrl.deleteSchool);

// Process configuration by country and student progress
router.get('/:id/process', ctrl.getProcessConfig);
router.put('/:id/process', authorize(PERMISSIONS.MANAGE_SCHOOL_PROFILE), ctrl.upsertProcessConfig);
router.get('/:id/process/progress', ctrl.getStudentProcessProgress);
router.put('/:id/process/progress', ctrl.upsertStudentProcessProgress);

// Managers
router.get('/:id/managers', ctrl.listSchoolManagers);
router.post('/:id/managers', ctrl.addSchoolManager);
router.delete('/:id/managers/:userId', ctrl.removeSchoolManager);

// School application form (manager can upsert)
router.get('/:id/form', ctrl.getSchoolForm);
router.get('/:id/forms/active', ctrl.getActiveSchoolForm);
// Allow school managers or admins via controller-level check
router.put('/:id/form', ctrl.upsertSchoolForm);

// Student applications for a school
router.post('/:id/applications', ctrl.submitApplicationToSchool);
router.post('/:id/track', ctrl.trackNewApplication);
router.get('/:id/applications', ctrl.listSchoolApplications);

// Application payments (MUST come before general /applications/:applicationId route)
router.post('/applications/:applicationId/payment/session', ctrl.createApplicationPaymentSession);
router.get('/applications/:applicationId/payment/status', ctrl.getApplicationPaymentStatus);
router.post('/applications/:applicationId/payment/waive', ctrl.waiveApplicationFee);

// Application recommenders (MUST come before general /applications/:applicationId route)
router.get('/applications/:applicationId/recommenders', ctrl.listApplicationRecommenders);
router.post('/applications/:applicationId/recommenders', ctrl.inviteRecommender);

// Application documents (MUST come before general /applications/:applicationId route)
router.get('/applications/:applicationId/documents', ctrl.listApplicationDocuments);
router.post('/applications/:applicationId/documents', ctrl.addApplicationDocument);
router.delete('/applications/documents/:documentId', ctrl.deleteApplicationDocument);

// General application route (MUST come last to avoid conflicts)
router.patch('/applications/:applicationId', ctrl.updateApplication);

// Media (gallery) - controller checks manager/admin access
router.get('/:id/media', ctrl.listSchoolMedia);
router.post('/:id/media', ctrl.addSchoolMedia);
router.delete('/media/:mediaId', ctrl.deleteSchoolMedia);

// Living Costs - controller checks manager/admin
router.get('/:id/living-costs', ctrl.listSchoolLivingCosts);
router.post('/:id/living-costs', ctrl.addSchoolLivingCost);
router.delete('/living-costs/:livingCostId', ctrl.deleteSchoolLivingCost);

// Scholarships - controller checks manager/admin
router.get('/:id/scholarships', ctrl.listSchoolScholarships);
router.post('/:id/scholarships', ctrl.addSchoolScholarship);
router.delete('/scholarships/:scholarshipId', ctrl.deleteSchoolScholarship);

// School Resources (Successful Applications / Entrance Exams) - controller checks manager/admin
router.get('/:id/resources', ctrl.listSchoolResources);
router.post('/:id/resources', ctrl.addSchoolResource);
router.put('/resources/:resourceId', ctrl.updateSchoolResource);
router.delete('/resources/:resourceId', ctrl.deleteSchoolResource);


module.exports = router;


