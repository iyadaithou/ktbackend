const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');

// Minimal Gmail OAuth placeholders (we will integrate real OAuth later)

router.use(authenticate);

// Start connect: record intent and return a placeholder URL
router.get('/gmail/connect', async (req, res) => {
  try {
    // In a real flow, generate Google OAuth URL with scopes
    const url = `${process.env.FRONTEND_URL || 'https://www.pythagoras.com'}/oauth/google?state=todo`;
    return res.json({ url });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to start Gmail connect' });
  }
});

// OAuth callback (temporary: accept tokens posted by the frontend)
router.post('/gmail/callback', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { email_address, access_token, refresh_token, token_expiry, scopes } = req.body || {};
    if (!email_address || !refresh_token) {
      return res.status(400).json({ error: 'email_address and refresh_token are required' });
    }

    const upsert = await supabase
      .from('email_accounts')
      .upsert({
        user_id: userId,
        provider: 'gmail',
        email_address,
        oauth_provider: 'google',
        access_token: access_token || null,
        refresh_token,
        token_expiry: token_expiry || null,
        scopes: Array.isArray(scopes) ? scopes : ['gmail.send']
      })
      .select()
      .single();
    if (upsert.error) return res.status(400).json({ error: upsert.error.message });
    return res.json({ account: upsert.data });
  } catch (e) {
    console.error('gmail/callback error:', e);
    return res.status(500).json({ error: 'Failed to save Gmail account' });
  }
});

// Status of current user's connection
router.get('/gmail/status', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { data, error } = await supabase
      .from('email_accounts')
      .select('id, email_address, provider, updated_at')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ account: data || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load status' });
  }
});

module.exports = router;







