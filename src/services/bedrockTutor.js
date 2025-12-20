const { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

function getAwsRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}

function isAnthropicModel(modelId) {
  const id = String(modelId || '').toLowerCase();
  return id.startsWith('anthropic.') || id.includes('claude');
}

function isNovaModel(modelId) {
  const id = String(modelId || '').toLowerCase();
  return id.startsWith('amazon.nova-');
}

function extractFirstJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // Try to find the first {...} block
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

function enrichBedrockError(err, { modelId }) {
  const name = err?.name || 'Error';
  const msg = String(err?.message || '');
  if (name === 'ValidationException' && /operation not allowed/i.test(msg)) {
    return new Error(
      `Bedrock InvokeModel blocked ("Operation not allowed"). ` +
      `This typically means Bedrock model access is NOT enabled for your AWS account. ` +
      `If you're using Amazon Nova, you may need to use the Bedrock Converse API (not InvokeModel). ` +
      `Also check AWS Organizations SCPs. ` +
      `Then redeploy with BEDROCK_CHAT_MODEL_ID (currently "${modelId || 'unset'}") and AWS_REGION.`
    );
  }
  return err;
}

/**
 * Generate a single multiple-choice question (A-D) using Bedrock.
 * Returns structured data the frontend can render as clickable options.
 */
async function generateMcq({ topic, level = 1, avoidQuestions = [], mastery, context = '' }) {
  const region = getAwsRegion();
  const modelId = process.env.BEDROCK_CHAT_MODEL_ID;
  if (!modelId) {
    throw new Error('Missing BEDROCK_CHAT_MODEL_ID');
  }

  // Build prompt parts
  const promptParts = [
    `You are Pythagoras Chat, an AI Smart Tutor.`,
    `Create ONE multiple-choice question (A-D) about the topic: "${topic}".`,
    `Difficulty level: ${level} (1=easy, 10=hard).`,
  ];

  // Add mastery info if available
  if (typeof mastery === 'number') {
    promptParts.push(`User estimated mastery for this topic: ${Math.max(0, Math.min(1, mastery)).toFixed(2)} (0=novice, 1=master).`);
  }

  // Add retrieved context from Knowledge Base (RAG)
  if (context && context.trim()) {
    promptParts.push(
      `\n--- REFERENCE MATERIAL (from knowledge base) ---`,
      context.slice(0, 3000),
      `--- END REFERENCE MATERIAL ---`,
      `Use the reference material above to create an accurate, relevant question. You may also use your own knowledge to supplement.`
    );
  }

  // Avoid repeating questions
  if (Array.isArray(avoidQuestions) && avoidQuestions.length) {
    promptParts.push(
      `Do NOT repeat or paraphrase any of these recent questions:`,
      ...avoidQuestions.slice(0, 6).map((q, i) => `${i + 1}. ${String(q).slice(0, 240)}`)
    );
  }

  promptParts.push(
    `Return ONLY valid JSON with this exact shape:`,
    `{ "question": string, "choices": [{"id":"A","text":string},{"id":"B","text":string},{"id":"C","text":string},{"id":"D","text":string}], "answerId": "A"|"B"|"C"|"D", "explanation": string }`
  );

  const prompt = promptParts.join('\n');

  // Bedrock models vary by provider.
  // - Anthropic Claude uses the Messages API schema (anthropic_version + messages).
  // - Titan/others often accept inputText + textGenerationConfig.
  const body = isAnthropicModel(modelId)
    ? JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 700,
        temperature: 0.4,
        top_p: 0.9,
        messages: [
          { role: 'user', content: [{ type: 'text', text: prompt }] }
        ]
      })
    : JSON.stringify({
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: 700,
          temperature: 0.4,
          topP: 0.9
        }
      });

  const client = new BedrockRuntimeClient({ region });
  let raw;
  try {
    if (isNovaModel(modelId)) {
      // Nova models are best supported via Converse API.
      const cresp = await client.send(new ConverseCommand({
        modelId,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 700, temperature: 0.4, topP: 0.9 },
      }));
      raw = String(cresp?.output?.message?.content?.[0]?.text || '').trim();
      if (!raw) {
        throw new Error('Bedrock Converse returned empty output');
      }
    } else {
      const resp = await client.send(new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body
      }));
      raw = Buffer.from(resp.body).toString('utf-8');
    }
  } catch (e) {
    throw enrichBedrockError(e, { modelId });
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (_) {
    // Converse often returns plain text; allow extracting JSON from text
    const jsonBlock = extractFirstJsonObject(raw);
    if (!jsonBlock) throw new Error(`Bedrock returned non-JSON output: ${raw.slice(0, 200)}`);
    envelope = JSON.parse(jsonBlock);
  }

  // Extract generated text from provider-specific envelope
  const textOut =
    // Anthropic
    envelope?.content?.[0]?.text ||
    // Titan / others
    envelope?.results?.[0]?.outputText ||
    envelope?.outputText ||
    envelope?.generation ||
    envelope?.completion ||
    envelope?.text ||
    null;

  const candidate = (typeof textOut === 'string' ? textOut : null) || (typeof envelope === 'string' ? envelope : null);
  let finalObj = null;

  // Best case: the envelope itself is the object we need
  if (envelope?.question && Array.isArray(envelope?.choices) && envelope?.answerId) {
    finalObj = envelope;
  } else if (candidate) {
    try {
      finalObj = JSON.parse(candidate);
    } catch (_) {
      const jsonBlock = extractFirstJsonObject(candidate);
      if (!jsonBlock) throw new Error(`Bedrock returned non-JSON output: ${candidate.slice(0, 200)}`);
      finalObj = JSON.parse(jsonBlock);
    }
  }

  if (!finalObj?.question || !Array.isArray(finalObj?.choices) || !finalObj?.answerId) {
    throw new Error(`Bedrock MCQ response missing required fields (model=${modelId})`);
  }

  return {
    question: finalObj.question,
    choices: finalObj.choices,
    answerId: String(finalObj.answerId).toUpperCase(),
    explanation: finalObj.explanation || ''
  };
}

module.exports = {
  generateMcq
};


