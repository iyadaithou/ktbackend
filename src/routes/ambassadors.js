const express = require('express');
console.log('Ambassadors routes: build marker v1 at', new Date().toISOString());
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const ctrl = require('../controllers/ambassadors');

router.use(authenticate);

router.get('/', ctrl.listAmbassadors);
router.post('/', authorize('manage_ambassadors'), ctrl.createAmbassador);
router.put('/:id', authorize('manage_ambassadors'), ctrl.updateAmbassador);
router.delete('/:id', authorize('manage_ambassadors'), ctrl.deleteAmbassador);

// Representatives moved to /api/representatives

// Tasks (admin)
router.get('/tasks', ctrl.listTasks);
router.post('/tasks', authorize('manage_ambassadors'), ctrl.createTask);
router.put('/tasks/:id', authorize('manage_ambassadors'), ctrl.updateTask);
router.delete('/tasks/:id', authorize('manage_ambassadors'), ctrl.deleteTask);

// Submissions
router.get('/submissions', ctrl.listSubmissions);
// Guard: avoid init-time crash if handler is undefined in older deployments
if (typeof ctrl.createSubmission === 'function') {
  router.post('/submissions', ctrl.createSubmission);
} else {
  console.warn('Ambassadors route: createSubmission handler is undefined; route will not be registered');
}
router.put('/submissions/:id/status', authorize('manage_ambassadors'), ctrl.updateSubmissionStatus);

// Points ledger
router.get('/users/:user_id/ledger', authorize('manage_ambassadors'), ctrl.listUserLedger);
router.get('/me/points', ctrl.getMyPoints);
router.post('/ledger', authorize('manage_ambassadors'), ctrl.createLedgerEntry);

// Rewards catalog
router.get('/rewards', ctrl.listRewards);
router.post('/rewards', authorize('manage_ambassadors'), ctrl.createReward);
router.put('/rewards/:id', authorize('manage_ambassadors'), ctrl.updateReward);
router.delete('/rewards/:id', authorize('manage_ambassadors'), ctrl.deleteReward);

// Perks catalog
router.get('/perks', ctrl.listPerks);
router.post('/perks', authorize('manage_ambassadors'), ctrl.createPerk);
router.put('/perks/:id', authorize('manage_ambassadors'), ctrl.updatePerk);
router.delete('/perks/:id', authorize('manage_ambassadors'), ctrl.deletePerk);

// Claims
router.get('/claims', authorize('manage_ambassadors'), ctrl.listClaims);
router.post('/claims', authorize('manage_ambassadors'), ctrl.createClaim);
router.put('/claims/:id/status', authorize('manage_ambassadors'), ctrl.updateClaimStatus);

// Resources
router.get('/resources', ctrl.listResources);
router.post('/resources', authorize('manage_ambassadors'), ctrl.createResource);
router.put('/resources/:id', authorize('manage_ambassadors'), ctrl.updateResource);
router.delete('/resources/:id', authorize('manage_ambassadors'), ctrl.deleteResource);

// Resource uploads (signed URLs)
router.post('/resources/upload-url', authorize('manage_ambassadors'), ctrl.createResourceUploadUrl);

module.exports = router;


