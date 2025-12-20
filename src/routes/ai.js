const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');

// Lazy import for ESM-only OpenAI SDK to avoid import-time crashes in CJS
let OpenAIClass = null;
const getOpenAI = async () => {
  if (OpenAIClass) return OpenAIClass;
  try {
    const mod = await import('openai');
    OpenAIClass = mod.default || mod.OpenAI || mod;
    // Persist chat transcripts if schoolId provided
    try {
      const schoolId = req.body?.schoolId;
      if (schoolId) {
        const lastUser = Array.isArray(messages) ? [...messages].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string') : null;
        const userRow = {
          school_id: schoolId,
          role: 'user',
          content: lastUser?.content || '',
          user_id: req.user?.id || null,
          user_email: req.user?.email || null,
        };
        const aiRow = {
          school_id: schoolId,
          role: 'assistant',
          content: fullText,
          user_id: req.user?.id || null,
          user_email: req.user?.email || null,
        };
        // Try with user_id/email columns first; fall back to base schema on error
        let insErr = null;
        try {
          const { error } = await supabase.from('school_ai_chats').insert([userRow, aiRow]);
          insErr = error || null;
        } catch (e) { insErr = e; }
        if (insErr) {
          try {
            await supabase.from('school_ai_chats').insert([
              { school_id: schoolId, role: 'user', content: lastUser?.content || '' },
              { school_id: schoolId, role: 'assistant', content: fullText },
            ]);
          } catch (_) {}
        }
      }
    } catch (_) {}

  } catch (e) {
    console.error('Failed to import OpenAI SDK:', e?.message || e);
    throw e;
  }
  return OpenAIClass;
};

// Require auth
router.use(authenticate);

// POST /api/ai/generate-html
router.post('/generate-html', async (req, res) => {
  try {
    const { prompt, base_html: baseHtml } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const OpenAI = await getOpenAI();
    const client = new OpenAI({ apiKey });
    const isEdit = !!baseHtml;
    const system = isEdit
      ? 'You are an assistant that edits an existing HTML snippet used in a Quill editor. Apply the requested changes while preserving structure and untouched content. Return only the edited HTML snippet (no <html> or <body>). Allowed tags: <p>, <h1-3>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>.'
      : 'You are a helpful assistant that writes concise HTML content for a Quill rich-text editor. Return clean, semantic HTML only. Use <p>, <h2>, <ul><li>, <strong>, <em>, and links where appropriate. Do not include <html> or <body> wrappers.';

    const userContent = isEdit
      ? `Edit the following HTML according to the instructions.

HTML:
<<<HTML_START>>>
${baseHtml}
<<<HTML_END>>>

INSTRUCTIONS:
${prompt}`
      : prompt;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const html = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!html) return res.status(500).json({ error: 'No content generated' });
    res.json({ html });
  } catch (e) {
    console.error('AI generate error:', e);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

// POST /api/ai/chat
// { messages: ChatMessage[], model?, temperature?, max_tokens? }
router.post('/chat', async (req, res) => {
  try {
    const { messages, model, temperature, max_tokens, attachments = [], persona = 'guidance', includeSources = true } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const OpenAI = await getOpenAI();
    const client = new OpenAI({ apiKey });

    // Load global admin settings and overrides
    let globalInstructions = '';
    let globalConfig = {};
    try {
      const gs = await supabase
        .from('global_ai_settings')
        .select('instructions, config')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (gs && gs.data) {
        globalInstructions = String(gs.data.instructions || '').trim();
        globalConfig = (typeof gs.data.config === 'object' && gs.data.config) ? gs.data.config : {};
      }
    } catch (_) {}
    let overrideSystem = '';
    try {
      const ov = await supabase
        .from('ai_prompt_overrides')
        .select('key, value')
        .eq('scope', 'global');
      const sys = (ov.data || []).filter(r => r && r.key === 'system').map(r => String(r.value || '').trim()).filter(Boolean).join('\n\n');
      if (sys) overrideSystem = sys;
    } catch (_) {}

    const personaPrompt = persona === 'smart_tutor'
      ? [
          'You are Pythagoras Chat, an AI Smart Tutor.',
          'You teach step by step by asking ONE multiple-choice question at a time.',
          'When the user mentions a topic, ask a single MCQ (A-D) that matches their level.',
          'Output format MUST be:',
          '1) A short 1-2 sentence greeting or bridge',
          '2) A heading: \"Question:\" followed by the question',
          '3) A-D answer choices, each on its own line like \"A) ...\"',
          '4) A final hidden answer key line exactly: \"__ANSWER_KEY__: <LETTER>\" (LETTER is A, B, C, or D)',
          'Do NOT reveal the answer key anywhere else. Keep it exactly as specified so the UI can grade it.',
        ].join(' ')
      : (persona === 'guidance'
        ? 'You are PythagorasAI, developed by Pythagoras Research & Training. You are an experienced, friendly guidance counselor. Provide practical, student-centered advice on academics, admissions, and planning. Be supportive, concise, and action-oriented. Offer next steps and resources. Avoid making guarantees. Do not mention specific model providers unless explicitly asked.'
        : 'You are PythagorasAI, developed by Pythagoras Research & Training. You are a concise and helpful education assistant. Do not mention specific model providers unless explicitly asked.');
    const sourcesPrompt = includeSources
      ? 'When an insight depends on a provided source, cite it in-line using [source:label]. If you are unsure or lack evidence, say so briefly.'
      : '';
    const system = [
      personaPrompt + ' Answer clearly, use simple language, short paragraphs and lists.',
      sourcesPrompt,
      globalInstructions,
      overrideSystem
    ].filter(Boolean).join(' ').trim();

    // Build an attachments message if any
    const imageAttachments = (attachments || []).filter(a => a && a.url && String(a.type || '').startsWith('image'));
    const nonImageSources = (attachments || [])
      .filter(a => a && a.url && !String(a.type || '').startsWith('image'))
      .map((a, idx) => ({ label: a.name || `attachment-${idx + 1}`, url: a.url }));

    const attachmentContentParts = [];
    if (includeSources && (imageAttachments.length > 0 || nonImageSources.length > 0)) {
      const labelsText = nonImageSources.map(s => `- ${s.label}: ${s.url}`).join('\n');
      if (labelsText) {
        attachmentContentParts.push({ type: 'text', text: `Available sources (cite as [source:label]):\n${labelsText}` });
      }
    }
    for (const img of imageAttachments) {
      attachmentContentParts.push({ type: 'image_url', image_url: { url: img.url } });
    }

    const finalMessages = [
      { role: 'system', content: system },
      ...messages,
    ];
    if (attachmentContentParts.length > 0) {
      finalMessages.push({ role: 'user', content: attachmentContentParts });
    }

    const modelToUse = (model || globalConfig.model || 'gpt-4o');
    const tempToUse = (typeof temperature === 'number' ? temperature : (typeof globalConfig.temperature === 'number' ? globalConfig.temperature : 0.4));
    const maxTokensToUse = (typeof max_tokens === 'number' ? max_tokens : (typeof globalConfig.max_tokens === 'number' ? globalConfig.max_tokens : 800));
    const completion = await client.chat.completions.create({
      model: modelToUse,
      messages: finalMessages,
      temperature: tempToUse,
      max_tokens: maxTokensToUse,
    });

    const content = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!content) return res.status(500).json({ error: 'No content generated' });
    const sources = (attachments || []).map((a, idx) => ({ label: a.name || `attachment-${idx + 1}`, url: a.url, type: a.type || null }));
    // Log usage if available
    try {
      const u = completion?.usage || null;
      const promptTokens = (u && (u.prompt_tokens || u.total_tokens)) ? (u.prompt_tokens || u.total_tokens) : 0;
      const completionTokens = (u && u.completion_tokens) ? u.completion_tokens : 0;
      await supabase.from('ai_usage').insert({
        user_id: req.user?.id || null,
        scope: 'global',
        model: completion.model || modelToUse,
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        cost_usd: 0
      });
    } catch (_) {}
    return res.json({ message: content, model: completion.model || modelToUse, sources });
  } catch (e) {
    console.error('AI chat error:', e);
    return res.status(500).json({ error: 'Failed to generate chat response' });
  }
});

// POST /api/ai/chat-stream (SSE)
router.post('/chat-stream', async (req, res) => {
  const cleanup = [];
  try {
    const { messages, model, temperature, max_tokens, attachments = [], persona = 'guidance', includeSources = true } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (_) {}
    };

    const OpenAI = await getOpenAI();
    const client = new OpenAI({ apiKey });

    // Load global admin settings and overrides
    let globalInstructions = '';
    let globalConfig = {};
    try {
      const gs = await supabase
        .from('global_ai_settings')
        .select('instructions, config')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (gs && gs.data) {
        globalInstructions = String(gs.data.instructions || '').trim();
        globalConfig = (typeof gs.data.config === 'object' && gs.data.config) ? gs.data.config : {};
      }
    } catch (_) {}
    let overrideSystem = '';
    try {
      const ov = await supabase
        .from('ai_prompt_overrides')
        .select('key, value')
        .eq('scope', 'global');
      const sys = (ov.data || []).filter(r => r && r.key === 'system').map(r => String(r.value || '').trim()).filter(Boolean).join('\n\n');
      if (sys) overrideSystem = sys;
    } catch (_) {}

    const personaPrompt = persona === 'guidance'
      ? 'You are PythagorasAI, developed by Pythagoras Research & Training. You are an experienced, friendly guidance counselor. Provide practical, student-centered advice on academics, admissions, and planning. Be supportive, concise, and action-oriented. Offer next steps and resources. Avoid making guarantees. Do not mention specific model providers unless explicitly asked.'
      : 'You are PythagorasAI, developed by Pythagoras Research & Training. You are a concise and helpful education assistant. Do not mention specific model providers unless explicitly asked.';
    const sourcesPrompt = includeSources
      ? 'When an insight depends on a provided source, cite it in-line using [source:label]. If you are unsure or lack evidence, say so briefly.'
      : '';
    const system = [
      personaPrompt + ' Answer clearly, use simple language, short paragraphs and lists.',
      sourcesPrompt,
      globalInstructions,
      overrideSystem
    ].filter(Boolean).join(' ').trim();

    // Build attachment content
    const imageAttachments = (attachments || []).filter(a => a && a.url && String(a.type || '').startsWith('image'));
    const nonImageSources = (attachments || [])
      .filter(a => a && a.url && !String(a.type || '').startsWith('image'))
      .map((a, idx) => ({ label: a.name || `attachment-${idx + 1}`, url: a.url }));

    const attachmentContentParts = [];
    if (includeSources && (imageAttachments.length > 0 || nonImageSources.length > 0)) {
      const labelsText = nonImageSources.map(s => `- ${s.label}: ${s.url}`).join('\n');
      if (labelsText) {
        attachmentContentParts.push({ type: 'text', text: `Available sources (cite as [source:label]):\n${labelsText}` });
      }
    }
    for (const img of imageAttachments) {
      attachmentContentParts.push({ type: 'image_url', image_url: { url: img.url } });
    }

    const finalMessages = [
      { role: 'system', content: system },
      ...messages,
    ];
    if (attachmentContentParts.length > 0) {
      finalMessages.push({ role: 'user', content: attachmentContentParts });
    }

    let fullText = '';
    const sources = (attachments || []).map((a, idx) => ({ label: a.name || `attachment-${idx + 1}`, url: a.url, type: a.type || null }));

    const onClose = () => {
      try { res.end(); } catch (_) {}
    };
    req.on('close', onClose);
    cleanup.push(() => req.off('close', onClose));

    const modelToUse = (model || globalConfig.model || 'gpt-4o');
    const tempToUse = (typeof temperature === 'number' ? temperature : (typeof globalConfig.temperature === 'number' ? globalConfig.temperature : 0.4));
    const maxTokensToUse = (typeof max_tokens === 'number' ? max_tokens : (typeof globalConfig.max_tokens === 'number' ? globalConfig.max_tokens : 800));
    const stream = await client.chat.completions.create({
      model: modelToUse,
      messages: finalMessages,
      temperature: tempToUse,
      max_tokens: maxTokensToUse,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) {
        fullText += content;
        send({ type: 'delta', delta: content });
      }
    }

    send({ type: 'done', message: fullText, sources });
    try { res.end(); } catch (_) {}

    // Persist chat transcripts if schoolId provided, else global
    try {
      const schoolId = req.body?.schoolId;
      const lastUser = Array.isArray(messages) ? [...messages].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string') : null;
      if (schoolId) {
        const userRow = { school_id: schoolId, role: 'user', content: lastUser?.content || '', user_id: req.user?.id || null };
        const aiRow   = { school_id: schoolId, role: 'assistant', content: fullText, user_id: req.user?.id || null };
        try { await supabase.from('school_ai_chats').insert([userRow, aiRow]); }
        catch { await supabase.from('school_ai_chats').insert([{ school_id: schoolId, role: 'user', content: lastUser?.content || '' }, { school_id: schoolId, role: 'assistant', content: fullText }]); }
      } else {
        const gUser = { role: 'user', content: lastUser?.content || '', user_id: req.user?.id || null };
        const gAi   = { role: 'assistant', content: fullText, user_id: req.user?.id || null };
        try { await supabase.from('global_ai_chats').insert([gUser, gAi]); } catch (_) {}
      }
      // Log usage record without tokens (streaming doesn't return usage)
      try { await supabase.from('ai_usage').insert({ user_id: req.user?.id || null, scope: 'global', model: modelToUse, input_tokens: 0, output_tokens: 0, cost_usd: 0 }); } catch (_) {}
    } catch (_) {}

  } catch (e) {
    console.error('AI chat-stream error:', e);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Streaming failed' })}\n\n`);
      res.end();
    } catch (_) {}
  } finally {
    for (const fn of cleanup) {
      try { fn(); } catch (_) {}
    }
  }
});

module.exports = router;

// ========== INDEXING AND ANSWER ENDPOINTS ==========

// Chunk helper
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

// POST /api/ai/index-school
// { schoolId, bucket: 'school-ai' }
router.post('/index-school', async (req, res) => {
  try {
    const { schoolId, bucket = 'school-ai' } = req.body || {};
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

    // List files in folder `${schoolId}`
    const { data: files, error: listErr } = await supabase.storage.from(bucket).list(`${schoolId}`, { limit: 1000 });
    if (listErr) throw listErr;

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    const OpenAI = await getOpenAI();
    const client = new OpenAI({ apiKey });

    let indexed = 0;
    for (const f of files || []) {
      // Fetch file as text via public URL
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(`${schoolId}/${f.name}`);
      const url = urlData?.publicUrl;
      if (!url) continue;
      const resp = await fetch(url);
      const raw = await resp.text();
      const chunks = chunkText(raw);
      // Generate embeddings for each chunk
      for (let idx = 0; idx < chunks.length; idx++) {
        const text = chunks[idx];
        const emb = await client.embeddings.create({ model: 'text-embedding-3-small', input: text });
        const vector = emb.data?.[0]?.embedding;
        if (!vector) continue;
        const { error: insErr } = await supabase
          .from('school_ai_documents')
          .insert({ school_id: schoolId, file_path: `${schoolId}/${f.name}`, chunk_index: idx, content: text, embedding: vector });
        if (!insErr) indexed++;
      }
    }
    res.json({ indexed });
  } catch (e) {
    console.error('index-school error:', e);
    res.status(500).json({ error: 'Failed to index documents' });
  }
});

// POST /api/ai/ask
// { schoolId, question }
router.post('/ask', async (req, res) => {
  try {
    const { schoolId, question } = req.body || {};
    if (!schoolId || !question) return res.status(400).json({ error: 'schoolId and question required' });
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    const OpenAI = await getOpenAI();
    const client = new OpenAI({ apiKey });

    // Embed question
    const qEmb = await client.embeddings.create({ model: 'text-embedding-3-small', input: question });
    const vector = qEmb.data?.[0]?.embedding;
    if (!vector) return res.status(500).json({ error: 'Failed to embed question' });

    // Similarity search via SQL helper
    const { data: contexts, error: matchErr } = await supabase.rpc('match_school_docs', { query_embedding: vector, in_school_id: schoolId, match_count: 5 });
    if (matchErr) throw matchErr;

    const contextText = (contexts || []).map(c => `Source: ${c.file_path} [${c.chunk_index}]
${c.content}`).join('\n\n---\n\n');

    const sys = 'You are a school assistant. Answer using the provided context. If unsure, say you do not know. Include short citations like [file:chunk] when relevant. Keep answers concise.';
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Context:\n${contextText}\n\nQuestion: ${question}` }
      ],
      temperature: 0.3,
      max_tokens: 400,
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || '';
    res.json({ answer, contexts });
  } catch (e) {
    console.error('ask error:', e);
    res.status(500).json({ error: 'Failed to answer question' });
  }
});


