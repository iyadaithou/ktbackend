/**
 * Backfill and sanitize programs
 * - Generate missing slugs (unique, based on title)
 * - Coerce numeric fields (fee, total_spots, available_spots, capacity) to numbers or null
 * Usage: npm run backfill-programs
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');

// Ensure credentials are present to avoid placeholder client limitations
if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
  console.error('ERROR: Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your environment.');
  process.exit(1);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function sanitizeNumber(value, isFloat = false) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === '') return null;
  const n = isFloat ? parseFloat(str) : parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log('Starting programs backfill...');

  const { data: programs, error } = await supabase
    .from('programs')
    .select('id, title, slug, fee, total_spots, available_spots, capacity')
    .limit(10000);
  if (error) {
    console.error('Failed to fetch programs:', error.message || error);
    process.exit(1);
    return;
  }

  const existingSlugs = new Map();
  for (const p of programs || []) {
    const s = (p.slug || '').trim();
    if (s) existingSlugs.set(s, p.id);
  }

  let updated = 0;
  let slugFixed = 0;
  let numericFixed = 0;

  for (const p of programs || []) {
    const update = {};

    // Backfill slug if missing/empty
    if (!p.slug || !String(p.slug).trim()) {
      let base = slugify(p.title || 'program');
      if (!base) base = 'program';
      let candidate = base;
      let counter = 2;
      while (existingSlugs.has(candidate)) {
        if (existingSlugs.get(candidate) === p.id) break; // same record
        candidate = `${base}-${counter++}`;
      }
      update.slug = candidate;
      existingSlugs.set(candidate, p.id);
      slugFixed++;
    }

    // Sanitize numeric columns
    const fee = sanitizeNumber(p.fee, true);
    const total_spots = sanitizeNumber(p.total_spots, false);
    const available_spots = sanitizeNumber(p.available_spots, false);
    const capacity = sanitizeNumber(p.capacity, false);

    // Only set if differs from current (including empty-string edge cases)
    if (String(p.fee ?? '') !== String(fee ?? '')) update.fee = fee, numericFixed++;
    if (String(p.total_spots ?? '') !== String(total_spots ?? '')) update.total_spots = total_spots, numericFixed++;
    if (String(p.available_spots ?? '') !== String(available_spots ?? '')) update.available_spots = available_spots, numericFixed++;
    if (String(p.capacity ?? '') !== String(capacity ?? '')) update.capacity = capacity, numericFixed++;

    if (Object.keys(update).length > 0) {
      update.updated_at = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('programs')
        .update(update)
        .eq('id', p.id);
      if (upErr) {
        console.warn('Failed to update program', p.id, upErr.message || upErr);
        continue;
      }
      updated++;
    }
  }

  console.log(`Backfill complete. Updated rows: ${updated}. Slugs fixed: ${slugFixed}. Numeric fixes: ${numericFixed}.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});


