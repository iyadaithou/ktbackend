const OpenAI = require('openai');

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

function extractFirstJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

async function generateMcq({ topic, level = 1, avoidQuestions = [], mastery, context = '' }) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_TUTOR_MODEL || 'gpt-4o-mini';

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

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.4,
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp?.choices?.[0]?.message?.content || '';
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_) {
    const block = extractFirstJsonObject(text);
    if (!block) throw new Error(`OpenAI returned non-JSON output: ${String(text).slice(0, 200)}`);
    obj = JSON.parse(block);
  }

  if (!obj?.question || !Array.isArray(obj?.choices) || !obj?.answerId) {
    throw new Error('OpenAI MCQ response missing required fields');
  }

  return {
    question: obj.question,
    choices: obj.choices,
    answerId: String(obj.answerId).toUpperCase(),
    explanation: obj.explanation || '',
  };
}

module.exports = { generateMcq };



