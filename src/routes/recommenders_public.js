const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const crypto = require('crypto');

// Public routes (no auth required, token-based)

// GET /api/recommenders/public/:token - fetch recommender session by token
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data, error } = await supabase
      .from('recommenders')
      .select('id, application_id, email, name, relationship, status, token_expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Invalid or expired token' });
    // Check expiration
    if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Token expired' });
    }
    return res.json({ recommender: data });
  } catch (e) {
    console.error('getRecommenderByToken error:', e);
    return res.status(500).json({ error: 'Failed to load recommender session' });
  }
});

// POST /api/recommenders/public/:token/submit - submit rating + letter
router.post('/:token/submit', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: rec, error: recErr } = await supabase
      .from('recommenders')
      .select('id, status, token_expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (recErr) throw recErr;
    if (!rec) return res.status(404).json({ error: 'Invalid or expired token' });
    if (rec.token_expires_at && new Date(rec.token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Token expired' });
    }
    const { rating, letter_url, letter_type } = req.body || {};
    // Insert artifact
    const { data: artifact, error: artErr } = await supabase
      .from('recommender_artifacts')
      .insert({ recommender_id: rec.id, rating: rating || null, letter_url: letter_url || null, letter_type: letter_type || null })
      .select()
      .single();
    if (artErr) throw artErr;
    // Update recommender status
    await supabase
      .from('recommenders')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', rec.id);
    return res.status(201).json({ artifact, success: true });
  } catch (e) {
    console.error('submitRecommendation error:', e);
    return res.status(500).json({ error: 'Failed to submit recommendation' });
  }
});

module.exports = router;

