const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');
const { listS3Objects, getS3ObjectBuffer } = require('../services/s3Client');
const { embedText } = require('../services/bedrockEmbeddings');
const { ensureKnnIndex, bulkIndex, deleteBySource, knnSearch } = require('../services/openSearchClient');

router.use(authenticate);
router.use(authorize(PERMISSIONS.MANAGE_AI));

const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getS3Client } = require('../services/s3Client');

// GET /api/kb/diag
// Basic environment checks (no secrets) to debug production wiring.
router.get('/diag', async (_req, res) => {
  const missing = [];
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) missing.push('AWS_REGION');
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!process.env.OPENSEARCH_ENDPOINT) missing.push('OPENSEARCH_ENDPOINT');
  if (!process.env.OPENSEARCH_INDEX) missing.push('OPENSEARCH_INDEX');
  return res.json({
    ok: missing.length === 0,
    missing,
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || null,
    opensearchConfigured: Boolean(process.env.OPENSEARCH_ENDPOINT && process.env.OPENSEARCH_INDEX),
    embeddingsProvider: process.env.EMBEDDINGS_PROVIDER || null,
    bedrockEmbedModel: process.env.BEDROCK_EMBED_MODEL_ID || 'amazon.titan-embed-text-v2:0',
  });
});

function ensurePrefix(p) {
  const s = String(p || '').replace(/^\/+/, '');
  return s.endsWith('/') ? s : `${s}/`;
}

function replaceExt(name, extWithDot) {
  const n = String(name || '');
  const idx = n.lastIndexOf('.');
  if (idx <= 0) return `${n}${extWithDot}`;
  return `${n.slice(0, idx)}${extWithDot}`;
}

async function putS3Object({ bucket, key, body, contentType }) {
  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  }));
}

function sanitizeFilename(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'document';
  // keep extension if present
  const parts = raw.split('.');
  const ext = parts.length > 1 ? parts.pop() : '';
  const base = parts.join('.')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
  return ext ? `${base}.${ext.toLowerCase()}` : base;
}

function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '127.0.0.1' || h === '0.0.0.0') return true;
  if (h === '::1') return true;
  // naive private ranges by prefix
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

function chunkText(text, maxChars = 1200) {
  const chunks = [];
  const clean = String(text || '').replace(/\u0000/g, ' ').trim();
  if (!clean) return chunks;
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + maxChars));
    i += maxChars;
  }
  return chunks;
}

function sniffType(key, contentType) {
  const k = String(key || '').toLowerCase();
  if (String(contentType || '').toLowerCase().includes('pdf') || k.endsWith('.pdf')) return 'pdf';
  if (k.endsWith('.html') || k.endsWith('.htm')) return 'html';
  if (k.endsWith('.md') || k.endsWith('.txt') || k.endsWith('.json') || k.endsWith('.csv')) return 'text';
  return 'unknown';
}

async function extractTextFromBuffer(buf, kind) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  if (!b.length) return '';

  if (kind === 'pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(b);
      return String(parsed?.text || '').trim();
    } catch (_) {
      // fall through to naive decode
    }
  }

  const asText = b.toString('utf-8');
  if (kind === 'html') {
    try {
      const cheerio = require('cheerio');
      const $ = cheerio.load(asText);
      const text = $('body').text();
      return String(text || '').replace(/\s+/g, ' ').trim();
    } catch (_) {
      return String(asText || '').replace(/\s+/g, ' ').trim();
    }
  }

  return String(asText || '').trim();
}

function extractLinksFromHtml(html, baseUrl) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(String(html || ''));
    const links = new Set();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const u = new URL(href, baseUrl);
        if (!/^https?:$/.test(u.protocol)) return;
        u.hash = '';
        links.add(u.toString());
      } catch (_) {}
    });
    return Array.from(links);
  } catch (_) {
    return [];
  }
}

/**
 * POST /api/kb/signed-upload
 * Body:
 * - bucket: S3 bucket name
 * - prefix: S3 prefix (e.g. "kb/global/")
 * - filename: original filename
 * - contentType?: optional
 */
router.post('/signed-upload', async (req, res) => {
  try {
    const { bucket, prefix, filename, contentType } = req.body || {};
    if (!bucket || !prefix || !filename) return res.status(400).json({ error: 'bucket, prefix, filename are required' });
    const safeName = sanitizeFilename(filename);
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const key = `${String(prefix).replace(/^\/+/, '').replace(/\/?$/, '/')}${safeName.replace(/(\.[a-z0-9]+)$/i, `__${unique}$1`)}`;

    const s3 = getS3Client();
    const url = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    }), { expiresIn: 60 * 10 });

    return res.json({ bucket, key, signedUrl: url });
  } catch (e) {
    console.error('kb signed-upload error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to create signed upload' });
  }
});

/**
 * POST /api/kb/crawl
 * Limited crawler → stores raw HTML into S3 rawPrefix.
 */
router.post('/crawl', async (req, res) => {
  try {
    const { bucket, rawPrefix, startUrls = [], maxPages = 15, maxDepth = 1, allowedHosts } = req.body || {};
    if (!bucket || !rawPrefix) return res.status(400).json({ error: 'bucket and rawPrefix are required' });
    if (!Array.isArray(startUrls) || startUrls.length === 0) return res.status(400).json({ error: 'startUrls[] required' });

    const rawP = ensurePrefix(rawPrefix);
    const limitPages = Math.max(1, Math.min(50, Number(maxPages) || 15));
    const limitDepth = Math.max(0, Math.min(4, Number(maxDepth) || 1));

    const start = [];
    const hostSet = new Set();
    for (const s of startUrls.slice(0, 10)) {
      const u = String(s || '').trim();
      if (!u) continue;
      let parsed;
      try { parsed = new URL(u); } catch (_) { continue; }
      if (!/^https?:$/.test(parsed.protocol)) continue;
      if (isPrivateHostname(parsed.hostname)) continue;
      start.push(parsed.toString());
      hostSet.add(parsed.hostname.toLowerCase());
    }
    if (start.length === 0) return res.status(400).json({ error: 'No valid startUrls (must be public http/https)' });

    const allowed = Array.isArray(allowedHosts) && allowedHosts.length
      ? new Set(allowedHosts.map(h => String(h || '').toLowerCase()).filter(Boolean))
      : hostSet;

    const queue = start.map(u => ({ url: u, depth: 0 }));
    const visited = new Set();
    const saved = [];

    while (queue.length && saved.length < limitPages) {
      const { url, depth } = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);

      let resp;
      try {
        resp = await fetch(url, { redirect: 'follow' });
      } catch (_) {
        continue;
      }
      if (!resp || !resp.ok) continue;

      const ct = String(resp.headers.get('content-type') || '');
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) continue;

      const html = Buffer.from(await resp.arrayBuffer()).toString('utf-8');
      const p = new URL(url);
      const safeHost = p.hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(0, 80);
      const safePath = (p.pathname || '/')
        .replace(/\/+$/, '/')
        .replace(/[^a-z0-9/._-]+/gi, '-')
        .replace(/\/{2,}/g, '/')
        .slice(0, 140);
      const safeBase = `${safeHost}${safePath}`.replace(/\//g, '__').replace(/_{3,}/g, '__');
      const key = `${rawP}crawl/${safeBase}__${Date.now()}.html`;

      await putS3Object({ bucket, key, body: html, contentType: 'text/html; charset=utf-8' });
      saved.push({ url, key });

      if (depth < limitDepth) {
        const links = extractLinksFromHtml(html, url);
        for (const link of links) {
          try {
            const u2 = new URL(link);
            if (!allowed.has(u2.hostname.toLowerCase())) continue;
            if (isPrivateHostname(u2.hostname)) continue;
            if (!visited.has(u2.toString())) queue.push({ url: u2.toString(), depth: depth + 1 });
          } catch (_) {}
        }
      }
    }

    return res.json({ ok: true, savedCount: saved.length, saved, visitedCount: visited.size, allowedHosts: Array.from(allowed) });
  } catch (e) {
    console.error('kb crawl error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to crawl' });
  }
});

/**
 * POST /api/kb/pipeline/run
 * rawPrefix → cleanedPrefix + curatedPrefix + OpenSearch index.
 */
router.post('/pipeline/run', async (req, res) => {
  try {
    const {
      scope = 'global',
      schoolId,
      bucket,
      rawPrefix,
      cleanedPrefix,
      curatedPrefix,
      maxFiles = 15,
    } = req.body || {};

    if (!bucket || !rawPrefix || !cleanedPrefix || !curatedPrefix) {
      return res.status(400).json({ error: 'bucket, rawPrefix, cleanedPrefix, curatedPrefix are required' });
    }
    if (scope === 'school' && !schoolId) return res.status(400).json({ error: 'schoolId is required when scope=school' });

    const rawP = ensurePrefix(rawPrefix);
    const cleanedP = ensurePrefix(cleanedPrefix);
    const curatedP = ensurePrefix(curatedPrefix);
    const limit = Math.max(1, Math.min(50, Number(maxFiles) || 15));

    const files = await listS3Objects({ bucket, prefix: rawP, maxKeys: Math.min(200, limit) });
    const targets = (files || [])
      .filter(f => f?.key && !String(f.key).endsWith('/'))
      .slice(0, limit);

    let processedRaw = 0;
    let wroteCleaned = 0;
    let wroteCurated = 0;
    let indexedChunks = 0;

    for (const f of targets) {
      const key = f.key;
      const buf = await getS3ObjectBuffer({ bucket, key });
      const kind = sniffType(key);
      const text = await extractTextFromBuffer(buf, kind);
      if (!text) continue;

      processedRaw += 1;

      const rel = String(key).startsWith(rawP) ? String(key).slice(rawP.length) : String(key).split('/').pop();
      const cleanedKey = `${cleanedP}${replaceExt(rel, '.txt')}`;
      const curatedKey = `${curatedP}${replaceExt(rel, '.jsonl')}`;

      await putS3Object({ bucket, key: cleanedKey, body: text, contentType: 'text/plain; charset=utf-8' });
      wroteCleaned += 1;

      const chunks = chunkText(text, 1200);
      const docs = [];
      const source = `s3://${bucket}/${key}`;
      try { await deleteBySource({ scope, schoolId, source }); } catch (_) {}

      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const vector = await embedText(chunk);
        await ensureKnnIndex({ dimension: vector.length });
        docs.push({
          id: `${scope}#${scope === 'school' ? String(schoolId) : 'global'}#${source}#${idx}`,
          scope,
          school_id: scope === 'school' ? String(schoolId) : undefined,
          source,
          chunk_index: idx,
          content: chunk,
          embedding: vector,
          created_at: new Date().toISOString(),
        });
      }
      if (docs.length) {
        await bulkIndex(docs);
        indexedChunks += docs.length;
      }

      const jsonl = docs.map(d => JSON.stringify({
        scope: d.scope,
        school_id: d.school_id,
        source: d.source,
        chunk_index: d.chunk_index,
        content: d.content,
        created_at: d.created_at,
      })).join('\n');
      await putS3Object({ bucket, key: curatedKey, body: jsonl, contentType: 'application/jsonl; charset=utf-8' });
      wroteCurated += 1;
    }

    return res.json({
      ok: true,
      scope,
      processedRaw,
      wroteCleaned,
      wroteCurated,
      indexedChunks,
      totalRawFiles: targets.length,
      rawPrefix: rawP,
      cleanedPrefix: cleanedP,
      curatedPrefix: curatedP,
    });
  } catch (e) {
    console.error('kb pipeline run error:', e?.message || e);
    // If OpenSearch client provides meta, include it to make 403/permission issues actionable.
    const meta = e?.meta || null;
    const status = (typeof e?.status === 'number' && e.status >= 400 && e.status < 600) ? e.status : 500;
    const msg = e?.message || 'Failed to run pipeline';
    return res.status(status === 403 ? 502 : status).json({
      error: msg,
      hint: status === 403
        ? 'OpenSearch returned 403. If using OpenSearch Serverless, ensure SigV4 service is "aoss" and the access policy allows this IAM principal.'
        : undefined,
      meta,
    });
  }
});

/**
 * POST /api/kb/list
 * Body:
 * - bucket: S3 bucket name
 * - prefix: S3 prefix
 * - maxFiles?: number
 */
router.post('/list', async (req, res) => {
  try {
    const { bucket, prefix, maxFiles = 50 } = req.body || {};
    if (!bucket || !prefix) return res.status(400).json({ error: 'bucket and prefix are required' });
    const files = await listS3Objects({ bucket, prefix, maxKeys: Math.min(200, Number(maxFiles) || 50) });

    // Add presigned GET url for convenience
    const s3 = getS3Client();
    const out = [];
    for (const f of files) {
      const key = f.key;
      if (!key || String(key).endsWith('/')) continue;
      let url = null;
      try {
        url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 * 10 });
      } catch (_) {}
      out.push({
        key,
        name: String(key).split('/').pop(),
        size: f.size || 0,
        lastModified: f.lastModified || null,
        url,
      });
    }
    return res.json({ files: out });
  } catch (e) {
    console.error('kb list error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to list files' });
  }
});

/**
 * POST /api/kb/index-url
 * Body:
 * - scope: "global" | "school"
 * - schoolId?: uuid (required if scope=school)
 * - urls: string[]
 */
router.post('/index-url', async (req, res) => {
  try {
    const { scope = 'global', schoolId, urls = [] } = req.body || {};
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls[] required' });
    if (scope === 'school' && !schoolId) return res.status(400).json({ error: 'schoolId is required when scope=school' });

    const results = [];
    for (const u of urls.slice(0, 30)) {
      const url = String(u || '').trim();
      if (!url) continue;
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http/https URLs are allowed');
        if (isPrivateHostname(parsed.hostname)) throw new Error('Blocked URL host');

        const resp = await fetch(url, { redirect: 'follow' });
        const ct = String(resp.headers.get('content-type') || '');
        const buf = Buffer.from(await resp.arrayBuffer());
        const kind = sniffType(parsed.pathname || '', ct);
        const text = await extractTextFromBuffer(buf, kind === 'unknown' ? (ct.includes('html') ? 'html' : 'text') : kind);
        if (!text) throw new Error('No text extracted');

        const source = url;
        try { await deleteBySource({ scope, schoolId, source }); } catch (_) {}

        const chunks = chunkText(text, 1200);
        const docs = [];
        for (let idx = 0; idx < chunks.length; idx++) {
          const chunk = chunks[idx];
          const vector = await embedText(chunk);
          await ensureKnnIndex({ dimension: vector.length });
          docs.push({
            id: `${scope}#${scope === 'school' ? String(schoolId) : 'global'}#${source}#${idx}`,
            scope,
            school_id: scope === 'school' ? String(schoolId) : undefined,
            source,
            chunk_index: idx,
            content: chunk,
            embedding: vector,
            created_at: new Date().toISOString(),
          });
        }
        if (docs.length > 0) await bulkIndex(docs);
        results.push({ url, ok: true, indexedChunks: docs.length });
      } catch (e) {
        results.push({ url, ok: false, error: e?.message || 'Failed' });
      }
    }

    return res.json({ results });
  } catch (e) {
    console.error('kb index-url error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to index urls' });
  }
});

/**
 * POST /api/kb/index
 * Body:
 * - scope: "global" | "school"
 * - schoolId?: uuid (required if scope=school)
 * - bucket: S3 bucket name
 * - prefix: S3 prefix
 * - maxFiles?: number
 */
router.post('/index', async (req, res) => {
  try {
    const { scope = 'global', schoolId, bucket, prefix, maxFiles = 25 } = req.body || {};
    if (!bucket || !prefix) return res.status(400).json({ error: 'bucket and prefix are required' });
    if (scope === 'school' && !schoolId) return res.status(400).json({ error: 'schoolId is required when scope=school' });

    const files = await listS3Objects({ bucket, prefix, maxKeys: Math.min(200, Number(maxFiles) || 25) });
    const filtered = files
      .filter(f => f?.key && !String(f.key).endsWith('/'))
      .slice(0, Math.min(200, Number(maxFiles) || 25));

    let processedFiles = 0;
    let indexedChunks = 0;

    for (const f of filtered) {
      const key = f.key;
      const kind = sniffType(key);
      const buf = await getS3ObjectBuffer({ bucket, key });
      const text = await extractTextFromBuffer(buf, kind);
      if (!text) continue;

      const source = `s3://${bucket}/${key}`;
      // idempotent clear in OpenSearch
      try { await deleteBySource({ scope, schoolId, source }); } catch (_) {}

      const chunks = chunkText(text, 1200);
      const docs = [];
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const vector = await embedText(chunk);
        // Ensure index exists with the right dimension (first chunk controls dimension)
        await ensureKnnIndex({ dimension: vector.length });

        docs.push({
          id: `${scope}#${scope === 'school' ? String(schoolId) : 'global'}#${source}#${idx}`,
          scope,
          school_id: scope === 'school' ? String(schoolId) : undefined,
          source,
          chunk_index: idx,
          content: chunk,
          embedding: vector,
          created_at: new Date().toISOString(),
        });
      }

      if (docs.length > 0) {
        await bulkIndex(docs);
        indexedChunks += docs.length;
      }

      processedFiles += 1;
    }

    return res.json({ processedFiles, indexedChunks, totalFiles: filtered.length });
  } catch (e) {
    console.error('kb index error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to index knowledge base' });
  }
});

/**
 * POST /api/kb/query
 * Body:
 * - scope: "global" | "school"
 * - schoolId?: uuid (required if scope=school)
 * - query: string
 * - k?: number
 * - threshold?: number (0..1)
 */
router.post('/query', async (req, res) => {
  try {
    const { scope = 'global', schoolId, query, k = 8, threshold = 0.0 } = req.body || {};
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query is required' });
    if (scope === 'school' && !schoolId) return res.status(400).json({ error: 'schoolId is required when scope=school' });

    const qVec = await embedText(query);
    await ensureKnnIndex({ dimension: qVec.length });
    const results = await knnSearch({
      scope,
      schoolId,
      vector: qVec,
      k: Math.max(1, Number(k) || 8),
    });

    // OpenSearch kNN uses its own scoring; apply optional threshold as a simple score cutoff.
    const minScore = Math.max(0, Number(threshold) || 0);
    const filtered = results.filter(r => (Number(r.score) || 0) >= minScore);
    return res.json({ results: filtered });
  } catch (e) {
    console.error('kb query error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to query knowledge base' });
  }
});

module.exports = router;


