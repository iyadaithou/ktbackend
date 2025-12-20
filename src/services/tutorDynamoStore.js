const { PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getDdbDocClient } = require('./awsDynamo');

function tables() {
  return {
    questions: process.env.DDB_QUESTIONS_TABLE || 'pythagoras_tutor_questions',
    knowledge: process.env.DDB_KNOWLEDGE_TABLE || 'pythagoras_knowledge_state',
  };
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = 'q') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function putQuestion({ userId, topic, level, question, choices, answerId, explanation }) {
  const ddb = getDdbDocClient();
  const { questions } = tables();
  const questionId = newId('mcq');
  const pk = `question#${questionId}`;
  const item = {
    pk,
    question_id: questionId,
    user_id: userId,
    topic,
    level,
    question,
    choices,
    answer_id: answerId,
    explanation: explanation || '',
    created_at: nowIso(),
    ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // expire after 24h
  };
  await ddb.send(new PutCommand({ TableName: questions, Item: item }));
  return { questionId };
}

async function getQuestion(questionId) {
  const ddb = getDdbDocClient();
  const { questions } = tables();
  const pk = `question#${questionId}`;
  const resp = await ddb.send(new GetCommand({ TableName: questions, Key: { pk } }));
  return resp?.Item || null;
}

async function getKnowledge(userId) {
  const ddb = getDdbDocClient();
  const { knowledge } = tables();
  const pk = `user#${userId}`;
  const resp = await ddb.send(new GetCommand({ TableName: knowledge, Key: { pk } }));
  return resp?.Item || null;
}

async function recordQuestionAsked({ userId, topic, questionId, question }) {
  const ddb = getDdbDocClient();
  const { knowledge } = tables();
  const pk = `user#${userId}`;
  const ts = nowIso();

  const entry = {
    ts,
    topic: String(topic || 'General').slice(0, 160),
    question_id: String(questionId || '').slice(0, 120),
    question: String(question || '').slice(0, 600),
  };

  const resp = await ddb.send(new UpdateCommand({
    TableName: knowledge,
    Key: { pk },
    UpdateExpression: `SET ${[
      'user_id = if_not_exists(user_id, :uid)',
      'updated_at = :ts',
      'recent_questions = list_append(if_not_exists(recent_questions, :emptyList), :newEntry)',
      'last_question_id = :qid',
      'last_question_text = :qtxt',
      'last_topic = :topicRaw',
    ].join(', ')}`,
    ExpressionAttributeValues: {
      ':uid': userId,
      ':ts': ts,
      ':emptyList': [],
      ':newEntry': [entry],
      ':qid': entry.question_id || null,
      ':qtxt': entry.question || null,
      ':topicRaw': entry.topic,
    },
    ReturnValues: 'ALL_NEW',
  }));

  const updated = resp?.Attributes || null;

  // Keep recent_questions bounded (best-effort) to avoid unlimited growth.
  // We can't slice in DynamoDB, so we rewrite the list when it gets too large.
  try {
    const list = Array.isArray(updated?.recent_questions) ? updated.recent_questions : [];
    const MAX = 30;
    if (list.length > MAX) {
      const trimmed = list.slice(-MAX);
      const resp2 = await ddb.send(new UpdateCommand({
        TableName: knowledge,
        Key: { pk },
        UpdateExpression: 'SET recent_questions = :rq, updated_at = :ts',
        ExpressionAttributeValues: { ':rq': trimmed, ':ts': nowIso() },
        ReturnValues: 'ALL_NEW',
      }));
      return resp2?.Attributes || updated;
    }
  } catch (_) {}

  return updated;
}

/**
 * Update knowledge state per topic using a simple mastery model (0..1).
 * - correct: mastery += 0.08 (cap 1.0)
 * - wrong:   mastery -= 0.04 (floor 0.0)
 * Also tracks XP/streak and a small recent history.
 */
async function updateKnowledge({ userId, topic, correct, questionId }) {
  const ddb = getDdbDocClient();
  const { knowledge } = tables();
  const pk = `user#${userId}`;
  const t = (topic || 'general').toLowerCase().slice(0, 80);

  const masteryDelta = correct ? 0.08 : -0.04;
  const xpDelta = correct ? 10 : 2;

  const topicRaw = topic || 'General';

  // Step 1: ensure container attributes exist with correct base types.
  // (Updating a nested path like topics.#t fails if `topics` doesn't exist or isn't a map.)
  const initTs = nowIso();
  await ddb.send(new UpdateCommand({
    TableName: knowledge,
    Key: { pk },
    UpdateExpression: `SET ${[
      'user_id = if_not_exists(user_id, :uid)',
      'updated_at = :ts',
      'topics = if_not_exists(topics, :emptyMap)',
      'history = if_not_exists(history, :emptyList)',
      'xp = if_not_exists(xp, :zero)',
      'streak = if_not_exists(streak, :zero)',
    ].join(', ')}`,
    ExpressionAttributeValues: {
      ':uid': userId,
      ':ts': initTs,
      ':emptyMap': {},
      ':emptyList': [],
      ':zero': 0,
    },
  }));

  // Step 2: apply the actual knowledge update.
  async function applyMainUpdate({ forceRepairContainers = false } = {}) {
    const ts = nowIso();
    const baseEntry = [{ ts, topic: topicRaw, correct: !!correct, question_id: questionId || null }];

    const exprValues = {
      ':ts': ts,
      ':topicRaw': topicRaw,
      ':result': correct ? 'correct' : 'wrong',
      ':zero': 0,
      ':mdelta': masteryDelta,
      ':xpDelta': xpDelta,
      ':streakDelta': correct ? 1 : 0, // streak reset handled below
      ':newEntry': baseEntry,
    };

    // If the item got into a bad state (topics/history wrong type), repair by overwriting containers.
    if (forceRepairContainers) {
      exprValues[':emptyMap'] = {};
      exprValues[':emptyList'] = [];
    }

    const resp = await ddb.send(new UpdateCommand({
      TableName: knowledge,
      Key: { pk },
      UpdateExpression: `SET ${[
        ...(forceRepairContainers ? ['topics = :emptyMap', 'history = :emptyList'] : []),
        'updated_at = :ts',
        'last_topic = :topicRaw',
        'last_result = :result',
        'topics.#t = if_not_exists(topics.#t, :zero) + :mdelta',
        'xp = if_not_exists(xp, :zero) + :xpDelta',
        'streak = if_not_exists(streak, :zero) + :streakDelta',
        'history = list_append(if_not_exists(history, :emptyList), :newEntry)',
      ].join(', ')}`,
      ExpressionAttributeNames: { '#t': t },
      ExpressionAttributeValues: {
        ...exprValues,
        ...(forceRepairContainers ? {} : { ':emptyList': [] }), // needed for if_not_exists(history, :emptyList)
      },
      ReturnValues: 'ALL_NEW',
    }));

    return resp?.Attributes || null;
  }

  let updated = null;
  try {
    updated = await applyMainUpdate();
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('document path provided in the update expression is invalid')) {
      // Repair and retry once. This is safe for demo; if you want to preserve existing data,
      // we should migrate/validate item shape instead of overwriting.
      updated = await applyMainUpdate({ forceRepairContainers: true });
    } else {
      throw e;
    }
  }

  // Clamp mastery and handle streak reset if wrong (second update, minimal for demo)
  if (updated) {
    const current = Number(updated?.topics?.[t] || 0);
    const clamped = Math.max(0, Math.min(1, current));
    const needClamp = clamped !== current;
    const needResetStreak = !correct && Number(updated?.streak || 0) !== 0;

    if (needClamp || needResetStreak) {
      const setParts = [];
      if (needClamp) setParts.push('topics.#t = :clamped');
      if (needResetStreak) setParts.push('streak = :zero');
      setParts.push('updated_at = :ts');

      const expr2 = { ':ts': nowIso() };
      if (needClamp) expr2[':clamped'] = clamped;
      if (needResetStreak) expr2[':zero'] = 0;

      const cmd2 = new UpdateCommand({
        TableName: knowledge,
        Key: { pk },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ...(needClamp ? { ExpressionAttributeNames: { '#t': t } } : {}),
        ExpressionAttributeValues: expr2,
        ReturnValues: 'ALL_NEW',
      });
      updated = (await ddb.send(cmd2))?.Attributes || updated;
    }
  }

  return updated;
}

module.exports = {
  putQuestion,
  getQuestion,
  getKnowledge,
  recordQuestionAsked,
  updateKnowledge,
};



