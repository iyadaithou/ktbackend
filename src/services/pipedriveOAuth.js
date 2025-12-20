/**
 * Pipedrive OAuth helper
 *
 * This module exists so `/api/pipedrive/*` routes can load without crashing.
 * It implements a minimal OAuth flow and token persistence via Supabase.
 *
 * Env (required for actual OAuth):
 * - PIPEDRIVE_OAUTH_CLIENT_ID
 * - PIPEDRIVE_OAUTH_CLIENT_SECRET
 * - PIPEDRIVE_OAUTH_REDIRECT_URI
 *
 * Optional:
 * - PIPEDRIVE_OAUTH_AUTHORIZE_URL (default https://oauth.pipedrive.com/oauth/authorize)
 * - PIPEDRIVE_OAUTH_TOKEN_URL (default https://oauth.pipedrive.com/oauth/token)
 * - PIPEDRIVE_OAUTH_TABLE (default pipedrive_oauth_connections)
 */

const supabase = require('../config/supabase');

const AUTHORIZE_URL = process.env.PIPEDRIVE_OAUTH_AUTHORIZE_URL || 'https://oauth.pipedrive.com/oauth/authorize';
const TOKEN_URL = process.env.PIPEDRIVE_OAUTH_TOKEN_URL || 'https://oauth.pipedrive.com/oauth/token';
const TABLE = process.env.PIPEDRIVE_OAUTH_TABLE || 'pipedrive_oauth_connections';

function assertOAuthEnv() {
  // Allow a few common env var aliases
  const clientId = process.env.PIPEDRIVE_OAUTH_CLIENT_ID || process.env.PIPEDRIVE_CLIENT_ID;
  const clientSecret = process.env.PIPEDRIVE_OAUTH_CLIENT_SECRET || process.env.PIPEDRIVE_CLIENT_SECRET;
  const redirectUri = process.env.PIPEDRIVE_OAUTH_REDIRECT_URI || process.env.PIPEDRIVE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    const missing = [
      !clientId ? 'PIPEDRIVE_OAUTH_CLIENT_ID (or PIPEDRIVE_CLIENT_ID)' : null,
      !clientSecret ? 'PIPEDRIVE_OAUTH_CLIENT_SECRET (or PIPEDRIVE_CLIENT_SECRET)' : null,
      !redirectUri ? 'PIPEDRIVE_OAUTH_REDIRECT_URI (or PIPEDRIVE_REDIRECT_URI)' : null,
    ].filter(Boolean);
    const err = new Error(`Pipedrive OAuth is not configured (missing: ${missing.join(', ')})`);
    err.code = 'PIPEDRIVE_OAUTH_NOT_CONFIGURED';
    throw err;
  }
  return { clientId, clientSecret, redirectUri };
}

function buildAuthorizeUrl({ state } = {}) {
  const { clientId, redirectUri } = assertOAuthEnv();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  if (state) url.searchParams.set('state', String(state));
  return url.toString();
}

function basicAuthHeader(clientId, clientSecret) {
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

async function tokenRequest(bodyParams, { clientId, clientSecret } = {}) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(clientId && clientSecret ? { Authorization: basicAuthHeader(clientId, clientSecret) } : {}),
    },
    body: new URLSearchParams(bodyParams),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    // ignore
  }

  if (!res.ok) {
    const err = new Error(`Pipedrive OAuth token error (${res.status})`);
    err.status = res.status;
    err.body = json || text;
    // Safe debug info (no secrets)
    err.meta = {
      tokenUrl: TOKEN_URL,
      clientIdTail: clientId ? String(clientId).slice(-6) : null,
      // redirect_uri is in bodyParams for auth code exchanges
      redirectUri: bodyParams?.redirect_uri ? String(bodyParams.redirect_uri) : null,
      grantType: bodyParams?.grant_type ? String(bodyParams.grant_type) : null,
    };
    throw err;
  }
  return json;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = assertOAuthEnv();
  return tokenRequest({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: redirectUri,
    // Keep these for compatibility even though Authorization: Basic is used
    client_id: clientId,
    client_secret: clientSecret,
  }, { clientId, clientSecret });
}

async function refreshTokens(refreshToken) {
  const { clientId, clientSecret } = assertOAuthEnv();
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken),
    client_id: clientId,
    client_secret: clientSecret,
  }, { clientId, clientSecret });
}

async function fetchCompanyIdFromAccessToken({ accessToken, apiDomain } = {}) {
  if (!accessToken) return null;
  const base = apiDomain || 'https://api.pipedrive.com';
  const url = `${String(base).replace(/\/$/, '')}/v1/users/me`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    // ignore
  }

  if (!res.ok) return null;
  const data = json?.data || null;
  const companyId = data?.company_id || data?.companyId || null;
  return companyId ? String(companyId) : null;
}

function computeExpiresAt(expiresInSeconds) {
  const n = Number(expiresInSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Refresh a bit early
  const early = Math.max(30, Math.floor(n * 0.1));
  return new Date(Date.now() + (n - early) * 1000).toISOString();
}

async function getCompanyConnection(companyId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('company_id', String(companyId))
    .maybeSingle();

  // If the table doesn't exist or the schema isn't deployed yet, treat as not connected.
  if (error) {
    const msg = error.message || '';
    if (/does not exist/i.test(msg) || /relation/i.test(msg)) return null;
    throw error;
  }
  return data || null;
}

async function upsertCompanyTokens({ companyId, accessToken, refreshToken, expiresIn, apiDomain }) {
  const expiresAt = computeExpiresAt(expiresIn);

  const payload = {
    company_id: String(companyId),
    access_token: accessToken || null,
    refresh_token: refreshToken || null,
    expires_at: expiresAt,
    api_domain: apiDomain || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(payload, { onConflict: 'company_id' })
    .select('*')
    .maybeSingle();

  if (error) {
    const msg = error.message || '';
    if (/does not exist/i.test(msg) || /relation/i.test(msg)) {
      const err = new Error(
        `Supabase table "${TABLE}" is missing. Create it to store Pipedrive OAuth tokens (company_id, access_token, refresh_token, expires_at, api_domain, updated_at).`
      );
      err.code = 'PIPEDRIVE_OAUTH_TABLE_MISSING';
      throw err;
    }
    throw error;
  }
  return data || null;
}

async function getValidAccessToken(companyId) {
  const conn = await getCompanyConnection(companyId);
  if (!conn?.access_token) return null;

  // If no expiry is stored, assume it's valid until it fails.
  if (!conn.expires_at) return conn.access_token;

  const expiresAtMs = Date.parse(conn.expires_at);
  if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()) {
    return conn.access_token;
  }

  // Refresh
  if (!conn.refresh_token) return null;
  const refreshed = await refreshTokens(conn.refresh_token);
  await upsertCompanyTokens({
    companyId,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || conn.refresh_token,
    expiresIn: refreshed.expires_in,
    apiDomain: refreshed.api_domain || conn.api_domain,
  });
  return refreshed.access_token || null;
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchCompanyIdFromAccessToken,
  getCompanyConnection,
  upsertCompanyTokens,
  getValidAccessToken,
};


