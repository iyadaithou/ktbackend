const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(authenticate);

// GET /api/knowledge-state/me
router.get('/me', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('knowledge_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return res.json({ knowledgeState: data || null });
  } catch (e) {
    console.error('knowledge-state me error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load knowledge state' });
  }
});

// POST /api/knowledge-state/update
// { topic, correct, question?, chosen?, correctAnswer? }
router.post('/update', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { topic, correct, question, chosen, correctAnswer } = req.body || {};
    const isCorrect = Boolean(correct);
    const cleanTopic = typeof topic === 'string' ? topic.trim().slice(0, 160) : null;

    // Load existing
    const existing = await supabase
      .from('knowledge_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing.error && existing.error.code !== 'PGRST116') throw existing.error;

    const row = existing.data || {
      user_id: userId,
      level: 1,
      correct_count: 0,
      wrong_count: 0,
      history: [],
      last_topic: null,
      last_result: null,
    };

    // Simple level update rule
    let level = Number(row.level || 1);
    const correctCount = Number(row.correct_count || 0) + (isCorrect ? 1 : 0);
    const wrongCount = Number(row.wrong_count || 0) + (!isCorrect ? 1 : 0);

    // Every 3 correct answers increase level; every 5 wrong decrease (floor at 1)
    const nextLevel = Math.max(1, Math.floor(correctCount / 3) + 1 - Math.floor(wrongCount / 5));
    level = nextLevel;

    const entry = {
      ts: new Date().toISOString(),
      topic: cleanTopic,
      correct: isCorrect,
      question: typeof question === 'string' ? question.slice(0, 400) : null,
      chosen: typeof chosen === 'string' ? chosen.slice(0, 8) : null,
      answer: typeof correctAnswer === 'string' ? correctAnswer.slice(0, 8) : null,
    };

    const history = Array.isArray(row.history) ? row.history : [];
    history.unshift(entry);
    const capped = history.slice(0, 100);

    const upsertRow = {
      user_id: userId,
      level,
      correct_count: correctCount,
      wrong_count: wrongCount,
      last_topic: cleanTopic,
      last_result: isCorrect ? 'correct' : 'wrong',
      history: capped,
    };

    const { data, error } = await supabase
      .from('knowledge_state')
      .upsert(upsertRow, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) throw error;

    return res.json({ knowledgeState: data });
  } catch (e) {
    console.error('knowledge-state update error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to update knowledge state' });
  }
});

module.exports = router;


