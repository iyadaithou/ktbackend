/**
 * One-time converter: Markdown -> HTML for programs and schools rich text fields
 * Usage: npm run convert-markdown
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const { marked } = require('marked');

function looksLikeMarkdown(text) {
  if (!text || typeof text !== 'string') return false;
  if (text.trim().startsWith('<')) return false;
  return /[*_#`>\-]|\n\n/.test(text);
}

async function convertPrograms() {
  console.log('Converting programs.description (markdown -> HTML)...');
  const { data: programs, error } = await supabase
    .from('programs')
    .select('id, description')
    .limit(10000);
  if (error) throw error;
  let updated = 0;
  for (const p of programs || []) {
    const desc = p.description || '';
    if (looksLikeMarkdown(desc)) {
      try {
        const html = marked.parse(desc) || desc;
        const { error: upErr } = await supabase
          .from('programs')
          .update({ description: html, updated_at: new Date().toISOString() })
          .eq('id', p.id);
        if (upErr) throw upErr;
        updated++;
      } catch (e) {
        console.warn('Program update failed:', p.id, e.message);
      }
    }
  }
  console.log(`Programs updated: ${updated}`);
}

async function convertSchools() {
  console.log('Converting schools financial_aid_policy and scholarships_info...');
  const { data: schools, error } = await supabase
    .from('schools')
    .select('id, financial_aid_policy, scholarships_info')
    .limit(10000);
  if (error) throw error;
  let updated = 0;
  for (const s of schools || []) {
    let fin = s.financial_aid_policy || '';
    let sch = s.scholarships_info || '';
    let finChanged = false, schChanged = false;
    if (looksLikeMarkdown(fin)) {
      try { fin = marked.parse(fin) || fin; finChanged = true; } catch (_) {}
    }
    if (looksLikeMarkdown(sch)) {
      try { sch = marked.parse(sch) || sch; schChanged = true; } catch (_) {}
    }
    if (finChanged || schChanged) {
      try {
        const { error: upErr } = await supabase
          .from('schools')
          .update({
            financial_aid_policy: fin,
            scholarships_info: sch,
            updated_at: new Date().toISOString(),
          })
          .eq('id', s.id);
        if (upErr) throw upErr;
        updated++;
      } catch (e) {
        console.warn('School update failed:', s.id, e.message);
      }
    }
  }
  console.log(`Schools updated: ${updated}`);
}

(async () => {
  try {
    await convertPrograms();
    await convertSchools();
    console.log('Markdown conversion complete.');
    process.exit(0);
  } catch (e) {
    console.error('Conversion failed:', e);
    process.exit(1);
  }
})();


