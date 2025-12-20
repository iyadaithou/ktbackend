/**
 * Fix translation fields on non-translation programs.
 * - For programs where is_translation_service is false (or null), clear translation pricing fields.
 * - Keeps values intact for translation programs.
 *
 * Usage:
 *   node scripts/fix-translation-fields.js
 *
 * Requirements:
 *   SUPABASE_URL and SUPABASE_SERVICE_KEY in env.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');

async function main() {
  try {
    if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
      throw new Error('Missing Supabase credentials (SUPABASE_URL and SUPABASE_SERVICE_KEY).');
    }

    console.log('Fetching non-translation programs with translation pricing set...');
    const { data: rows, error } = await supabase
      .from('programs')
      .select('id, title, is_translation_service, translation_price_per_page_cents, translation_cover_fee_cents')
      .or('is_translation_service.is.null,is_translation_service.eq.false')
      .not('translation_price_per_page_cents', 'is', null)
      .limit(10000);
    if (error) throw error;

    const { data: rows2, error: error2 } = await supabase
      .from('programs')
      .select('id, title, is_translation_service, translation_price_per_page_cents, translation_cover_fee_cents')
      .or('is_translation_service.is.null,is_translation_service.eq.false')
      .not('translation_cover_fee_cents', 'is', null)
      .limit(10000);
    if (error2) throw error2;

    const toFixMap = new Map();
    (rows || []).forEach(r => toFixMap.set(r.id, r));
    (rows2 || []).forEach(r => toFixMap.set(r.id, r));
    const toFix = Array.from(toFixMap.values());

    console.log('Programs to fix:', toFix.length);
    if (toFix.length === 0) {
      console.log('Nothing to fix. Exiting.');
      process.exit(0);
      return;
    }

    let updated = 0;
    for (const r of toFix) {
      const { error: upErr } = await supabase
        .from('programs')
        .update({
          is_translation_service: false,
          translation_price_per_page_cents: null,
          translation_cover_fee_cents: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.id);
      if (upErr) {
        console.warn('Failed to update program', r.id, r.title, upErr.message || upErr);
        continue;
      }
      updated++;
    }

    console.log(`Completed. Fixed ${updated} program(s).`);
    process.exit(0);
  } catch (e) {
    console.error('Fix script failed:', e?.message || e);
    process.exit(1);
  }
}

main();


