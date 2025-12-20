/**
 * Main application entry point
 * Updated for deployment testing
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const corsOptions = require('./config/corsOptions');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3001;
const IS_SERVERLESS = Boolean(process.env.VERCEL) || process.env.SERVERLESS === '1';

// Middleware
app.use(helmet()); // Security headers
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')); // Logging
app.use(cors(corsOptions));
// Ensure preflight requests are handled globally
app.options('*', cors(corsOptions));

// Fallback explicit preflight handler (defense-in-depth for some platforms)
app.use((req, res, next) => {
  // Log incoming request essentials for diagnostics
  console.log('[REQ]', {
    method: req.method,
    path: req.path,
    origin: req.headers.origin || null,
    hasAuth: Boolean(req.headers.authorization)
  });
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    // Reflect allowed origin if from our domain
    if (origin && (
      origin === 'https://pythagoras.team' ||
      origin === 'https://www.pythagoras.team' ||
      origin.endsWith('.pythagoras.team') ||
      // keep legacy/alternate domain
      origin === 'https://pythagoras.com' ||
      origin === 'https://www.pythagoras.com' ||
      origin.endsWith('.pythagoras.com')
    )) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    // Echo requested headers or provide defaults
    res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Authorization,Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');
    return res.sendStatus(204);
  }
  next();
});

// Import routes with guard to avoid import-time crashes (isolate each import)
let userRoutes, webhookRoutes, roleRoutes, representativesRoutes, aiRoutes, ragRoutes, uploadRoutes, aiAdminRoutes, storageRoutes, knowledgeStateRoutes, communityRoutes, tutorRoutes, supportRoutes, emailRoutes, smsRoutes, pipedriveRoutes, recommendersPublicRoutes, notificationRoutes, supervisorRoutes, directOfferRoutes;
let knowledgeBaseRoutes;
try { webhookRoutes = require('./routes/webhooks'); console.log('Loaded routes: /api/webhooks'); } catch (e) { console.error('Failed to load /api/webhooks:', e?.message || e); }
try { userRoutes = require('./routes/users'); console.log('Loaded routes: /api/users'); } catch (e) { console.error('Failed to load /api/users:', e?.message || e); }
try { uploadRoutes = require('./routes/upload'); console.log('Loaded routes: /api/upload'); } catch (e) { console.error('Failed to load /api/upload:', e?.message || e); }
try { roleRoutes = require('./routes/roles'); console.log('Loaded routes: /api/roles'); } catch (e) { console.error('Failed to load /api/roles:', e?.message || e); }
try { representativesRoutes = require('./routes/representatives'); console.log('Loaded routes: /api/representatives'); } catch (e) { console.error('Failed to load /api/representatives:', e?.message || e); }
try { aiRoutes = require('./routes/ai'); console.log('Loaded routes: /api/ai'); } catch (e) { console.error('Failed to load /api/ai:', e?.message || e); }
try { ragRoutes = require('./routes/rag'); console.log('Loaded routes: /api/rag'); } catch (e) { console.error('Failed to load /api/rag:', e?.message || e); }
try { knowledgeBaseRoutes = require('./routes/knowledge_base'); console.log('Loaded routes: /api/kb'); } catch (e) { console.error('Failed to load /api/kb:', e?.message || e); }
try { aiAdminRoutes = require('./routes/ai_admin'); console.log('Loaded routes: /api/ai-admin'); } catch (e) { console.error('Failed to load /api/ai-admin:', e?.message || e); }
try { storageRoutes = require('./routes/storage'); console.log('Loaded routes: /api/storage'); } catch (e) { console.error('Failed to load /api/storage:', e?.message || e); }
try { knowledgeStateRoutes = require('./routes/knowledge_state'); console.log('Loaded routes: /api/knowledge-state'); } catch (e) { console.error('Failed to load /api/knowledge-state:', e?.message || e); }
try { communityRoutes = require('./routes/community'); console.log('Loaded routes: /api/community'); } catch (e) { console.error('Failed to load /api/community:', e?.message || e); }
try { tutorRoutes = require('./routes/tutor'); console.log('Loaded routes: /api/tutor'); } catch (e) { console.error('Failed to load /api/tutor:', e?.message || e); }
try { supportRoutes = require('./routes/support'); console.log('Loaded routes: /api/support'); } catch (e) { console.error('Failed to load /api/support:', e?.message || e); }
try { emailRoutes = require('./routes/email'); console.log('Loaded routes: /api/email'); } catch (e) { console.error('Failed to load /api/email:', e?.message || e); }
try { smsRoutes = require('./routes/sms'); console.log('Loaded routes: /api/sms'); } catch (e) { console.error('Failed to load /api/sms:', e?.message || e); }
try { pipedriveRoutes = require('./routes/pipedrive'); console.log('Loaded routes: /api/pipedrive'); } catch (e) { console.error('Failed to load /api/pipedrive:', e?.message || e); }
try { recommendersPublicRoutes = require('./routes/recommenders_public'); console.log('Loaded routes: /api/recommenders/public'); } catch (e) { console.error('Failed to load /api/recommenders/public:', e?.message || e); }
try { notificationRoutes = require('./routes/notifications'); console.log('Loaded routes: /api/notifications'); } catch (e) { console.error('Failed to load /api/notifications:', e?.message || e); }
try { supervisorRoutes = require('./routes/supervisors'); console.log('Loaded routes: /api/supervisors'); } catch (e) { console.error('Failed to load /api/supervisors:', e?.message || e); }
try { directOfferRoutes = require('./routes/directOffers'); console.log('Loaded routes: /api/direct-offers'); } catch (e) { console.error('Failed to load /api/direct-offers:', e?.message || e); }

// Use webhook routes BEFORE body parser (webhooks need raw body)
if (webhookRoutes) app.use('/api/webhooks', webhookRoutes);

// Add JSON parsing for all other routes
app.use(express.json()); // Parse JSON requests

// Hard-disable removed legacy features to prevent crashes after DB cleanup
const REMOVED_PREFIXES = [
  '/api/schools',
  '/api/tasks',
  '/api/task-templates',
  '/api/application-tasks',
  '/api/form-builder',
  '/api/exports',
  '/api/agent-students',
  '/api/sales-assignments',
  '/api/ambassadors',
  '/api/translation-orders',
  '/api/trello',
  '/api/trello-setup',
  '/api/trello-public',
  '/api/webhooks/trello',
  '/api/test-integration',
  '/api/analytics',
  '/api/smart-search',
  '/api/user-intelligence',
  '/api/pdf-export',
];
app.use(REMOVED_PREFIXES, (_req, res) => {
  return res.status(410).json({ error: 'This feature has been removed.' });
});

// Use other routes if loaded successfully
if (userRoutes) app.use('/api/users', userRoutes);
if (roleRoutes) app.use('/api/roles', roleRoutes);
if (representativesRoutes) app.use('/api/representatives', representativesRoutes);
if (aiRoutes) app.use('/api/ai', aiRoutes);
if (ragRoutes) app.use('/api/rag', ragRoutes);
if (knowledgeBaseRoutes) app.use('/api/kb', knowledgeBaseRoutes);
if (uploadRoutes) app.use('/api/upload', uploadRoutes);
if (aiAdminRoutes) app.use('/api/ai-admin', aiAdminRoutes);
if (storageRoutes) app.use('/api/storage', storageRoutes);
if (knowledgeStateRoutes) app.use('/api/knowledge-state', knowledgeStateRoutes);
if (communityRoutes) app.use('/api/community', communityRoutes);
if (tutorRoutes) app.use('/api/tutor', tutorRoutes);
if (supportRoutes) app.use('/api/support', supportRoutes);
if (emailRoutes) app.use('/api/email', emailRoutes);
if (smsRoutes) app.use('/api/sms', smsRoutes);
if (pipedriveRoutes) app.use('/api/pipedrive', pipedriveRoutes);
if (recommendersPublicRoutes) app.use('/api/recommenders/public', recommendersPublicRoutes);
if (notificationRoutes) app.use('/api/notifications', notificationRoutes);
if (supervisorRoutes) app.use('/api/supervisors', supervisorRoutes);
if (directOfferRoutes) app.use('/api/direct-offers', directOfferRoutes);

// removed: ambassadors fallback endpoints (feature deleted)

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Server is running',
    environment: process.env.NODE_ENV,
    diagnostics: {
      vercel: Boolean(process.env.VERCEL),
      runtime: process.version,
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY),
      hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
      hasJwtSecret: Boolean(process.env.JWT_SECRET),
      hasClerkSecret: Boolean(process.env.CLERK_SECRET_KEY),
      corsOrigin: process.env.CORS_ORIGIN || null
    }
  });
});

// Simple version endpoint to verify deployment/version on Vercel
app.get('/api/version', (_req, res) => {
  return res.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    builtAt: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      status: 'error',
      message: 'Origin not allowed by CORS'
    });
  }
  
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// In serverless (Vercel), export a handler function; locally, listen on a port
if (!IS_SERVERLESS) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  });
  module.exports = app;
} else {
  module.exports = (req, res) => app(req, res);
}
// deploy bump: 2025-10-08T06:01Z
