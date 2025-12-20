/**
 * File upload routes
 * Handles file uploads to Supabase storage using service role
 */
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Initialize Supabase client with service role
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// Configure multer for memory storage - images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Configure multer for attachments (images + common docs)
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/markdown',
      'application/json',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow'
    ];
    if (allowed.some(prefix => file.mimetype.startsWith(prefix) || file.mimetype === prefix)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type for attachments'), false);
    }
  },
});

/**
 * Upload image to Supabase storage
 * POST /api/upload/image
 */
router.post('/image', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file provided'
      });
    }

    const { bucket = 'images', folder = '' } = req.body;
    
    // Validate bucket name
    const allowedBuckets = ['school-media', 'images', 'program-images', 'hero-images', 'chat-attachments', 'school-rich', 'school-success-apps', 'school-entrance-exams', 'program-rich'];
    if (!allowedBuckets.includes(bucket)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid bucket name'
      });
    }

    // Ensure bucket exists and is public
    try {
      await supabase.storage.createBucket(bucket, { public: true });
    } catch (e) {
      // ignore if exists
    }

    // Generate unique filename
    const fileExt = req.file.originalname.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    // Upload to Supabase storage using service role
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Storage upload error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to upload file to storage',
        error: error.message
      });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    res.json({
      status: 'success',
      data: {
        url: urlData.publicUrl,
        path: filePath,
        bucket: bucket
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * Upload attachment (image or document) to Supabase storage
 * POST /api/upload/file
 */
// Allow public uploads for translation documents (no auth)
router.post('/file', attachmentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file provided'
      });
    }

    const { bucket = 'chat-attachments', folder = '' } = req.body;

    const allowedBuckets = ['chat-attachments', 'images', 'school-success-apps', 'school-entrance-exams', 'program-rich'];
    if (!allowedBuckets.includes(bucket)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid bucket name'
      });
    }

    // Ensure bucket exists and is public
    try {
      await supabase.storage.createBucket(bucket, { public: true });
    } catch (e) {
      if (!/exists/i.test(e?.message || '')) {
        console.warn('Bucket create error:', e?.message || e);
      }
    }
    try {
      await supabase.storage.updateBucket(bucket, { public: true });
    } catch (e) {
      if (!/No changes/i.test(e?.message || '')) {
        console.warn('Bucket update error:', e?.message || e);
      }
    }

    // Generate unique filename
    const fileExt = req.file.originalname.includes('.') ? req.file.originalname.split('.').pop() : '';
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const baseName = safeName.replace(/\.[^.]+$/, '');
    const fileName = `${baseName}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${fileExt ? '.' + fileExt : ''}`;
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Storage upload error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to upload file to storage',
        error: error.message
      });
    }

    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    res.json({
      status: 'success',
      data: {
        url: urlData.publicUrl,
        path: filePath,
        bucket,
        type: req.file.mimetype,
        name: req.file.originalname,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('Attachment upload error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * Delete image from Supabase storage
 * DELETE /api/upload/image
 */
router.delete('/image', authenticate, async (req, res) => {
  try {
    const { path, bucket = 'images' } = req.body;
    
    if (!path) {
      return res.status(400).json({
        status: 'error',
        message: 'No file path provided'
      });
    }

    // Validate bucket name
    const allowedBuckets = ['school-media', 'images', 'program-images', 'hero-images', 'chat-attachments'];
    if (!allowedBuckets.includes(bucket)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid bucket name'
      });
    }

    // Extract file path from URL if needed
    const filePath = path.includes('/')
      ? path.split('/').slice(-2).join('/')
      : path;

    // Delete from Supabase storage using service role
    const { data, error } = await supabase.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      console.error('Storage delete error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to delete file from storage',
        error: error.message
      });
    }

    res.json({
      status: 'success',
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
