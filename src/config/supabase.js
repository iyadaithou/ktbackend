/**
 * Supabase client configuration
 */
const { createClient } = require('@supabase/supabase-js');

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
// Prefer service key; fallback to anon key for read-only public tables
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

// Create a placeholder or actual client based on credentials
let supabase;

// Validate credentials
console.log('Supabase URL configured:', !!supabaseUrl);
console.log('Supabase Key configured:', !!supabaseKey);
console.log('Environment check - SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
console.log('Environment check - SUPABASE_SERVICE_KEY exists:', !!process.env.SUPABASE_SERVICE_KEY);
console.log('Environment check - SUPABASE_ANON_KEY exists:', !!process.env.SUPABASE_ANON_KEY);

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR: Missing Supabase credentials. Ensure SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) are set.");
  throw new Error('Supabase credentials are missing. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) environment variables.');
} else {
  // Create and export Supabase client
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    });
    console.log('Supabase client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    throw new Error(`Failed to initialize Supabase client: ${error.message}`);
  }
}

module.exports = supabase;
