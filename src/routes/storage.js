const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');
const supabase = require('../config/supabase');

// Require auth + content permission (admins have all permissions)
router.use(authenticate);
router.use(authorize(PERMISSIONS.UPDATE_CONTENT));

/**
 * Create a signed upload URL so clients can upload even when storage RLS policies are missing.
 * POST /api/storage/signed-upload { filename, bucket?, folder? }
 */
router.post('/signed-upload', async (req, res) => {
  try {
    const { filename, bucket = 'hero-images', folder = '' } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename required' });

    // Ensure bucket exists/public (best-effort)
    await supabase.storage.createBucket(bucket, { public: true }).catch(() => {});
    await supabase.storage.updateBucket(bucket, { public: true }).catch(() => {});

    const ext = filename.includes('.') ? filename.split('.').pop() : 'bin';
    const baseRaw = filename.replace(new RegExp(`\\.${ext}$`, 'i'), '');
    const baseSanitized =
      baseRaw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'file';

    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cleanFolder = String(folder || '').replace(/^\/+|\/+$/g, '');
    const path = cleanFolder
      ? `${cleanFolder}/${baseSanitized}__${unique}.${ext}`
      : `${baseSanitized}__${unique}.${ext}`;

    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error) throw error;

    return res.json({ bucket, path, token: data?.token, signedUrl: data?.signedUrl });
  } catch (e) {
    console.error('storage signed-upload error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to create signed upload' });
  }
});

module.exports = router;


