const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');

// Lazy import for ESM-only OpenAI SDK
let OpenAIClass = null;
const getOpenAI = async () => {
  if (OpenAIClass) return OpenAIClass;
  try {
    const mod = await import('openai');
    OpenAIClass = mod.default || mod.OpenAI || mod;
  } catch (e) {
    console.error('Failed to import OpenAI SDK:', e?.message || e);
    throw e;
  }
  return OpenAIClass;
};

// Lazy import for LangChain bits (ESM)
let LangChainCache = null;
async function getLangChainDeps() {
  if (LangChainCache) return LangChainCache;
  try {
    const [openaiMod, cheerioMod, splittersMod] = await Promise.all([
      import('@langchain/openai'),
      import('@langchain/community/document_loaders/web/cheerio'),
      import('@langchain/textsplitters')
    ]);
    LangChainCache = {
      OpenAIEmbeddings: openaiMod.OpenAIEmbeddings,
      CheerioWebBaseLoader: cheerioMod.CheerioWebBaseLoader,
      RecursiveCharacterTextSplitter: splittersMod.RecursiveCharacterTextSplitter,
    };
  } catch (e) {
    console.error('Failed to import LangChain modules:', e?.message || e);
    throw e;
  }
  return LangChainCache;
}

router.use(authenticate);

function chunkText(text, maxChars = 1200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const slice = text.slice(i, i + maxChars);
    chunks.push(slice);
    i += maxChars;
  }
  return chunks;
}

// POST /api/rag/index-school { schoolId, bucket?, maxFiles? }
router.post('/index-school', async (req, res) => {
  try {
    const { schoolId, bucket = 'school-ai', maxFiles, startBackground, path } = req.body || {};
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

    const { data: files, error: listErr } = await supabase.storage.from(bucket).list(`${schoolId}`, { limit: 1000 });
    if (listErr) throw listErr;

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    const OpenAI = await getOpenAI();
    const client = new OpenAI({ apiKey });

    // Filter non-hidden and optionally limit for serverless timeouts
    let list = Array.isArray(files) ? files.filter(it => it && it.name && !String(it.name).startsWith('.')) : [];

    // If a specific path is provided, target only that file
    let singlePathKey = null;
    if (path) {
      const normalized = String(path).startsWith(`${schoolId}/`)
        ? String(path)
        : `${schoolId}/${String(path).replace(/^\/+/, '')}`;
      const fname = normalized.split('/').pop();
      singlePathKey = normalized;
      list = fname ? [{ name: fname }] : [];
    }
    const defaultLimit = process.env.VERCEL ? 10 : list.length;
    const limit = typeof maxFiles === 'number' && maxFiles > 0 ? maxFiles : defaultLimit;
    const toProcess = list.slice(0, Math.min(limit, list.length));

    // If on serverless and background requested, queue items into rag_queue and return 202
    if (process.env.VERCEL && (startBackground !== false)) {
      try {
        // Create job as queued
        const jobIns = await supabase
          .from('rag_jobs')
          .insert({ school_id: schoolId, job_type: 'files', status: 'queued', processed_count: 0, total_count: toProcess.length, meta: path ? { path, bucket } : {} })
          .select('id')
          .single();
        const jobId = jobIns?.data?.id || null;

        // Create queue items
        const queueRows = toProcess.map((f) => ({
          job_id: jobId,
          school_id: schoolId,
          item_type: 'file',
          payload: { path: (path ? (String(path).startsWith(`${schoolId}/`) ? String(path) : `${schoolId}/${String(path).replace(/^\/+/, '')}`) : `${schoolId}/${f.name}`), bucket },
          status: 'queued'
        }));
        if (queueRows.length > 0) {
          await supabase.from('rag_queue').insert(queueRows);
        }
        // Optionally nudge worker (best-effort)
        const workerUrl = (process.env.SUPABASE_URL || '').replace(/\/?$/, '') + '/functions/v1/rag-queue-worker?limit=3';
        fetch(workerUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));

        res.set('X-Background-Queued', '1');
        return res.status(202).json({ queued: true, jobId, total: toProcess.length });
      } catch (_) {}
    }

    // Foreground job tracking
    let jobId = null;
    try {
      const jobRes = await supabase
        .from('rag_jobs')
        .insert({ school_id: schoolId, job_type: 'files', status: 'running', processed_count: 0, total_count: toProcess.length })
        .select('id')
        .single();
      jobId = jobRes?.data?.id || null;
    } catch (_) {}

    let indexed = 0;
    let processedCount = 0;
    for (const f of toProcess) {
      const fileKey = singlePathKey || `${schoolId}/${f.name}`;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileKey);
      const url = urlData?.publicUrl;
      if (!url) continue;
      try {
        // Fetch with a soft timeout to avoid hanging
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 20000);
        const resp = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timeout));
        const ct = String(resp.headers.get('content-type') || '');
        const lowerName = String(f.name || '').toLowerCase();
        const ext = lowerName.includes('.') ? lowerName.split('.').pop() : '';
        const isPdf = /application\/pdf/i.test(ct) || ext === 'pdf';
        let text = '';
        if (isPdf) {
          try {
            const buf = Buffer.from(await resp.arrayBuffer());
            const pdfParse = (await import('pdf-parse')).default;
            const parsed = await pdfParse(buf);
            text = String(parsed.text || '').trim();
          } catch (e) {
            // Fallback to naive text extraction
            try { text = await resp.text(); } catch (_) { text = ''; }
          }
        } else if (/^text\//i.test(ct) || ['txt','md','csv','json'].includes(ext)) {
          text = await resp.text();
        } else {
          // Best-effort fallback: try text(); if it's binary it will be filtered below
          try { text = await resp.text(); } catch (_) { text = ''; }
        }
        text = (text || '').replace(/\u0000/g, ' ').trim();
        if (!text) {
          console.warn('[RAG:index-school] No parsable text for', f.name, 'ct=', ct, 'ext=', ext);
          continue;
        }

        // Idempotent: clear existing rows for this file
        await supabase
          .from('school_ai_documents')
          .delete()
          .eq('school_id', schoolId)
          .eq('file_path', fileKey);

        const chunks = chunkText(text);
        for (let idx = 0; idx < chunks.length; idx++) {
          const piece = chunks[idx];
          const emb = await client.embeddings.create({ model: 'text-embedding-3-small', input: piece });
          const vector = emb.data?.[0]?.embedding;
          if (!vector) continue;
          const { error: insErr } = await supabase
            .from('school_ai_documents')
            .insert({ school_id: schoolId, file_path: fileKey, chunk_index: idx, content: piece, embedding: vector });
          if (!insErr) indexed++;
        }
        processedCount++;
        if (jobId) {
          await supabase
            .from('rag_jobs')
            .update({ processed_count: processedCount })
            .eq('id', jobId);
        }
      } catch (e) {
        console.warn('[RAG:index-school] failed for', f.name, e?.message || e);
        processedCount++;
        if (jobId) {
          await supabase
            .from('rag_jobs')
            .update({ processed_count: processedCount })
            .eq('id', jobId);
        }
      }
    }
    if (jobId) {
      await supabase
        .from('rag_jobs')
        .update({ status: 'completed', processed_count: processedCount, finished_at: new Date().toISOString() })
        .eq('id', jobId);
    }
    res.json({ indexed, processedFiles: toProcess.length, totalFiles: list.length, jobId });
  } catch (e) {
    console.error('rag index-school error:', e);
    try {
      if (jobId) {
        await supabase
          .from('rag_jobs')
          .update({ status: 'error', finished_at: new Date().toISOString() })
          .eq('id', jobId);
      }
    } catch (_) {}
    res.status(500).json({ error: 'Failed to index documents' });
  }
});

// POST /api/rag/ask { schoolId, question }
router.post('/ask', async (req, res) => {
  try {
    const { schoolId, question } = req.body || {};
    if (!schoolId || !question) return res.status(400).json({ error: 'schoolId and question required' });
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    const hasOpenAI = Boolean(apiKey);
    let client = null;
    if (hasOpenAI) {
      const OpenAI = await getOpenAI();
      client = new OpenAI({ apiKey });
    }

    let contexts = [];
    // Load school-specific config
    let cfg = { mode: 'hybrid', k: 12, threshold: 0.7, model: process.env.OPENAI_RAG_MODEL || 'gpt-4.1', temperature: 0.2 };
    try {
      const { data: set } = await supabase
        .from('school_ai_settings')
        .select('config')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (set?.config && typeof set.config === 'object') {
        cfg = { ...cfg, ...set.config };
      }
    } catch (_) {}
    if (hasOpenAI) {
      const qEmb = await client.embeddings.create({ model: 'text-embedding-3-small', input: question });
      const vector = qEmb.data?.[0]?.embedding;
      if (!vector) return res.status(500).json({ error: 'Failed to embed question' });
      const resp = await supabase.rpc('match_school_docs', { query_embedding: vector, in_school_id: schoolId, match_count: Math.max(1, Number(cfg.k||12)), similarity_threshold: Math.max(0, Math.min(1, Number(cfg.threshold||0.7))) });
      if (resp.error) throw resp.error;
      contexts = resp.data || [];
      // If no contexts found, fall back to recent chunks
      if (!Array.isArray(contexts) || contexts.length === 0) {
        const { data } = await supabase
          .from('school_ai_documents')
          .select('file_path, chunk_index, content')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(5);
        contexts = data || [];
      }
    } else {
      // Fallback: show most recent chunks if OpenAI key is missing
      const { data } = await supabase
        .from('school_ai_documents')
        .select('file_path, chunk_index, content')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(5);
      contexts = data || [];
    }

    const contextText = (contexts || []).map(c => `Source: ${c.file_path} [${c.chunk_index}]\n${c.content}`).join('\n\n---\n\n');

    // Fetch school-specific instructions (if any)
    let special = '';
    try {
      const { data: settings } = await supabase
        .from('school_ai_settings')
        .select('instructions')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (settings && settings.instructions) {
        special = String(settings.instructions).trim();
      }
    } catch (_) {}

    let answer = '';
    if (hasOpenAI) {
      const strict = String(cfg.mode||'hybrid') === 'strict';
      const hybrid = String(cfg.mode||'hybrid') === 'hybrid';
      const sys = `${special ? `Guidelines: ${special}\n\n` : ''}${strict ? 'Answer only from the provided context.' : hybrid ? 'Prefer the provided context; if incomplete, add general best practices and next steps.' : 'Be a helpful assistant; use context when available.'} Synthesize an answer using relevant snippets (from multiple documents if needed). Cite inline [file:chunk] and include a short Sources list. Keep answers concise and student-friendly.`.trim();
      // Validate model selection to avoid typos/unwanted models
      const allowedModels = new Set([
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4o',
        'gpt-4o-mini'
      ]);
      const requestedModel = String(cfg.model || process.env.OPENAI_RAG_MODEL || 'gpt-4.1');
      const ragModel = allowedModels.has(requestedModel) ? requestedModel : 'gpt-4.1';
      const completion = await client.chat.completions.create({
        model: ragModel,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Context:\n${contextText}\n\nQuestion: ${question}` }
        ],
        temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.2,
        max_tokens: 400,
      });
      answer = completion.choices?.[0]?.message?.content?.trim() || '';
    } else {
      // Fallback: surface the top context snippets directly
      const snippet = (contexts || []).map(c => c.content).join('\n\n---\n\n').slice(0, 1200);
      answer = snippet || 'I found documents for this school, but the AI service is temporarily unavailable.';
    }
    // Store transcript
    // include user_id if available from auth middleware
    const uid = req.user?.id || null;
    await supabase.from('school_ai_chats').insert([
      { school_id: schoolId, role: 'user', content: question, user_id: uid },
      { school_id: schoolId, role: 'assistant', content: answer, user_id: uid },
    ]);
    res.json({ answer, contexts });
  } catch (e) {
    console.error('rag ask error:', e);
    res.status(500).json({ error: 'Failed to answer question' });
  }
});

module.exports = router;

// DELETE FILE: POST /api/rag/delete-file { schoolId, fileName, bucket? }
router.post('/delete-file', async (req, res) => {
  try {
    const { schoolId, fileName, bucket = 'school-ai' } = req.body || {};
    if (!schoolId || !fileName) return res.status(400).json({ error: 'schoolId and fileName required' });

    // Remove from storage
    const { error: delErr } = await supabase.storage.from(bucket).remove([`${schoolId}/${fileName}`]);
    if (delErr) throw delErr;

    // Remove embeddings rows
    const { error: dbErr } = await supabase
      .from('school_ai_documents')
      .delete()
      .eq('school_id', schoolId)
      .eq('file_path', `${schoolId}/${fileName}`);
    if (dbErr) throw dbErr;

    res.json({ deleted: true });
  } catch (e) {
    console.error('rag delete-file error:', e);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Initialize bucket (admin)
// POST /api/rag/init-bucket { bucket }
router.post('/init-bucket', async (req, res) => {
  try {
    const { bucket = 'school-ai' } = req.body || {};
    // Try create; ignore if exists
    await supabase.storage.createBucket(bucket, { public: true }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
    await supabase.storage.updateBucket(bucket, { 
      public: true,
      // allow common doc types up to 50MB
      fileSizeLimit: '52428800',
      allowedMimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/markdown'
      ]
    }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
    // Write a test .keep to verify permissions
    const buf = Buffer.from('keep');
    await supabase.storage.from(bucket).upload('test/.keep', buf, { upsert: true, contentType: 'text/plain' }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
    res.json({ ok: true });
  } catch (e) {
    console.error('rag init-bucket error:', e);
    res.status(500).json({ error: 'Failed to init bucket' });
  }
});

// Create a signed upload URL so clients can upload without storage policies
// POST /api/rag/signed-upload { schoolId, filename, bucket? }
router.post('/signed-upload', async (req, res) => {
  try {
    const { schoolId, filename, bucket = 'school-ai' } = req.body || {};
    if (!schoolId || !filename) return res.status(400).json({ error: 'schoolId and filename required' });
    // Ensure bucket exists/public (best-effort)
    await supabase.storage.createBucket(bucket, { public: true }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
    await supabase.storage.updateBucket(bucket, { public: true }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
  const ext = filename.includes('.') ? filename.split('.').pop() : 'bin';
  const baseRaw = filename.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  const baseSanitized = baseRaw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const path = `${schoolId}/${baseSanitized}__${unique}.${ext}`;
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error) throw error;
    res.json({ path, token: data?.token, signedUrl: data?.signedUrl });
  } catch (e) {
    console.error('signed-upload error:', e);
    res.status(500).json({ error: 'Failed to create signed upload' });
  }
});

// List files in a school's AI folder (uses service key; bypasses client RLS)
// POST /api/rag/list-files { schoolId, bucket? }
router.post('/list-files', async (req, res) => {
  try {
    const { schoolId, bucket = 'school-ai' } = req.body || {};
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

    const debugRequested = String(req.query.debug || '').toLowerCase() === 'true' || req.query.debug === '1';
    const folder = String(schoolId).replace(/^\/+|\/+$/g, '');
    const variantsTried = [];

    console.info('[RAG:list-files] start', {
      bucket,
      folder,
      user: req.user ? { id: req.user.id, role: req.user.role, tokenType: req.user.tokenType } : 'none',
      supabaseUrlHost: (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('/')?.[0] || 'unset'
    });

    // Ensure bucket exists/public (best-effort)
    try {
      await supabase.storage.createBucket(bucket, { public: true }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
      await supabase.storage.updateBucket(bucket, { public: true }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
    } catch (e) {
      console.warn('[RAG:list-files] bucket ensure public failed:', e?.message || e);
    }

    // Try multiple list variants to avoid path quirks
    const tryList = async (path, withSort = true) => {
      let data, error;
      try {
        const opts = { limit: 1000 };
        if (withSort) opts.sortBy = { column: 'name', order: 'asc' };
        const resp = await supabase.storage.from(bucket).list(path, opts);
        data = resp.data; error = resp.error;
      } catch (e) {
        error = e;
      }
      variantsTried.push({ path, withSort, count: (data || []).length, error: error ? (error.message || String(error)) : null });
      return { data, error };
    };

    // Recursively list files up to depth 2 (folder -> subfolders)
    const collectFiles = async (basePath, depth = 2) => {
      const results = [];
      const candidates = [basePath, `${basePath}/`];
      for (const p of candidates) {
        const primary = await tryList(p, true);
        const list = (primary.data && primary.data.length > 0)
          ? primary
          : await tryList(p, false);
        const items = list.data || [];
        for (const it of items) {
          const isFolder = !it.metadata || typeof it.metadata?.size !== 'number';
          const currentPath = `${basePath}/${it.name}`.replace(/\/+/, '/');
          if (isFolder && depth > 0) {
            const nested = await collectFiles(currentPath, depth - 1);
            results.push(...nested);
          } else if (!isFolder) {
            // filter out hidden placeholders
            if (it.name.startsWith('.')) continue;
            const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(currentPath);
            results.push({
              name: it.name,
              path: currentPath,
              url: urlData?.publicUrl || null,
              created_at: it.created_at || null,
              updated_at: it.updated_at || null,
              size: it.metadata?.size ?? null,
            });
          }
        }
        // If we successfully listed with one candidate, do not try the other for this level
        if (items.length > 0) break;
      }
      return results;
    };

    const files = await collectFiles(folder, 2);

    // Augment with indexing status from embeddings table
    try {
      const paths = files.map(f => f.path).filter(Boolean);
      if (paths.length > 0) {
        // Fetch embedded chunks for these file paths
        const { data: embRows, error: embErr } = await supabase
          .from('school_ai_documents')
          .select('file_path')
          .eq('school_id', folder)
          .in('file_path', paths);
        if (!embErr && Array.isArray(embRows)) {
          const counts = new Map();
          for (const r of embRows) {
            const k = r.file_path;
            counts.set(k, (counts.get(k) || 0) + 1);
          }
          for (const f of files) {
            const c = counts.get(f.path) || 0;
            f.embedding_chunks = c;
            f.chunks = c; // alias for older frontends expecting `chunks`
            f.indexed = c > 0;
          }
        }
      }
    } catch (e) {
      console.warn('[RAG:list-files] embedding annotate failed:', e?.message || e);
    }

    // Include the latest job for files, similar to links
    let job = null;
    try {
      const j = await supabase
        .from('rag_jobs')
        .select('id, job_type, status, processed_count, total_count, created_at, finished_at')
        .eq('school_id', folder)
        .eq('job_type', 'files')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      job = j?.data || null;
    } catch (_) {}

    console.info('[RAG:list-files] result', { count: files.length, names: files.map(f => f.name) });

    if (debugRequested) {
      return res.json({
        files,
        debug: {
          bucket,
          folder,
          variantsTried,
          supabaseUrlHost: (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('/')?.[0] || 'unset'
        },
        job
      });
    }

    res.json({ files, job });
  } catch (e) {
    console.error('list-files error:', e);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// ========== LINKS MANAGEMENT ==========

// List links for a school
// POST /api/rag/links/list { schoolId }
router.post('/links/list', async (req, res) => {
  try {
    const { schoolId } = req.body || {};
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });
    const { data, error } = await supabase
      .from('school_ai_links')
      .select('id, url, title, status, last_crawled_at, created_at')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    // Additionally, include any running job progress for this school
    let job = null;
    try {
      const j = await supabase
        .from('rag_jobs')
        .select('id, status, processed_count, total_count, created_at, finished_at')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      job = j?.data || null;
    } catch (_) {}
    if (error) throw error;
    res.json({ links: data || [], job });
  } catch (e) {
    console.error('links/list error:', e);
    res.status(500).json({ error: 'Failed to list links' });
  }
});

// Replace all links for a school (bulk set)
// POST /api/rag/links/bulk-upsert { schoolId, urls: string[] }
router.post('/links/bulk-upsert', async (req, res) => {
  try {
    const { schoolId, urls } = req.body || {};
    if (!schoolId || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'schoolId and urls[] required' });
    }
    // Normalize and filter
    const unique = Array.from(new Set(urls.map((u) => String(u || '').trim()).filter(Boolean)));
    // Replace strategy: delete existing then insert new
    await supabase.from('school_ai_links').delete().eq('school_id', schoolId);
    if (unique.length > 0) {
      const rows = unique.map((u) => ({ school_id: schoolId, url: u, status: 'pending' }));
      const { error } = await supabase.from('school_ai_links').insert(rows);
      if (error) throw error;
    }
    res.json({ saved: unique.length });
  } catch (e) {
    console.error('links/bulk-upsert error:', e);
    res.status(500).json({ error: 'Failed to save links' });
  }
});

// Delete one link
// POST /api/rag/links/delete { schoolId, url }
router.post('/links/delete', async (req, res) => {
  try {
    const { schoolId, url } = req.body || {};
    if (!schoolId || !url) return res.status(400).json({ error: 'schoolId and url required' });
    const { error } = await supabase
      .from('school_ai_links')
      .delete()
      .eq('school_id', schoolId)
      .eq('url', url);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (e) {
    console.error('links/delete error:', e);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Index links using LangChain loaders + OpenAIEmbeddings
// POST /api/rag/index-links { schoolId, urls?, maxLinks?, timeoutMs? }
router.post('/index-links', async (req, res) => {
  try {
    const { schoolId, urls, maxLinks, timeoutMs, startBackground } = req.body || {};
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

    const { OpenAIEmbeddings, CheerioWebBaseLoader, RecursiveCharacterTextSplitter } = await getLangChainDeps();
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    // Resolve URLs to index
    let linkRows = [];
    if (Array.isArray(urls) && urls.length > 0) {
      linkRows = urls.map((u) => ({ url: String(u).trim() })).filter((r) => r.url);
    } else {
      const { data } = await supabase
        .from('school_ai_links')
        .select('url, status, created_at')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });
      linkRows = (data || []).map((d) => ({ url: d.url, status: d.status }));
    }

    // Apply limits to avoid serverless timeouts
    const isServerless = Boolean(process.env.VERCEL);
    const defaultMax = isServerless ? 1 : linkRows.length;
    const limit = typeof maxLinks === 'number' && maxLinks > 0 ? maxLinks : defaultMax;
    linkRows = linkRows.slice(0, Math.min(limit, linkRows.length));

    const perLinkTimeoutMs = Math.max(3000, Math.min(15000, Number(timeoutMs) || (isServerless ? 8000 : 15000)));

    const embeddings = new OpenAIEmbeddings({ apiKey, model: 'text-embedding-3-small' });
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1200, chunkOverlap: 150 });

    // If on serverless, queue link items into rag_queue and return 202
    if (process.env.VERCEL && (startBackground !== false)) {
      try {
        const jobIns = await supabase
          .from('rag_jobs')
          .insert({ school_id: schoolId, job_type: 'links', status: 'queued', processed_count: 0, total_count: linkRows.length })
          .select('id')
          .single();
        const jobId = jobIns?.data?.id || null;
        if (linkRows.length > 0) {
          const rows = linkRows.map(r => ({ job_id: jobId, school_id: schoolId, item_type: 'link', payload: { url: r.url }, status: 'queued' }));
          await supabase.from('rag_queue').insert(rows);
        }
        // Nudge the worker (best-effort)
        const workerUrl = (process.env.SUPABASE_URL || '').replace(/\/?$/, '') + '/functions/v1/rag-queue-worker?limit=3';
        fetch(workerUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
        res.set('X-Background-Queued', '1');
        return res.status(202).json({ queued: true, jobId, total: linkRows.length });
      } catch (_) {
        // fall through to foreground processing
      }
    }

    let totalDocs = 0;
    for (const row of linkRows) {
      const url = row.url;
      if (!/^https?:\/\//i.test(url)) continue;
      try {
        // Mark as indexing
        await supabase
          .from('school_ai_links')
          .update({ status: 'indexing', last_crawled_at: new Date().toISOString() })
          .eq('school_id', schoolId)
          .eq('url', url);

        // Prefer Cheerio loader; fallback to raw fetch
        let docs = [];
        try {
          const loader = new CheerioWebBaseLoader(url);
          // Cheerio loader doesn't expose timeout; fallback if it takes too long
          const loaderPromise = loader.load();
          const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('Loader timeout')), perLinkTimeoutMs));
          docs = await Promise.race([loaderPromise, timeoutPromise]).catch(() => []);
        } catch (e) {
          docs = [];
        }
        let text = '';
        if (Array.isArray(docs) && docs.length > 0) {
          text = docs.map((d) => String(d.pageContent || '')).join('\n\n');
        }
        if (!text) {
          // Raw fetch with timeout
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), perLinkTimeoutMs);
          const resp = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
          const ct = String(resp.headers.get('content-type') || '');
          if (/application\/pdf/i.test(ct)) {
            try {
              const buf = Buffer.from(await resp.arrayBuffer());
              const pdfParse = (await import('pdf-parse')).default;
              const parsed = await pdfParse(buf);
              text = String(parsed.text || '').trim();
            } catch (_) {
              text = await resp.text();
            }
          } else {
            text = await resp.text();
          }
        }
        text = (text || '').replace(/\u0000/g, ' ').trim();
        if (!text) continue;

        // Remove old rows for this URL for idempotency
        await supabase
          .from('school_ai_documents')
          .delete()
          .eq('school_id', schoolId)
          .eq('file_path', url);

        // Chunk using splitter
        const chunks = await splitter.splitText(text);

        // Embed in small batches to respect rate limits
        const batchSize = 15;
        let chunkIndex = 0;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const slice = chunks.slice(i, i + batchSize);
          const vectors = await embeddings.embedDocuments(slice);
          const rows = vectors.map((vec, j) => ({
            school_id: schoolId,
            file_path: url,
            chunk_index: chunkIndex + j,
            content: slice[j],
            embedding: vec,
          }));
          const { error: insErr } = await supabase.from('school_ai_documents').insert(rows);
          if (insErr) throw insErr;
          chunkIndex += slice.length;
          totalDocs += slice.length;
        }

        await supabase
          .from('school_ai_links')
          .update({ status: 'indexed', last_crawled_at: new Date().toISOString() })
          .eq('school_id', schoolId)
          .eq('url', url);
      } catch (e) {
        console.warn('Index link failed:', url, e?.message || e);
        await supabase
          .from('school_ai_links')
          .update({ status: 'error', last_crawled_at: new Date().toISOString() })
          .eq('school_id', schoolId)
          .eq('url', url);
      }
    }

    res.json({ indexed: totalDocs, processedLinks: linkRows.length });
  } catch (e) {
    console.error('index-links error:', e);
    res.status(500).json({ error: 'Failed to index links' });
  }
});

// Lightweight enqueue endpoints so the frontend doesn't 404 on older builds
// POST /api/rag/enqueue/file { schoolId, path, bucket? }
router.post('/enqueue/file', async (req, res) => {
  try {
    const { schoolId, path, bucket = 'school-ai' } = req.body || {};
    if (!schoolId || !path) return res.status(400).json({ error: 'schoolId and path required' });

    // Create a queued job + queue item
    let jobId = null;
    try {
      const jobRes = await supabase
        .from('rag_jobs')
        .insert({ school_id: schoolId, job_type: 'files', status: 'queued', processed_count: 0, total_count: 1, meta: { path, bucket } })
        .select('id')
        .single();
      jobId = jobRes?.data?.id || null;
    } catch (_) {}

    try {
      const fullPath = String(path).startsWith(`${schoolId}/`) ? String(path) : `${schoolId}/${String(path).replace(/^\/+/, '')}`;
      await supabase.from('rag_queue').insert({ job_id: jobId, school_id: schoolId, item_type: 'file', payload: { path: fullPath, bucket }, status: 'queued' });
    } catch (_) {}

    // Nudge worker
    try {
      const workerUrl = (process.env.SUPABASE_URL || '').replace(/\/?$/, '') + '/functions/v1/rag-queue-worker?limit=3';
      fetch(workerUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
    } catch (_) {}

    res.set('X-Background-Queued', '1');
    return res.status(202).json({ queued: true, jobId });
  } catch (e) {
    console.error('enqueue/file error:', e);
    return res.status(500).json({ error: 'Failed to enqueue file' });
  }
});

// POST /api/rag/enqueue/link { schoolId, url }
router.post('/enqueue/link', async (req, res) => {
  try {
    const { schoolId, url } = req.body || {};
    if (!schoolId || !url) return res.status(400).json({ error: 'schoolId and url required' });

    // Ensure link row exists and mark pending
    try {
      const norm = String(url).trim();
      // Upsert-like behavior
      await supabase.from('school_ai_links').delete().eq('school_id', schoolId).eq('url', norm);
      await supabase.from('school_ai_links').insert({ school_id: schoolId, url: norm, status: 'pending' });
    } catch (_) {}

    // Create a queued job row
    let jobId = null;
    try {
      const jobRes = await supabase
        .from('rag_jobs')
        .insert({ school_id: schoolId, job_type: 'links', status: 'queued', processed_count: 0, total_count: 1, meta: { url } })
        .select('id')
        .single();
      jobId = jobRes?.data?.id || null;
    } catch (_) {}

    // Insert queue item
    try {
      await supabase.from('rag_queue').insert({ job_id: jobId, school_id: schoolId, item_type: 'link', payload: { url }, status: 'queued' });
    } catch (_) {}

    // Nudge worker
    try {
      const workerUrl = (process.env.SUPABASE_URL || '').replace(/\/?$/, '') + '/functions/v1/rag-queue-worker?limit=3';
      fetch(workerUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).catch((err) => console.warn('Operation failed (non-critical):', err?.message || err));
    } catch (_) {}

    res.set('X-Background-Queued', '1');
    return res.status(202).json({ queued: true, jobId });
  } catch (e) {
    console.error('enqueue/link error:', e);
    return res.status(500).json({ error: 'Failed to enqueue link' });
  }
});

// POST /api/rag/queue/summary { schoolId }
router.post('/queue/summary', async (req, res) => {
  try {
    const { schoolId } = req.body || {};
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

    // Pull counts from rag_queue directly
    let queued = 0, running = 0, done = 0, error = 0;
    try {
      const { data: qrows } = await supabase
        .from('rag_queue')
        .select('status', { count: 'exact' })
        .eq('school_id', schoolId);
      (qrows || []).forEach(r => {
        if (r.status === 'queued') queued += 1;
        else if (r.status === 'running') running += 1;
        else if (r.status === 'done') done += 1;
        else if (r.status === 'error') error += 1;
      });
    } catch (_) {}

    return res.json({ summary: { queued, running, done, error } });
  } catch (e) {
    console.error('queue/summary error:', e);
    return res.status(500).json({ error: 'Failed to load queue summary' });
  }
});


