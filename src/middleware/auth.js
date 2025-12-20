/**
 * Authentication middleware
 */
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
// Lazy-load Clerk SDK to avoid import-time failures in serverless/ESM contexts
let clerk = null;
const getClerkClient = async () => {
  if (clerk) return clerk;
  try {
    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) {
      console.warn('Clerk is not configured: CLERK_SECRET_KEY is missing. Clerk token verification will be disabled.');
      return null;
    }
    // Dynamic import to support ESM-only clerk-sdk-node
    const mod = await import('@clerk/clerk-sdk-node');
    const createClerkClient = mod.createClerkClient || mod.default?.createClerkClient || mod.createClient || null;
    if (!createClerkClient) {
      console.error('Clerk SDK import did not expose createClerkClient');
      return null;
    }
    clerk = createClerkClient({ secretKey: secret });
    console.log('Clerk client initialized');
    return clerk;
  } catch (error) {
    console.error('Failed to initialize Clerk client. Clerk auth will be disabled:', error.message || error);
    clerk = null;
    return null;
  }
};

/**
 * Verify a Clerk session token
 * @param {string} token - The Clerk session token
 * @returns {Promise<Object>} - The decoded token payload
 */
const verifyClerkToken = async (token) => {
  try {
    const c = await getClerkClient();
    if (!c) {
      throw new Error('Clerk not configured');
    }
    // Verify the token using Clerk's SDK
    const jwtPayload = await c.verifyToken(token);
    return jwtPayload;
  } catch (error) {
    console.error('Clerk token verification failed:', error.message || error);
    throw new Error('Invalid Clerk token: ' + (error.message || String(error)));
  }
};

/**
 * Simplified authentication middleware
 * Focuses on Clerk token verification and user lookup
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Special case for getUserByClerkId - allow for frontend admin verification
      if (req.path.startsWith('/users/clerk/')) {
        req.user = { role: 'guest' };
        return next();
      }
      
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Determine if this is a Clerk token
    let isClerkToken = false;
    try {
      const decodedPayload = jwt.decode(token);
      isClerkToken = decodedPayload && 
                    (decodedPayload.iss === 'clerk' || 
                     decodedPayload.azp?.includes('clerk') ||
                     decodedPayload.sub?.includes('user_'));
    } catch (decodeError) {
      console.log('Error decoding token:', decodeError.message);
    }
    
    if (isClerkToken) {
      // Verify Clerk token
      try {
        const clerkSession = await verifyClerkToken(token);
        req.user = { 
          tokenType: 'clerk',
          clerkId: clerkSession.sub,
          email: clerkSession.email,
          role: 'clerk-user'
        };
      } catch (clerkError) {
        console.error('Clerk verification failed:', clerkError.message);
        return res.status(401).json({ status: 'error', message: 'Invalid Clerk token' });
      }
    } else {
      // Verify custom JWT token
      try {
        if (!process.env.JWT_SECRET) {
          console.error('JWT_SECRET is not configured');
          return res.status(500).json({ status: 'error', message: 'Server configuration error: JWT authentication not properly configured' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          role: decoded.role,
          tokenType: 'jwt'
        };
      } catch (jwtError) {
        console.error('JWT verification error:', jwtError.message);
        return res.status(401).json({ status: 'error', message: 'Invalid JWT token' });
      }
    }
    
    // Look up user in database
    try {
      let query;
      
      if (req.user.role === 'guest') {
        return next();
      }
      
      if (req.user.tokenType === 'clerk') {
        const clerkId = req.user.clerkId || (req.params.clerkId || req.query.clerkId);
        
        if (!clerkId) {
          return res.status(401).json({ status: 'error', message: 'User identification failed' });
        }
        
        query = supabase
          .from('users')
          .select('id, email, role')
          .eq('clerk_id', clerkId)
          .single();
      } else {
        query = supabase
          .from('users')
          .select('id, email, role')
          .eq('id', req.user.id)
          .single();
      }
      
      const { data: userRow, error: queryError } = await query;
      let user = userRow;
      
      if (queryError && queryError.code !== 'PGRST116') {
        console.error('Database error during auth check:', queryError);
        if (req.path.startsWith('/users/clerk/')) {
          return next();
        }
        throw queryError;
      }
      
      if (!user) {
        if (req.path.startsWith('/users/clerk/')) {
          return next();
        }

        // Auto-provision user from Clerk if possible
        if (req.user.tokenType === 'clerk' && req.user.clerkId) {
          try {
            let emailToUse = req.user.email;
            if (!emailToUse) {
              const c = await getClerkClient();
              if (c) {
                const clerkUser = await c.users.getUser(req.user.clerkId);
                emailToUse = clerkUser?.primaryEmailAddress?.emailAddress || clerkUser?.emailAddresses?.[0]?.emailAddress || null;
              }
            }

            if (emailToUse) {
              const lower = String(emailToUse).toLowerCase();
              const { data: created, error: createErr } = await supabase
                .from('users')
                .insert({
                  email: lower,
                  clerk_id: req.user.clerkId,
                  role: 'student',
                  subscription_level: 'free'
                })
                .select('id, email, role')
                .single();
              if (!createErr && created) {
                if (process.env.NODE_ENV === 'development') {
                  console.log('Auto-provisioned user from Clerk token, ID:', created.id);
                }
                user = created;
              } else if (createErr && (createErr.code === '23505' || /duplicate key/i.test(createErr.message || ''))) {
                // Email exists: link Clerk ID to existing user if not already
                const { data: existing } = await supabase
                  .from('users')
                  .select('id, email, role, clerk_id')
                  .eq('email', lower)
                  .maybeSingle();
                if (existing) {
                  if (!existing.clerk_id) {
                    await supabase.from('users').update({ clerk_id: req.user.clerkId }).eq('id', existing.id);
                  }
                  user = { id: existing.id, email: existing.email, role: existing.role };
                }
              }
            }
          } catch (autoErr) {
            console.warn('Auto-provision exception:', autoErr?.message || autoErr);
          }
        }

        if (!user) {
          if (req.method === 'GET') {
            req.user = {
              ...req.user,
              id: req.user.id || null,
              role: req.user.role || 'student',
              dbRecord: false,
              permissions: []
            };
            return next();
          }
          return res.status(401).json({ status: 'error', message: 'User not found or token invalid' });
        }
      }
      
      // Fetch custom roles and permissions
      let customPermissions = [];
      try {
        const userPk = req.user.id || user.id;
        const { data: linkRows, error: linkErr } = await supabase
          .from('user_custom_roles')
          .select('role_id')
          .eq('user_id', userPk);
        if (!linkErr && Array.isArray(linkRows) && linkRows.length > 0) {
          const roleIds = Array.from(new Set(linkRows.map(r => r.role_id).filter(Boolean)));
          if (roleIds.length > 0) {
            const { data: roles, error: rolesErr } = await supabase
              .from('custom_roles')
              .select('permissions')
              .in('id', roleIds);
            if (!rolesErr && Array.isArray(roles)) {
              const perms = [];
              roles.forEach(cr => { if (Array.isArray(cr.permissions)) perms.push(...cr.permissions); });
              customPermissions = Array.from(new Set(perms));
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load custom roles permissions:', e?.message || e);
      }

      // Attach user to request
      req.user = {
        ...req.user,
        id: user.id,
        email: user.email,
        role: user.role,
        dbRecord: true,
        permissions: customPermissions
      };
      
      // Only log user ID for security, not email or other sensitive data
      if (process.env.NODE_ENV === 'development') {
        console.log('User authenticated:', { id: user.id, role: user.role });
      }
      next();
    } catch (error) {
      console.error('Error during database auth check:', error);
      next(error);
    }
  } catch (error) {
    console.error('Authentication middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Invalid token format' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Token expired' });
    }
    next(error);
  }
};

/**
 * Role-based access control middleware
 * @param {string[]} allowedRoles - Array of roles allowed to access the route
 */
const authorize = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }
    
    if (allowedRoles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).json({ status: 'error', message: 'Access denied. Insufficient permissions' });
    }
  };
};

module.exports = {
  authenticate,
  authenticateToken: authenticate, // For backwards compatibility
  authorize
};
