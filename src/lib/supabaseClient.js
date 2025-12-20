/**
 * Backwards-compatible Supabase client export.
 *
 * Some routes expect: `const { supabase } = require('../lib/supabaseClient')`
 * The canonical client lives in `src/config/supabase.js`.
 */

const supabase = require('../config/supabase');

module.exports = { supabase };


