const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { getKnowledge } = require('../services/tutorDynamoStore');

router.use(authenticate);

/**
 * Calculate cosine similarity between two topic mastery vectors.
 * Returns a score between 0 and 1 (1 = identical topics/mastery).
 */
function cosineSimilarity(topics1, topics2) {
  if (!topics1 || !topics2) return 0;
  
  // Get all unique topics
  const allTopics = new Set([...Object.keys(topics1), ...Object.keys(topics2)]);
  if (allTopics.size === 0) return 0;
  
  // Build vectors
  const vec1 = [];
  const vec2 = [];
  for (const t of allTopics) {
    vec1.push(Number(topics1[t]) || 0);
    vec2.push(Number(topics2[t]) || 0);
  }
  
  // Calculate cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Find common topics between two users.
 */
function findCommonTopics(topics1, topics2) {
  if (!topics1 || !topics2) return [];
  const set1 = new Set(Object.keys(topics1));
  const set2 = new Set(Object.keys(topics2));
  return [...set1].filter(t => set2.has(t));
}

// GET /api/community/peers?limit=12
router.get('/peers', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '18', 10) || 18));

    // Get my knowledge state from DynamoDB
    const myState = await getKnowledge(userId);
    const myTopics = myState?.topics || {};
    const myXp = Number(myState?.xp || 0);
    const myLevel = Math.floor(myXp / 100) + 1;

    // Get all users with knowledge state from Supabase (we'll enhance with DynamoDB data)
    const { data: supabaseUsers, error } = await supabase
      .from('knowledge_state')
      .select('user_id, level, correct_count, wrong_count, last_topic, history')
      .neq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100); // Get more to filter/rank
    
    if (error) throw error;

    // Fetch user profiles
    const userIds = (supabaseUsers || []).map(u => u.user_id);
    const { data: profiles } = await supabase
      .from('users')
      .select('id, first_name, last_name, profile_image_url, bio')
      .in('id', userIds);
    
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    // Fetch DynamoDB states for all peers (in parallel, best effort)
    const peerStates = await Promise.all(
      userIds.map(async (uid) => {
        try {
          return { uid, state: await getKnowledge(uid) };
        } catch {
          return { uid, state: null };
        }
      })
    );
    const stateMap = new Map(peerStates.map(p => [p.uid, p.state]));

    // Calculate similarity scores and build peer list
    const peers = (supabaseUsers || []).map((u) => {
      const peerTopics = stateMap.get(u.user_id)?.topics || {};
      const peerXp = Number(stateMap.get(u.user_id)?.xp || 0);
      const peerLevel = Math.floor(peerXp / 100) + 1;
      
      const similarity = cosineSimilarity(myTopics, peerTopics);
      const commonTopics = findCommonTopics(myTopics, peerTopics);
      const profile = profileMap.get(u.user_id) || {};
      
      return {
        user_id: u.user_id,
        level: peerLevel || Number(u.level || 1),
        xp: peerXp,
        similarity: Math.round(similarity * 100), // 0-100%
        commonTopics: commonTopics.slice(0, 5),
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        profile_image_url: profile.profile_image_url || null,
        bio: profile.bio || null,
        last_topic: u.last_topic || null,
      };
    });

    // Sort by similarity (highest first), then by level proximity
    peers.sort((a, b) => {
      // Primary: similarity score
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      // Secondary: level proximity
      const aDiff = Math.abs(a.level - myLevel);
      const bDiff = Math.abs(b.level - myLevel);
      return aDiff - bDiff;
    });

    // Return top matches
    return res.json({
      level: myLevel,
      xp: myXp,
      topics: Object.keys(myTopics),
      peers: peers.slice(0, limit),
    });
  } catch (e) {
    console.error('community peers error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load community peers' });
  }
});

module.exports = router;
