const OpenAI = require('openai');

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

async function embedText(text) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
  const resp = await client.embeddings.create({
    model,
    input: String(text || '').slice(0, 8000),
  });
  const vector = resp?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error('OpenAI embeddings response missing embedding');
  return vector;
}

module.exports = { embedText };


