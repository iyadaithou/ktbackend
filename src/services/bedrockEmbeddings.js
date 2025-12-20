const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

function getAwsRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}

function getEmbedModelId() {
  // Default to Titan Embed Text v2 if not provided
  return process.env.BEDROCK_EMBED_MODEL_ID || 'amazon.titan-embed-text-v2:0';
}

/**
 * Generate a single embedding vector for input text.
 * Supports Titan embeddings response shape. (Other providers can be added later.)
 */
async function embedText(text) {
  // If OpenAI is configured, prefer it (Bedrock is blocked for this account).
  const provider = String(process.env.EMBEDDINGS_PROVIDER || '').toLowerCase(); // 'openai' | 'bedrock' | ''
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras);
  if (provider === 'openai' || (provider !== 'bedrock' && hasOpenAIKey)) {
    const { embedText: openaiEmbed } = require('./openaiEmbeddings');
    return await openaiEmbed(text);
  }

  const modelId = getEmbedModelId();
  const region = getAwsRegion();
  const client = new BedrockRuntimeClient({ region });

  // Titan embed: { "inputText": "..." }
  const body = JSON.stringify({ inputText: String(text || '').slice(0, 8000) });

  const resp = await client.send(new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  }));

  const raw = Buffer.from(resp.body).toString('utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error(`Bedrock embeddings returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const vector = parsed?.embedding || parsed?.vector || parsed?.embeddings?.[0];
  if (!Array.isArray(vector)) {
    throw new Error(`Bedrock embeddings response missing embedding (model=${modelId})`);
  }

  return vector;
}

module.exports = {
  embedText,
};


