const express = require('express');
const router = express.Router();

const { pipedriveExtensionAuth, optionalPipedriveExtensionAuth } = require('../middleware/pipedriveExtensionAuth');
const { sendSms } = require('../services/notifications');
const pipedrive = require('../services/pipedrive');
const supabase = require('../config/supabase');
const pipedriveOAuth = require('../services/pipedriveOAuth');

function isE164(phone) {
  return typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

// NOTE:
// Do NOT globally require Pipedrive Extension auth on this router.
// - The OAuth callback is a normal browser redirect and will NOT include Authorization headers.
// - The iframe "panel" endpoints DO include an Authorization Bearer token from the Pipedrive Extensions SDK.
// We apply `pipedriveExtensionAuth` only to the endpoints that are called from inside the extension.

// -----------------------
// OAuth status + connect
// -----------------------

router.get('/oauth/status', optionalPipedriveExtensionAuth, async (req, res) => {
  try {
    const companyId =
      (req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null) ||
      (req.query.companyId ? String(req.query.companyId) : null) ||
      (req.query.company_id ? String(req.query.company_id) : null);
    if (!companyId) return res.status(400).json({ error: 'Missing companyId' });
    const conn = await pipedriveOAuth.getCompanyConnection(companyId);
    return res.json({ connected: Boolean(conn) });
  } catch (e) {
    console.error('OAuth status error:', e);
    return res.status(500).json({ error: 'Failed to check status' });
  }
});

router.get('/oauth/authorize', optionalPipedriveExtensionAuth, async (req, res) => {
  try {
    // state can include companyId to help debugging; do not trust it for auth
    const companyId =
      (req.pipedrive?.companyId ? String(req.pipedrive.companyId) : '') ||
      (req.query.companyId ? String(req.query.companyId) : '') ||
      (req.query.company_id ? String(req.query.company_id) : '');
    const state = companyId ? `company:${companyId}` : undefined;
    const url = pipedriveOAuth.buildAuthorizeUrl({ state });
    const wantsJson =
      (req.headers.accept || '').includes('application/json') ||
      req.query.json === '1' ||
      req.query.json === 1;

    // If called from a browser (install/debug), redirect directly to reduce copy/paste mistakes.
    if (!wantsJson) {
      return res.redirect(url);
    }

    return res.json({ url });
  } catch (e) {
    console.error('OAuth authorize url error:', e);
    return res.status(500).json({ error: 'Failed to build authorize url' });
  }
});

// OAuth callback URL should be set in Pipedrive app settings:
//   https://<your-backend>/api/pipedrive/oauth/callback
router.get('/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Missing code');

    // IMPORTANT: OAuth codes are single-use.
    // If we automatically exchange on first page load, users can't "add &json=1" without reusing the code.
    // So we do a two-step flow:
    //  - First visit (no exchange=1): show an HTML page with links to exchange once (redirect vs JSON).
    //  - Second visit (exchange=1): perform the token exchange.
    const exchange = req.query.exchange === '1' || req.query.exchange === 1;
    if (!exchange) {
      // In an Express router, `req.path` is relative to the router mount.
      // Use baseUrl + path so we keep the `/api/pipedrive` prefix.
      const base = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
      const encodedCode = encodeURIComponent(String(code));
      const state = typeof req.query.state === 'string' ? `&state=${encodeURIComponent(req.query.state)}` : '';
      const continueUrl = `${base}?code=${encodedCode}${state}&exchange=1`;
      const debugUrl = `${base}?code=${encodedCode}${state}&exchange=1&json=1`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Pipedrive OAuth</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
      .card { max-width: 720px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; }
      .btn { display: inline-block; padding: 10px 14px; border-radius: 10px; border: 1px solid #111827; text-decoration: none; color: #111827; margin-right: 10px; }
      .muted { color: #6b7280; font-size: 14px; margin-top: 10px; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Finish connecting Pipedrive</h2>
      <p>OAuth codes are <strong>single-use</strong>. Use one of the buttons below (click once).</p>
      <p>
        <a class="btn" href="${continueUrl}">Continue</a>
        <a class="btn" href="${debugUrl}">Debug JSON</a>
      </p>
      <p class="muted">
        Tip: If you refresh the callback URL or open it twice, you will see <code>invalid_grant</code>.
      </p>
    </div>
  </body>
</html>`);
    }

    const tokenResp = await pipedriveOAuth.exchangeCodeForTokens(String(code));
    // Pipedrive may return structured errors (ex: { success:false, error:'invalid_grant', message:'...' })
    if (tokenResp && tokenResp.success === false) {
      const err = new Error(tokenResp.message || 'Pipedrive OAuth token exchange failed');
      err.status = 400;
      err.code = tokenResp.error || null;
      err.body = tokenResp;
      throw err;
    }

    // Fallback: parse companyId from state if present (we set it in /oauth/authorize)
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const stateCompanyId = state.startsWith('company:') ? state.slice('company:'.length) : null;

    // Pipedrive returns api_domain and "company_id" (commonly) along with tokens
    let companyId =
      tokenResp?.company_id ||
      tokenResp?.companyId ||
      tokenResp?.company?.id ||
      stateCompanyId ||
      null;

    // Some Pipedrive flows do NOT include company_id in the token response.
    // In that case, fetch it via API using the access token.
    if (!companyId && tokenResp?.access_token) {
      try {
        companyId = await pipedriveOAuth.fetchCompanyIdFromAccessToken({
          accessToken: tokenResp.access_token,
          apiDomain: tokenResp.api_domain || tokenResp.apiDomain || null,
        });
      } catch (_) {}
    }
    if (!companyId) {
      console.warn('OAuth callback missing company_id in token response:', tokenResp);
      return res.status(400).send('Missing company_id in token response');
    }

    await pipedriveOAuth.upsertCompanyTokens({
      companyId,
      accessToken: tokenResp.access_token,
      refreshToken: tokenResp.refresh_token,
      expiresIn: tokenResp.expires_in,
      apiDomain: tokenResp.api_domain || tokenResp.apiDomain || null,
    });

    // Redirect back to your frontend (or show a success page)
    const frontend = process.env.FRONTEND_URL || 'https://www.pythagoras.com';
    return res.redirect(`${frontend}/pipedrive/sms-panel?connected=1`);
  } catch (e) {
    const status = Number(e?.status) || 500;
    const code = e?.code || null;
    const message = e?.message || 'OAuth failed';
    const body = e?.body || null;
    const meta = e?.meta || null;
    console.error('OAuth callback error:', { status, code, message, body });

    const redact = (val) => {
      if (!val || typeof val !== 'object') return val;
      const copy = Array.isArray(val) ? [...val] : { ...val };
      const keysToRedact = ['access_token', 'refresh_token', 'client_secret'];
      keysToRedact.forEach((k) => {
        if (copy && Object.prototype.hasOwnProperty.call(copy, k)) copy[k] = '[redacted]';
      });
      return copy;
    };

    // If you hit this endpoint in a browser during install, show something actionable.
    // Avoid leaking secrets; only include safe diagnostics.
    const wantsJson =
      (req.headers.accept || '').includes('application/json') ||
      req.query.json === '1' ||
      req.query.json === 1;

    // For json=1 specifically, include sanitized upstream body even in prod,
    // because it usually only contains oauth error codes/descriptions (no secrets).
    const safeDetails =
      process.env.NODE_ENV === 'production'
        ? (wantsJson ? { code, message, status, body: redact(body), meta } : { code, message })
        : { code, message, status, body: redact(body), meta };

    if (wantsJson) {
      // Common failure: code already used/expired. Add an explicit hint.
      const hint =
        body && typeof body === 'object' && body.error === 'invalid_grant'
          ? 'The OAuth code is single-use and expires quickly. Restart the Connect flow to get a fresh code, and do not refresh the callback URL.'
          : undefined;
      return res.status(status).json({ error: 'OAuth failed', ...safeDetails });
    }

    const extra =
      body && typeof body === 'object' && body.error === 'invalid_grant'
        ? '\n\nTip: The OAuth code is single-use and expires quickly. Restart the Connect flow and do not refresh the callback page.'
        : '';
    return res
      .status(status)
      .send(`OAuth failed: ${safeDetails.message}${safeDetails.code ? ` (${safeDetails.code})` : ''}${extra}`);
  }
});

// -----------------------
// Templates (per user)
// -----------------------

// Everything below is meant to be called from inside the Pipedrive extension iframe
// and must be authenticated by the extension-signed JWT.
router.use(pipedriveExtensionAuth);

router.get('/sms/templates', async (req, res) => {
  try {
    const ownerId = req.pipedrive?.userId ? String(req.pipedrive.userId) : null;
    const companyId = req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null;
    if (!ownerId) return res.status(401).json({ error: 'Missing Pipedrive user context' });

    let q = supabase
      .from('sms_templates')
      .select('id, title, body, created_at, updated_at')
      .eq('owner_type', 'pipedrive')
      .eq('owner_id', ownerId)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false });

    if (companyId) q = q.eq('company_id', companyId);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ templates: data || [] });
  } catch (e) {
    console.error('List sms templates error:', e);
    return res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/sms/templates', async (req, res) => {
  try {
    const ownerId = req.pipedrive?.userId ? String(req.pipedrive.userId) : null;
    const companyId = req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null;
    if (!ownerId) return res.status(401).json({ error: 'Missing Pipedrive user context' });

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
    if (title.length > 80) return res.status(400).json({ error: 'title too long (max 80 chars)' });
    if (body.length > 2000) return res.status(400).json({ error: 'body too long (max 2000 chars)' });

    const { data, error } = await supabase
      .from('sms_templates')
      .insert({
        owner_type: 'pipedrive',
        owner_id: ownerId,
        company_id: companyId,
        title,
        body,
      })
      .select('id, title, body, created_at, updated_at')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ template: data });
  } catch (e) {
    console.error('Create sms template error:', e);
    return res.status(500).json({ error: 'Failed to create template' });
  }
});

router.put('/sms/templates/:id', async (req, res) => {
  try {
    const ownerId = req.pipedrive?.userId ? String(req.pipedrive.userId) : null;
    const companyId = req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null;
    if (!ownerId) return res.status(401).json({ error: 'Missing Pipedrive user context' });

    const id = req.params.id;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
    if (title.length > 80) return res.status(400).json({ error: 'title too long (max 80 chars)' });
    if (body.length > 2000) return res.status(400).json({ error: 'body too long (max 2000 chars)' });

    let q = supabase
      .from('sms_templates')
      .update({ title, body })
      .eq('id', id)
      .eq('owner_type', 'pipedrive')
      .eq('owner_id', ownerId)
      .eq('is_deleted', false);
    if (companyId) q = q.eq('company_id', companyId);

    const { data, error } = await q.select('id, title, body, created_at, updated_at').single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ template: data });
  } catch (e) {
    console.error('Update sms template error:', e);
    return res.status(500).json({ error: 'Failed to update template' });
  }
});

router.delete('/sms/templates/:id', async (req, res) => {
  try {
    const ownerId = req.pipedrive?.userId ? String(req.pipedrive.userId) : null;
    const companyId = req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null;
    if (!ownerId) return res.status(401).json({ error: 'Missing Pipedrive user context' });

    const id = req.params.id;
    let q = supabase
      .from('sms_templates')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('owner_type', 'pipedrive')
      .eq('owner_id', ownerId)
      .eq('is_deleted', false);
    if (companyId) q = q.eq('company_id', companyId);

    const { error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    console.error('Delete sms template error:', e);
    return res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Fetch person (for prefilling phone)
router.get('/persons/:id', async (req, res) => {
  try {
    const companyId = req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null;
    const accessToken = companyId ? await pipedriveOAuth.getValidAccessToken(companyId) : null;
    if (!accessToken) return res.status(403).json({ error: 'Pipedrive is not connected (OAuth)' });

    const resp = await pipedrive.getPerson(req.params.id, { accessToken });
    return res.json(resp);
  } catch (e) {
    console.error('Pipedrive proxy get person error:', e?.body || e?.message || e);
    return res.status(500).json({ error: 'Failed to load Pipedrive person' });
  }
});

// Fetch deal (to resolve to person_id if panel is on deals)
router.get('/deals/:id', async (req, res) => {
  try {
    const companyId = req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null;
    const accessToken = companyId ? await pipedriveOAuth.getValidAccessToken(companyId) : null;
    if (!accessToken) return res.status(403).json({ error: 'Pipedrive is not connected (OAuth)' });

    const resp = await pipedrive.getDeal(req.params.id, { accessToken });
    return res.json(resp);
  } catch (e) {
    console.error('Pipedrive proxy get deal error:', e?.body || e?.message || e);
    return res.status(500).json({ error: 'Failed to load Pipedrive deal' });
  }
});

/**
 * POST /api/pipedrive/sms/send
 * Body:
 * - to: string (E.164)
 * - body: string
 * - personId?, dealId?, orgId? (at least one recommended)
 */
router.post('/sms/send', async (req, res) => {
  try {
    const companyId = req.pipedrive?.companyId ? String(req.pipedrive.companyId) : null;
    const accessToken = companyId ? await pipedriveOAuth.getValidAccessToken(companyId) : null;
    if (!accessToken) return res.status(403).json({ error: 'Pipedrive is not connected (OAuth)' });

    const { to, body, personId, dealId, orgId } = req.body || {};
    const trimmedTo = typeof to === 'string' ? to.trim() : '';
    const message = typeof body === 'string' ? body.trim() : '';

    if (!trimmedTo || !message) {
      return res.status(400).json({ error: 'to and body are required' });
    }
    if (!isE164(trimmedTo)) {
      return res.status(400).json({ error: 'Phone number must be in E.164 format (example: +14155552671)' });
    }
    if (message.length > 1600) {
      return res.status(400).json({ error: 'Message too long (max 1600 chars)' });
    }

    const smsResult = await sendSms({ to: trimmedTo, body: message });
    if (!smsResult?.ok) {
      return res.status(502).json({ error: smsResult?.error || 'Failed to send SMS' });
    }

    // Log to Pipedrive (best-effort but we *want* it; if it fails, still return ok for sending)
    let pipedriveActivity = null;
    try {
      // Get user ID from token - this should be the Pipedrive user ID of the person sending the SMS
      const pipedriveUserId = req.pipedrive?.userId ? String(req.pipedrive.userId) : null;
      const tokenPayload = req.pipedrive?.tokenPayload || {};
      
      console.log('📝 Creating Pipedrive activity...');
      console.log('📝 Token userId:', pipedriveUserId);
      console.log('📝 Token payload:', JSON.stringify(tokenPayload, null, 2));
      console.log('📝 Full req.pipedrive:', JSON.stringify(req.pipedrive, null, 2));
      
      // IMPORTANT: Use the userId from the signed token, NOT from the OAuth token
      // The signed token contains the actual user who is using the panel (e.g., Zakarya)
      // The OAuth token belongs to the app owner (e.g., Khaoula) and will always return that user
      // The signed token from Pipedrive SDK is the source of truth for who is currently using the panel
      const verifiedUserId = pipedriveUserId;
      
      if (!verifiedUserId) {
        console.warn('⚠️  No userId found in token - activity may be assigned to wrong user');
      } else {
        console.log('📝 Using userId from signed token for activity:', verifiedUserId);
        console.log('📝 This is the user who is currently using the panel (not the OAuth token owner)');
      }
      
      const activityResp = await pipedrive.createSmsActivity({
        to: trimmedTo,
        body: message,
        userId: verifiedUserId, // Pass userId to assign activity to correct user
        userLabel: verifiedUserId ? `pipedrive_user:${verifiedUserId}` : null,
        personId: personId || null,
        dealId: dealId || null,
        orgId: orgId || null,
        provider: smsResult?.provider || null,
        accessToken,
      });
      pipedriveActivity = activityResp?.data || activityResp || null;
      console.log('✅ Pipedrive activity created:', pipedriveActivity?.id || 'unknown');
      if (pipedriveActivity?.user_id) {
        console.log('✅ Activity assigned to user_id:', pipedriveActivity.user_id);
      }
    } catch (e) {
      console.warn('❌ Failed to create Pipedrive activity (non-fatal):', e?.body || e?.message || e);
      console.warn('❌ Activity error details:', JSON.stringify(e, null, 2));
    }

    return res.json({
      ok: true,
      sms: { provider: smsResult?.provider || null },
      pipedriveActivity,
    });
  } catch (e) {
    console.error('Pipedrive SMS send error:', e);
    return res.status(500).json({ error: 'Failed to send SMS' });
  }
});

module.exports = router;


