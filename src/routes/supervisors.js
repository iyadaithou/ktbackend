const express = require('express');
const router = express.Router();

// Keep this route from crashing the whole server.
// This file previously exported `{}` (empty module), which breaks `app.use('/api/supervisors', ...)`.
//
// If/when supervisor features are implemented, replace these stubs with real handlers.
let authenticate = null;
try {
  ({ authenticate } = require('../middleware/auth'));
} catch (e) {
  // If auth can't load (e.g., env missing), still export a valid router.
  authenticate = null;
}

if (typeof authenticate === 'function') {
  router.use(authenticate);
}

router.get('/', (_req, res) => {
  return res.status(501).json({
    error: 'Supervisors API is not implemented yet',
  });
});

module.exports = router;

