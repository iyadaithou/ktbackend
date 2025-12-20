/**
 * Duplicate a program and all related data to a new slug/title
 * Usage:
 *   node scripts/duplicate-program.js <source-slug> <new-slug> [new-title]
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

async function fetchProgramBySlug(slug) {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function duplicateRelated({ table, sourceProgramId, targetProgramId, mapRow }) {
  const { data: rows, error } = await supabase
    .from(table)
    .select('*')
    .eq('program_id', sourceProgramId)
    .order('display_order', { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const insertRows = rows.map((r, index) => {
    const base = { ...r };
    delete base.id;
    base.program_id = targetProgramId;
    if (typeof base.display_order === 'number' && Number.isFinite(base.display_order)) {
      // keep as is
    } else if (typeof index === 'number') {
      base.display_order = index;
    }
    return mapRow ? mapRow(base) : base;
  });

  const { error: insertErr } = await supabase
    .from(table)
    .insert(insertRows);
  if (insertErr) throw insertErr;
  return insertRows.length;
}

async function main() {
  const srcSlug = process.argv[2];
  const newSlugArg = process.argv[3];
  const newTitleArg = process.argv[4];

  if (!srcSlug || !newSlugArg) {
    console.error('Usage: node scripts/duplicate-program.js <source-slug> <new-slug> [new-title]');
    process.exit(1);
    return;
  }

  const newSlug = slugify(newSlugArg);
  try {
    // Ensure credentials
    if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
      throw new Error('Missing Supabase credentials (SUPABASE_URL and SUPABASE_SERVICE_KEY).');
    }

    // Fetch source
    const source = await fetchProgramBySlug(srcSlug);
    if (!source) {
      console.error('Source program not found for slug:', srcSlug);
      process.exit(1);
      return;
    }

    // Ensure target slug unique
    const { data: existing } = await supabase
      .from('programs')
      .select('id, slug')
      .eq('slug', newSlug)
      .maybeSingle();
    if (existing) {
      console.error('A program with slug already exists:', newSlug);
      process.exit(1);
      return;
    }

    // Insert program copy
    const copy = { ...source };
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;
    // reset counters that should not be copied if needed (keep as-is by default)
    copy.slug = newSlug;
    if (newTitleArg) copy.title = newTitleArg;
    copy.created_at = new Date().toISOString();
    copy.updated_at = new Date().toISOString();

    const { data: inserted, error: insertProgramErr } = await supabase
      .from('programs')
      .insert([copy])
      .select()
      .single();
    if (insertProgramErr) throw insertProgramErr;

    const targetProgramId = inserted.id;

    // Duplicate related tables
    const tasks = [
      { table: 'program_highlights' },
      { table: 'program_curriculum' },
      { table: 'program_gallery' },
      { table: 'program_testimonials' },
      { table: 'program_faqs' },
      { table: 'program_application_steps' },
      { table: 'program_videos' },
      { table: 'program_currency_prices' },
    ];

    let totalCopied = 0;
    for (const t of tasks) {
      const count = await duplicateRelated({
        table: t.table,
        sourceProgramId: source.id,
        targetProgramId,
        mapRow: (row) => row,
      });
      totalCopied += count;
    }

    console.log('Duplicated program to slug', newSlug, 'with id', targetProgramId, 'Copied rows:', totalCopied);
    process.exit(0);
  } catch (e) {
    console.error('Duplication failed:', e?.message || e);
    process.exit(1);
  }
}

main();









