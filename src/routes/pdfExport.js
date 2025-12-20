const express = require('express');
const router = express.Router();

/**
 * PDF export routes
 *
 * This file previously exported an empty object (because it was empty),
 * which caused Express to crash at app.use('/api/pdf-export', pdfExportRoutes).
 *
 * Replace these stubs with real PDF export endpoints when ready.
 */

router.get('/', (_req, res) => {
  return res.status(501).json({
    error: 'PDF export API is not implemented yet',
  });
});

module.exports = router;

