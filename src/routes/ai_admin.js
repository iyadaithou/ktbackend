const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');
const supabase = require('../config/supabase');

// All routes require auth + AI admin permission
router.use(authenticate);
router.use(authorize(PERMISSIONS.MANAGE_AI));

// Settings
router.get('/settings', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('global_ai_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return res.json({ settings: data || null });
  } catch (e) {
    console.error('ai-admin settings get error:', e);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const { instructions, config } = req.body || {};
    const row = { instructions: instructions || null, config: (typeof config === 'object' ? config : null) || null, updated_at: new Date().toISOString() };
    // Upsert by inserting new row; keep history minimal
    const { data, error } = await supabase
      .from('global_ai_settings')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ settings: data });
  } catch (e) {
    console.error('ai-admin settings save error:', e);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Storage helpers (global)
router.post('/init-bucket', async (req, res) => {
  try {
    const { bucket = 'global-ai' } = req.body || {};
    await supabase.storage.createBucket(bucket, { public: true }).catch((err) => console.warn('Bucket create skipped:', err?.message || err));
    await supabase.storage.updateBucket(bucket, { public: true }).catch((err) => console.warn('Bucket update skipped:', err?.message || err));
    // Write .keep
    try { await supabase.storage.from(bucket).upload('test/.keep', Buffer.from('keep'), { upsert: true, contentType: 'text/plain' }); } catch (_) {}
    return res.json({ ok: true, bucket });
  } catch (e) {
    console.error('ai-admin init-bucket error:', e);
    return res.status(500).json({ error: 'Failed to init bucket' });
  }
});

router.post('/signed-upload', async (req, res) => {
  try {
    const { filename, bucket = 'global-ai', folder = 'docs' } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename required' });
    await supabase.storage.createBucket(bucket, { public: true }).catch(() => {});
    await supabase.storage.updateBucket(bucket, { public: true }).catch(() => {});
    const ext = filename.includes('.') ? filename.split('.').pop() : 'bin';
    const baseRaw = filename.replace(new RegExp(`\\.${ext}$`, 'i'), '');
    const baseSanitized = baseRaw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const path = `${folder}/${baseSanitized}__${unique}.${ext}`;
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error) throw error;
    return res.json({ path, token: data?.token, signedUrl: data?.signedUrl, bucket });
  } catch (e) {
    console.error('ai-admin signed-upload error:', e);
    return res.status(500).json({ error: 'Failed to create signed upload' });
  }
});

router.post('/list-files', async (req, res) => {
  try {
    const { bucket = 'global-ai', prefix = 'docs' } = req.body || {};
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    const files = [];
    for (const it of data || []) {
      if (!it || !it.name || it.name.startsWith('.')) continue;
      const path = `${prefix}/${it.name}`;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      files.push({ name: it.name, path, url: urlData?.publicUrl || null, size: it.metadata?.size || null, created_at: it.created_at || null, updated_at: it.updated_at || null });
    }
    return res.json({ files });
  } catch (e) {
    console.error('ai-admin list-files error:', e);
    return res.status(500).json({ error: 'Failed to list files' });
  }
});

// Index files to global_ai_documents
router.post('/index-files', async (req, res) => {
  try {
    const { bucket = 'global-ai', prefix = 'docs', maxFiles } = req.body || {};
    const { data: list, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw error;
    const files = (list || []).filter(it => it && it.name && !String(it.name).startsWith('.'));
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    const mod = await import('openai');
    const OpenAI = mod.default || mod.OpenAI || mod;
    const client = new OpenAI({ apiKey });
    let indexed = 0;
    const limit = typeof maxFiles === 'number' && maxFiles > 0 ? Math.min(maxFiles, files.length) : files.length;
    for (let i = 0; i < limit; i++) {
      const f = files[i];
      const path = `${prefix}/${f.name}`;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const url = urlData?.publicUrl;
      if (!url) continue;
      try {
        const resp = await fetch(url);
        const ct = String(resp.headers.get('content-type') || '');
        let text = '';
        if (/application\/pdf/i.test(ct)) {
          try { const buf = Buffer.from(await resp.arrayBuffer()); const pdfParse = (await import('pdf-parse')).default; const parsed = await pdfParse(buf); text = String(parsed.text || '').trim(); } catch (_) { text = await resp.text(); }
        } else {
          text = await resp.text();
        }
        text = (text || '').replace(/\u0000/g, ' ').trim();
        if (!text) continue;
        // clear old
        await supabase.from('global_ai_documents').delete().eq('file_path', path);
        // chunk
        const chunkSize = 1200; const chunks = [];
        for (let p = 0; p < text.length; p += chunkSize) chunks.push(text.slice(p, p + chunkSize));
        for (let idx = 0; idx < chunks.length; idx++) {
          const piece = chunks[idx];
          const emb = await client.embeddings.create({ model: 'text-embedding-3-small', input: piece });
          const vec = emb.data?.[0]?.embedding;
          if (!vec) continue;
          await supabase.from('global_ai_documents').insert({ file_path: path, chunk_index: idx, content: piece, embedding: vec });
          indexed++;
        }
      } catch (e) {
        console.warn('index file failed', f.name, e?.message || e);
      }
    }
    return res.json({ indexed, processedFiles: limit });
  } catch (e) {
    console.error('ai-admin index-files error:', e);
    return res.status(500).json({ error: 'Failed to index files' });
  }
});

router.post('/delete-file', async (req, res) => {
  try {
    const { bucket = 'global-ai', path } = req.body || {};
    if (!path) return res.status(400).json({ error: 'path required' });
    await supabase.storage.from(bucket).remove([path]);
    await supabase.from('global_ai_documents').delete().eq('file_path', path);
    return res.json({ deleted: true });
  } catch (e) {
    console.error('ai-admin delete-file error:', e);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Links management (global)
router.post('/links/list', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('global_ai_links')
      .select('id, url, title, status, last_crawled_at, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ links: data || [] });
  } catch (e) {
    console.error('ai-admin links/list error:', e);
    return res.status(500).json({ error: 'Failed to list links' });
  }
});

router.post('/links/bulk-upsert', async (req, res) => {
  try {
    const { urls } = req.body || {};
    if (!Array.isArray(urls)) return res.status(400).json({ error: 'urls[] required' });
    await supabase.from('global_ai_links').delete().neq('id', -1);
    const unique = Array.from(new Set(urls.map(u => String(u || '').trim()).filter(Boolean)));
    if (unique.length > 0) {
      const rows = unique.map(u => ({ url: u, status: 'pending' }));
      const { error } = await supabase.from('global_ai_links').insert(rows);
      if (error) throw error;
    }
    return res.json({ saved: unique.length });
  } catch (e) {
    console.error('ai-admin links/bulk-upsert error:', e);
    return res.status(500).json({ error: 'Failed to save links' });
  }
});

router.post('/links/delete', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });
    const { error } = await supabase.from('global_ai_links').delete().eq('url', String(url));
    if (error) throw error;
    return res.json({ deleted: true });
  } catch (e) {
    console.error('ai-admin links/delete error:', e);
    return res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Chat history (global)
router.get('/chats', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const userId = req.query.user_id ? String(req.query.user_id) : null;
    const q = req.query.q ? String(req.query.q).trim() : '';
    let query = supabase
      .from('global_ai_chats')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (userId) query = query.eq('user_id', userId);
    if (q) query = query.ilike('content', `%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ messages: data || [] });
  } catch (e) {
    console.error('ai-admin chats error:', e);
    return res.status(500).json({ error: 'Failed to load chat history' });
  }
});

// List distinct users with chat activity
router.get('/chat-users', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('global_ai_chats')
      .select('user_id')
      .not('user_id', 'is', null);
    if (error) throw error;
    const unique = Array.from(new Set((data || []).map(r => r.user_id))).filter(Boolean);
    // Try to enrich with user emails if available
    const enriched = [];
    if (unique.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', unique);
      const map = new Map((users || []).map(u => [u.id, u]));
      for (const id of unique) {
        const u = map.get(id);
        enriched.push({ id, email: u?.email || null, name: [u?.first_name, u?.last_name].filter(Boolean).join(' ') || null });
      }
    }
    return res.json({ users: enriched });
  } catch (e) {
    console.error('ai-admin chat-users error:', e);
    return res.status(500).json({ error: 'Failed to load chat users' });
  }
});

// Overrides
router.get('/overrides', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('ai_prompt_overrides').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ overrides: data || [] });
  } catch (e) {
    console.error('ai-admin overrides list error:', e);
    return res.status(500).json({ error: 'Failed to list overrides' });
  }
});

router.post('/overrides', async (req, res) => {
  try {
    const { id, scope = 'global', key, value } = req.body || {};
    if (!key || typeof value !== 'string') return res.status(400).json({ error: 'key and value required' });
    let resp;
    if (id) {
      resp = await supabase.from('ai_prompt_overrides').update({ scope, key, value, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
    } else {
      resp = await supabase.from('ai_prompt_overrides').insert({ scope, key, value }).select('*').single();
    }
    if (resp.error) throw resp.error;
    return res.json({ override: resp.data });
  } catch (e) {
    console.error('ai-admin overrides save error:', e);
    return res.status(500).json({ error: 'Failed to save override' });
  }
});

router.delete('/overrides/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase.from('ai_prompt_overrides').delete().eq('id', id);
    if (error) throw error;
    return res.json({ deleted: true });
  } catch (e) {
    console.error('ai-admin overrides delete error:', e);
    return res.status(500).json({ error: 'Failed to delete override' });
  }
});

// Usage summary
router.get('/usage/summary', async (_req, res) => {
  try {
    const agg = await supabase
      .from('ai_usage')
      .select('input_tokens, output_tokens, cost_usd, model, created_at');
    const rows = agg.data || [];
    const summary = rows.reduce((acc, r) => {
      acc.total_input_tokens += Number(r.input_tokens || 0);
      acc.total_output_tokens += Number(r.output_tokens || 0);
      acc.total_cost_usd += Number(r.cost_usd || 0);
      return acc;
    }, { total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 });
    return res.json({ summary, count: rows.length });
  } catch (e) {
    console.error('ai-admin usage summary error:', e);
    return res.status(500).json({ error: 'Failed to load usage' });
  }
});

module.exports = router;


