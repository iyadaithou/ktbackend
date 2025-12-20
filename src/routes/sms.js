const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { sendSms } = require('../services/notifications');
const pipedrive = require('../services/pipedrive');

function isE164(phone) {
  // Loose E.164: + and 8-15 digits (country-dependent)
  return typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

router.use(authenticate);

/**
 * POST /api/sms/send
 * Body:
 * - to: string (E.164, e.g. +14155552671)
 * - body: string
 * - pipedrive: { personId?, dealId?, orgId? } (optional)
 */
router.post('/send', authorize('send:sms'), async (req, res) => {
  try {
    const { to, body, pipedrive: pd } = req.body || {};
    const trimmedTo = typeof to === 'string' ? to.trim() : '';
    const message = typeof body === 'string' ? body.trim() : '';

    if (!trimmedTo || !message) {
      return res.status(400).json({ error: 'to and body are required' });
    }
    if (!isE164(trimmedTo)) {
      return res.status(400).json({
        error: 'Phone number must be in E.164 format (example: +14155552671)',
      });
    }
    if (message.length > 1600) {
      return res.status(400).json({ error: 'Message too long (max 1600 chars)' });
    }

    const smsResult = await sendSms({ to: trimmedTo, body: message });
    if (!smsResult?.ok) {
      return res.status(502).json({ error: smsResult?.error || 'Failed to send SMS' });
    }

    // Log to Pipedrive activity (best-effort)
    let pipedriveActivity = null;
    try {
      const personId = pd?.personId || pd?.person_id || null;
      const dealId = pd?.dealId || pd?.deal_id || null;
      const orgId = pd?.orgId || pd?.org_id || null;

      // require at least one linkage to show up in CRM in a useful place
      if (personId || dealId || orgId) {
        const userLabel = req.user?.email || req.user?.id || null;
        const activityResp = await pipedrive.createSmsActivity({
          to: trimmedTo,
          body: message,
          userLabel,
          personId,
          dealId,
          orgId,
          provider: smsResult?.provider || null,
        });
        pipedriveActivity = activityResp?.data || activityResp || null;
      }
    } catch (e) {
      console.warn('Pipedrive activity logging failed (non-fatal):', e?.message || e);
    }

    return res.json({
      ok: true,
      sms: { provider: smsResult?.provider || null },
      pipedriveActivity,
    });
  } catch (e) {
    console.error('SMS send error:', e);
    return res.status(500).json({ error: 'Failed to send SMS' });
  }
});

/**
 * GET /api/sms/pipedrive/persons/search?term=...
 * Convenience proxy for the frontend (keeps token server-side).
 */
router.get('/pipedrive/persons/search', authorize('send:sms'), async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!term) return res.status(400).json({ error: 'term is required' });
    const resp = await pipedrive.searchPersons(term, { limit: 10 });
    return res.json(resp);
  } catch (e) {
    console.error('Pipedrive search error:', e?.body || e?.message || e);
    return res.status(500).json({ error: 'Failed to search Pipedrive persons' });
  }
});

router.get('/pipedrive/persons/:id', authorize('send:sms'), async (req, res) => {
  try {
    const id = req.params.id;
    const resp = await pipedrive.getPerson(id);
    return res.json(resp);
  } catch (e) {
    console.error('Pipedrive get person error:', e?.body || e?.message || e);
    return res.status(500).json({ error: 'Failed to load Pipedrive person' });
  }
});

module.exports = router;


