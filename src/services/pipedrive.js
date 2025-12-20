/**
 * Minimal Pipedrive API client (API token / private app)
 *
 * Env:
 * - PIPEDRIVE_API_TOKEN (required)
 * - PIPEDRIVE_BASE_URL (optional, default https://api.pipedrive.com/v1)
 */

const DEFAULT_BASE_URL = 'https://api.pipedrive.com/v1';

function getConfig() {
  const apiToken = process.env.PIPEDRIVE_API_TOKEN;
  const baseUrl = process.env.PIPEDRIVE_BASE_URL || DEFAULT_BASE_URL;
  return { apiToken, baseUrl };
}

function buildUrl(path, query = {}, { useApiToken } = {}) {
  const { apiToken, baseUrl } = getConfig();
  const url = new URL(String(path).startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`);
  if (useApiToken) {
    if (!apiToken) throw new Error('Pipedrive not configured: PIPEDRIVE_API_TOKEN is missing');
    url.searchParams.set('api_token', apiToken);
  }
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function pipedriveRequest(method, path, { query, body, accessToken } = {}) {
  const url = buildUrl(path, query, { useApiToken: !accessToken });
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    // ignore
  }

  if (!res.ok) {
    const err = new Error(`Pipedrive API error (${res.status})`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }

  // Pipedrive wraps responses like {success:true,data:...}
  if (json && json.success === false) {
    const err = new Error('Pipedrive API error (success=false)');
    err.status = 400;
    err.body = json;
    throw err;
  }

  return json;
}

async function searchPersons(term, { limit = 10 } = {}) {
  return pipedriveRequest('GET', '/persons/search', {
    query: { term, limit, start: 0 },
  });
}

async function getPerson(personId, { accessToken } = {}) {
  return pipedriveRequest('GET', `/persons/${personId}`, { accessToken });
}

async function getDeal(dealId, { accessToken } = {}) {
  return pipedriveRequest('GET', `/deals/${dealId}`, { accessToken });
}

let cachedSmsActivityTypeKey = null;

async function ensureSmsActivityTypeKey() {
  if (cachedSmsActivityTypeKey) return cachedSmsActivityTypeKey;

  // Allow explicit override
  const override = process.env.PIPEDRIVE_SMS_ACTIVITY_TYPE_KEY;
  if (override) {
    cachedSmsActivityTypeKey = override;
    return cachedSmsActivityTypeKey;
  }

  try {
    const typesResp = await pipedriveRequest('GET', '/activityTypes');
    const types = Array.isArray(typesResp?.data) ? typesResp.data : [];
    const existing = types.find(t => (t?.key || '').toLowerCase() === 'sms' || (t?.name || '').toLowerCase() === 'sms');
    if (existing?.key) {
      cachedSmsActivityTypeKey = existing.key;
      return cachedSmsActivityTypeKey;
    }

    // Create "SMS" activity type if missing. Pipedrive only allows a fixed set of icons; use 'email' as closest.
    const createdResp = await pipedriveRequest('POST', '/activityTypes', {
      body: { name: 'SMS', icon_key: 'email' },
    });
    const created = createdResp?.data;
    if (created?.key) {
      cachedSmsActivityTypeKey = created.key;
      return cachedSmsActivityTypeKey;
    }
  } catch (e) {
    // If activity type creation fails, fallback to a standard type
    console.warn('Failed to ensure SMS activity type; falling back to "task":', e?.message || e);
  }

  cachedSmsActivityTypeKey = 'task';
  return cachedSmsActivityTypeKey;
}

async function createSmsActivity({
  to,
  body,
  userLabel,
  userId, // Pipedrive user ID who sent the SMS
  personId,
  dealId,
  orgId,
  provider,
  providerMessageId,
  accessToken,
}) {
  const type = await ensureSmsActivityTypeKey({ accessToken });
  const subjectPreview = String(body || '').trim().slice(0, 60);

  const noteLines = [
    `SMS sent${provider ? ` via ${provider}` : ''}${providerMessageId ? ` (id: ${providerMessageId})` : ''}`,
    userLabel ? `Sent by: ${userLabel}` : null,
    `To: ${to}`,
    '',
    'Message:',
    String(body || ''),
  ].filter(Boolean);

  // Build activity body - include user_id to assign activity to the correct user
  const activityBody = {
    subject: subjectPreview ? `SMS: ${subjectPreview}` : 'SMS sent',
    type,
    done: 1,
    note: noteLines.join('\n'),
    person_id: personId || undefined,
    deal_id: dealId || undefined,
    org_id: orgId || undefined,
  };

  // Set user_id if provided - this assigns the activity to the correct user in Pipedrive
  if (userId) {
    activityBody.user_id = userId;
    console.log(`📝 Setting activity user_id to: ${userId}`);
  } else {
    console.warn('⚠️  No userId provided - activity will be assigned to default user');
  }

  return pipedriveRequest('POST', '/activities', {
    accessToken,
    body: activityBody,
  });
}

module.exports = {
  searchPersons,
  getPerson,
  getDeal,
  createSmsActivity,
};


