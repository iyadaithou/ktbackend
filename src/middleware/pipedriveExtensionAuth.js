/**
 * Auth middleware for Pipedrive Custom UI Extensions (iframe)
 *
 * The frontend panel should request a signed token from the App Extensions SDK,
 * then send it to our backend as:
 *   Authorization: Bearer <signed_token>
 *
 * Configure:
 * - PIPEDRIVE_JWT_SECRET (required)  // set in Pipedrive app extension settings ("JWT secret")
 */

const jwt = require('jsonwebtoken');

function getBearer(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

const pipedriveExtensionAuth = (req, res, next) => {
  try {
    const secret = process.env.PIPEDRIVE_JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'Server is missing PIPEDRIVE_JWT_SECRET' });
    }

    const token = getBearer(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    }

    // Validate signature + exp. Claims vary by Pipedrive surface, so keep it flexible.
    const payload = jwt.verify(token, secret);

    // Extract user ID - Pipedrive tokens can have different field names
    // Try multiple possible fields to find the user ID
    const userId = payload?.userId || payload?.user_id || payload?.uid || payload?.id || null;
    const companyId = payload?.companyId || payload?.company_id || payload?.cid || null;
    
    // Log the full payload for debugging (but don't log sensitive data in production)
    console.log('🔐 Pipedrive token payload keys:', Object.keys(payload || {}));
    console.log('🔐 Extracted userId:', userId);
    console.log('🔐 Extracted companyId:', companyId);
    if (payload?.name || payload?.email) {
      console.log('🔐 User info from token:', { name: payload.name, email: payload.email });
    }

    req.pipedrive = {
      tokenPayload: payload,
      userId,
      companyId,
    };

    return next();
  } catch (e) {
    console.warn('Pipedrive extension auth failed:', e?.message || e);
    return res.status(401).json({ error: 'Invalid Pipedrive token' });
  }
};

/**
 * Optional version: if Authorization Bearer token is present, verify and populate req.pipedrive.
 * If header is missing, continue without error (useful for routes that support both browser + extension calls).
 */
const optionalPipedriveExtensionAuth = (req, res, next) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return next();

  const secret = process.env.PIPEDRIVE_JWT_SECRET;
  if (!secret) {
    // If the client tried to authenticate but server isn't configured, surface that.
    return res.status(500).json({ error: 'Server is missing PIPEDRIVE_JWT_SECRET' });
  }

  try {
    const token = auth.slice('Bearer '.length).trim();
    const payload = jwt.verify(token, secret);
    const userId = payload?.userId || payload?.user_id || payload?.uid || null;
    const companyId = payload?.companyId || payload?.company_id || payload?.cid || null;
    req.pipedrive = { tokenPayload: payload, userId, companyId };
    return next();
  } catch (e) {
    console.warn('Optional Pipedrive extension auth failed:', e?.message || e);
    return res.status(401).json({ error: 'Invalid Pipedrive token' });
  }
};

module.exports = { pipedriveExtensionAuth, optionalPipedriveExtensionAuth };


