const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { generateMcq: generateMcqBedrock } = require('../services/bedrockTutor');
const { generateMcq: generateMcqOpenAI } = require('../services/openaiTutor');
const { putQuestion, getQuestion, updateKnowledge, getKnowledge, recordQuestionAsked } = require('../services/tutorDynamoStore');
const { embedText } = require('../services/bedrockEmbeddings');
const { knnSearch } = require('../services/openSearchClient');

/**
 * Retrieve relevant context from the Knowledge Base for RAG.
 * Returns concatenated text snippets or empty string if KB is not configured/empty.
 */
async function retrieveKBContext(topic) {
  try {
    // Check if OpenSearch is configured
    if (!process.env.OPENSEARCH_ENDPOINT) {
      return '';
    }

    // Generate embedding for the topic query
    const queryVector = await embedText(topic);
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return '';
    }

    // Search the KB (global scope for now)
    const results = await knnSearch({
      scope: 'global',
      vector: queryVector,
      k: 4,
    });

    if (!results || results.length === 0) {
      return '';
    }

    // Concatenate relevant snippets
    const snippets = results
      .filter((r) => r.content)
      .map((r) => r.content.trim())
      .slice(0, 3);

    return snippets.join('\n\n');
  } catch (err) {
    console.warn('KB retrieval failed (continuing without context):', err?.message || err);
    return '';
  }
}

function looksLikeGreeting(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return true;
  const greet = new Set(['hi', 'hello', 'hey', 'yo', 'sup', 'good morning', 'good afternoon', 'good evening']);
  if (greet.has(t)) return true;
  if (t.length <= 2) return true;
  if (t === 'thanks' || t === 'thank you') return true;
  return false;
}

function normalizeTopic(raw) {
  const original = String(raw || '').trim();
  const t = original.toLowerCase();
  if (!t) return '';

  const greetingPhrases = [
    'good morning',
    'good afternoon',
    'good evening',
    'hello',
    'hey',
    'hi',
    'yo',
    'sup',
    'gm',
    'gn',
  ];

  for (const g of greetingPhrases) {
    if (t === g) return '';
    if (t.startsWith(`${g} `) || t.startsWith(`${g},`) || t.startsWith(`${g}!`) || t.startsWith(`${g}:`)) {
      return original.slice(g.length).replace(/^[,!:.\s]+/, '').trim();
    }
  }
  return original;
}

router.use(authenticate);

// GET /api/tutor/diag
// Helps debug production 500s (missing env vars / AWS config) without exposing secrets.
router.get('/diag', async (_req, res) => {
  const missing = [];
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) missing.push('AWS_REGION');
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!process.env.BEDROCK_CHAT_MODEL_ID) missing.push('BEDROCK_CHAT_MODEL_ID');

  return res.json({
    ok: missing.length === 0,
    missing,
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || null,
    bedrockChatModelConfigured: Boolean(process.env.BEDROCK_CHAT_MODEL_ID),
    ddbQuestionsTable: process.env.DDB_QUESTIONS_TABLE || 'pythagoras_tutor_questions',
    ddbKnowledgeTable: process.env.DDB_KNOWLEDGE_TABLE || 'pythagoras_knowledge_state',
  });
});

// POST /api/tutor/mcq { topic, level? }
router.post('/mcq', async (req, res) => {
  try {
    const { topic, level } = req.body || {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'topic is required' });
    }

    const trimmedTopic = normalizeTopic(topic).slice(0, 200);
    const lvl = Number(level || 1);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // If user typed "hi"/greeting, ask for a real topic instead of generating nonsense/repeating.
    if (!trimmedTopic || looksLikeGreeting(trimmedTopic)) {
      return res.json({
        type: 'topic_prompt',
        message: `Tell me a topic to start (examples: algebra, fractions, derivatives, probability, geometry).`,
      });
    }

    // Pull a little state so we can avoid repeating questions and adapt difficulty.
    const state = await getKnowledge(userId);
    const topicKey = trimmedTopic.toLowerCase().slice(0, 80);
    const mastery = (state && state.topics && typeof state.topics[topicKey] === 'number')
      ? Number(state.topics[topicKey])
      : undefined;
    const avoidQuestions = Array.isArray(state?.recent_questions)
      ? state.recent_questions
          .filter((x) => String(x?.topic || '').toLowerCase() === String(trimmedTopic).toLowerCase())
          .slice(-4)
          .map((x) => x?.question)
          .filter(Boolean)
      : [];

    // Retrieve relevant context from Knowledge Base (RAG)
    const context = await retrieveKBContext(trimmedTopic);

    // Prefer OpenAI if configured (Bedrock is currently blocked in this account).
    const prefer = String(process.env.TUTOR_PROVIDER || '').toLowerCase(); // 'openai' | 'bedrock' | ''
    const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras);

    const mcq = (prefer === 'openai' || (prefer !== 'bedrock' && hasOpenAIKey))
      ? await generateMcqOpenAI({ topic: trimmedTopic, level: lvl, avoidQuestions, mastery, context })
      : await generateMcqBedrock({ topic: trimmedTopic, level: lvl, avoidQuestions, mastery, context });

    // Validate MCQ shape so we don't return 200 with a broken payload.
    const validChoices = Array.isArray(mcq?.choices) && mcq.choices.length >= 2;
    const validAnswer = typeof mcq?.answerId === 'string' && mcq.answerId.length > 0;
    if (!mcq?.question || !validChoices || !validAnswer) {
      throw new Error('Tutor model returned an invalid MCQ object (missing question/choices/answerId).');
    }

    const saved = await putQuestion({
      userId,
      topic: trimmedTopic,
      level: lvl,
      question: mcq.question,
      choices: mcq.choices,
      answerId: mcq.answerId,
      explanation: mcq.explanation,
    });

    // Record asked question to reduce repetition and show in Recent Questions
    try {
      await recordQuestionAsked({
        userId,
        topic: trimmedTopic,
        questionId: saved.questionId,
        question: mcq.question,
      });
      console.log(`Recorded question ${saved.questionId} for user ${userId}`);
    } catch (recErr) {
      console.error('Failed to record question (non-fatal):', recErr?.message || recErr);
    }

    // For demo: return question + choices + question_id; keep answer server-side.
    return res.json({
      topic: topic.trim(),
      question_id: saved.questionId,
      question: mcq.question,
      choices: mcq.choices
    });
  } catch (e) {
    console.error('tutor mcq error:', e?.message || e);
    const msg = e?.message || 'Failed to generate question';
    return res.status(500).json({ message: msg, error: msg });
  }
});

// POST /api/tutor/answer { question_id, chosenId }
router.post('/answer', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { question_id, chosenId } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!question_id || !chosenId) return res.status(400).json({ error: 'question_id and chosenId required' });

    const q = await getQuestion(question_id);
    if (!q) return res.status(404).json({ error: 'Question not found (expired). Please request a new question.' });
    if (q.user_id && q.user_id !== userId) return res.status(403).json({ error: 'Not allowed' });

    const isCorrect = String(chosenId).toUpperCase() === String(q.answer_id).toUpperCase();

    // Update DynamoDB knowledge state (primary)
    const ddbState = await updateKnowledge({
      userId,
      topic: q.topic || 'General',
      correct: isCorrect,
      questionId: question_id,
    });

    // Mirror to Supabase for existing UI (best-effort)
    let supa = null;
    try {
      const correctCount = Number(ddbState?.xp ? Math.floor((ddbState.xp || 0) / 10) : undefined);
      const { data } = await supabase
        .from('knowledge_state')
        .upsert({
          user_id: userId,
          level: 1,
          correct_count: Number.isFinite(correctCount) ? correctCount : undefined,
          wrong_count: undefined,
          last_topic: String(q.topic || 'General').slice(0, 160),
          last_result: isCorrect ? 'correct' : 'wrong',
          history: (ddbState?.history ? ddbState.history.slice(-100) : undefined),
        }, { onConflict: 'user_id' })
        .select('*')
        .single();
      supa = data || null;
    } catch (_) {}

    return res.json({
      correct: isCorrect,
      explanation: isCorrect ? '' : (q.explanation || ''),
      knowledge: ddbState || null,
      knowledgeState: supa,
    });
  } catch (e) {
    console.error('tutor answer error:', e?.message || e);
    const msg = e?.message || 'Failed to submit answer';
    return res.status(500).json({ message: msg, error: msg });
  }
});

// GET /api/tutor/state
router.get('/state', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const state = await getKnowledge(userId);
    return res.json({ knowledge: state || null });
  } catch (e) {
    console.error('tutor state error:', e?.message || e);
    const msg = e?.message || 'Failed to load tutor state';
    return res.status(500).json({ message: msg, error: msg });
  }
});

module.exports = router;


