const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const ctrl = require('../controllers/representatives');

// Public endpoint: list active representatives for public pages
router.get('/public', ctrl.listRepresentativesPublic);

// Authenticated endpoints for admin CRUD
router.use(authenticate);

router.get('/', ctrl.listRepresentatives); // supports ?include_inactive=true
router.post('/', authorize('manage_ambassadors'), ctrl.createRepresentative);
router.put('/:id', authorize('manage_ambassadors'), ctrl.updateRepresentative);
router.delete('/:id', authorize('manage_ambassadors'), ctrl.deleteRepresentative);

module.exports = router;


