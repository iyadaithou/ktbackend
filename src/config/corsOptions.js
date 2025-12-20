/**
 * CORS configuration
 */

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Build allowlist from env + safe defaults
    const envList = (process.env.CORS_ORIGIN || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    const defaultList = [
      // Allow our production domains only
      // Primary domain
      'pythagoras.team',
      'https://pythagoras.team',
      'https://www.pythagoras.team',
      // Legacy/alternate domain (keep for now to avoid breaking old deployments)
      'pythagoras.com',
      'https://pythagoras.com',
      'https://www.pythagoras.com',
      // Local dev
      'http://localhost:3000',
      'http://localhost:5173',
      // Allow Pipedrive Custom UI Extensions (iframe runs inside *.pipedrive.com)
      'pipedrive.com',
      'https://pipedrive.com',
    ];
    const allowedOrigins = Array.from(new Set([...
      envList,
      ...defaultList,
    ]));
    
    // For development/testing - log the request origin
    console.log('Request origin:', origin);
    console.log('Allowed origins:', allowedOrigins);
    
    // Allow requests with no origin (like mobile apps, curl requests, or webhooks)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow all origins if wildcard is present
    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Check if origin is allowed
    const isAllowed = allowedOrigins.some(allowed => {
      // Exact match
      if (allowed === origin) {
        return true;
      }
      
      // Handle subdomains for pythagoras.com - allow www.pythagoras.com or any subdomain
      if (allowed === 'pythagoras.com' && origin && (
        origin === 'https://pythagoras.com' || 
        origin.endsWith('.pythagoras.com')
      )) {
        return true;
      }
      
      // Handle subdomains for pythagoras.team - allow www.pythagoras.team or any subdomain
      if (allowed === 'pythagoras.team' && origin && (
        origin === 'https://pythagoras.team' || 
        origin.endsWith('.pythagoras.team')
      )) {
        return true;
      }

      // Allow subdomains for Pipedrive
      if (allowed === 'pipedrive.com' && origin && (
        origin === 'https://pipedrive.com' ||
        origin.endsWith('.pipedrive.com')
      )) {
        return true;
      }
      
      // More general subdomain handling
      if (origin && origin.endsWith(`.${allowed}`)) {
        return true;
      }
      
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS error: Origin not allowed:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  optionsSuccessStatus: 204,
  credentials: true,
  preflightContinue: false,
};

module.exports = corsOptions; 