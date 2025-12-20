// Ambassadors controller
const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

// Utility to handle Supabase errors consistently
const ok = (res, payload) => res.json(payload);
const fail = (res, status, message, meta) => res.status(status).json({ error: message, ...(meta || {}) });

// List ambassadors (program ambassadors for portal tasks etc.)
const listAmbassadors = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ambassadors')
      .select('*')
      .order('full_name');
    if (error) throw error;
    res.json({ ambassadors: data || [] });
  } catch (err) {
    console.error('listAmbassadors error:', err);
    res.status(500).json({ error: 'Failed to list ambassadors' });
  }
};


// ===== Tasks =====
const listTasks = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ambassador_tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ok(res, { tasks: data || [] });
  } catch (err) {
    console.error('listTasks error:', err);
    return fail(res, 500, 'Failed to list tasks');
  }
};

const createTask = async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.title) return fail(res, 400, 'title is required');
    const { data, error } = await supabase
      .from('ambassador_tasks')
      .insert({
        title: payload.title,
        description: payload.description || null,
        category: payload.category || null,
        points: Number(payload.points) || 0,
        details: payload.details || null,
        how_to_submit: payload.how_to_submit || null,
        requirements: payload.requirements || null,
        is_active: payload.is_active ?? true,
      })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ task: data });
  } catch (err) {
    console.error('createTask error:', err);
    return fail(res, 500, 'Failed to create task');
  }
};

const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const updateRaw = {
      title: payload.title,
      description: payload.description ?? null,
      category: payload.category ?? null,
      points: typeof payload.points === 'number' ? payload.points : undefined,
      details: payload.details ?? null,
      how_to_submit: payload.how_to_submit ?? null,
      requirements: payload.requirements ?? null,
      is_active: typeof payload.is_active === 'boolean' ? payload.is_active : undefined,
    };
    const update = Object.fromEntries(Object.entries(updateRaw).filter(([, v]) => v !== undefined));
    const { data, error } = await supabase
      .from('ambassador_tasks')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return ok(res, { task: data });
  } catch (err) {
    console.error('updateTask error:', err);
    return fail(res, 500, 'Failed to update task');
  }
};

const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('ambassador_tasks').delete().eq('id', id);
    if (error) throw error;
    return ok(res, { success: true });
  } catch (err) {
    console.error('deleteTask error:', err);
    return fail(res, 500, 'Failed to delete task');
  }
};

// ===== Submissions =====
const listSubmissions = async (req, res) => {
  try {
    const { user_id, status } = req.query;
    let query = supabase.from('ambassador_submissions').select('*').order('submitted_at', { ascending: false });
    if (user_id) query = query.eq('user_id', user_id);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return ok(res, { submissions: data || [] });
  } catch (err) {
    console.error('listSubmissions error:', err);
    return fail(res, 500, 'Failed to list submissions');
  }
};

const updateSubmissionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, review_notes, reviewer_id, award_points } = req.body || {};
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return fail(res, 400, 'Invalid status');
    }
    const { data: submission, error: subErr } = await supabase
      .from('ambassador_submissions')
      .update({ status, review_notes: review_notes ?? null, reviewer_id: reviewer_id ?? req.user?.id ?? null })
      .eq('id', id)
      .select()
      .single();
    if (subErr) throw subErr;

    if (status === 'approved' && award_points && Number(award_points) !== 0) {
      const { error: ledgerErr } = await supabase
        .from('ambassador_points_ledger')
        .insert({ user_id: submission.user_id, amount: Number(award_points), reason: 'submission_approved', submission_id: submission.id });
      if (ledgerErr) throw ledgerErr;
    }
    return ok(res, { submission });
  } catch (err) {
    console.error('updateSubmissionStatus error:', err);
    return fail(res, 500, 'Failed to update submission');
  }
};

const createSubmission = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, 'Unauthorized');
    const { task_id, activity_date, location, details, proof_url } = req.body || {};
    if (!task_id && !details) {
      return fail(res, 400, 'task_id or details required');
    }
    const { data, error } = await supabase
      .from('ambassador_submissions')
      .insert({
        user_id: userId,
        task_id: task_id || null,
        activity_date: activity_date || null,
        location: location || null,
        details: details || null,
        proof_url: proof_url || null,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ submission: data });
  } catch (err) {
    console.error('createSubmission error:', err);
    return fail(res, 500, 'Failed to create submission');
  }
};

// ===== Points ledger =====
const listUserLedger = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { data, error } = await supabase
      .from('ambassador_points_ledger')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ok(res, { entries: data || [] });
  } catch (err) {
    console.error('listUserLedger error:', err);
    return fail(res, 500, 'Failed to list ledger entries');
  }
};

const getMyPoints = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, 'Unauthorized');
    // Compute points from ledger (sum of amounts)
    const { data, error } = await supabase
      .from('ambassador_points_ledger')
      .select('amount')
      .eq('user_id', userId);
    if (error) throw error;
    const points = (data || []).reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
    return ok(res, { points });
  } catch (err) {
    console.error('getMyPoints error:', err);
    return fail(res, 500, 'Failed to fetch points balance');
  }
};

const createLedgerEntry = async (req, res) => {
  try {
    const { user_id, amount, reason, submission_id } = req.body || {};
    if (!user_id || typeof amount !== 'number') return fail(res, 400, 'user_id and numeric amount are required');
    const { data, error } = await supabase
      .from('ambassador_points_ledger')
      .insert({ user_id, amount, reason: reason || null, submission_id: submission_id || null })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ entry: data });
  } catch (err) {
    console.error('createLedgerEntry error:', err);
    return fail(res, 500, 'Failed to create ledger entry');
  }
};

// ===== Rewards =====
const listRewards = async (_req, res) => {
  try {
    const { data, error } = await supabase.from('ambassador_rewards_catalog').select('*').order('points_required');
    if (error) throw error;
    return ok(res, { rewards: data || [] });
  } catch (err) {
    console.error('listRewards error:', err);
    return fail(res, 500, 'Failed to list rewards');
  }
};

const createReward = async (req, res) => {
  try {
    const payload = req.body || {};
    if (typeof payload.points_required !== 'number' || !payload.reward) return fail(res, 400, 'points_required and reward are required');
    const { data, error } = await supabase
      .from('ambassador_rewards_catalog')
      .insert({ points_required: payload.points_required, reward: payload.reward, notes: payload.notes || null, is_active: payload.is_active ?? true })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ reward: data });
  } catch (err) {
    console.error('createReward error:', err);
    return fail(res, 500, 'Failed to create reward');
  }
};

const updateReward = async (req, res) => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    const updateRaw = {
      points_required: typeof p.points_required === 'number' ? p.points_required : undefined,
      reward: p.reward,
      notes: p.notes ?? null,
      is_active: typeof p.is_active === 'boolean' ? p.is_active : undefined,
    };
    const update = Object.fromEntries(Object.entries(updateRaw).filter(([, v]) => v !== undefined));
    const { data, error } = await supabase.from('ambassador_rewards_catalog').update(update).eq('id', id).select().single();
    if (error) throw error;
    return ok(res, { reward: data });
  } catch (err) {
    console.error('updateReward error:', err);
    return fail(res, 500, 'Failed to update reward');
  }
};

const deleteReward = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('ambassador_rewards_catalog').delete().eq('id', id);
    if (error) throw error;
    return ok(res, { success: true });
  } catch (err) {
    console.error('deleteReward error:', err);
    return fail(res, 500, 'Failed to delete reward');
  }
};

// ===== Perks =====
const listPerks = async (_req, res) => {
  try {
    const { data, error } = await supabase.from('ambassador_perks_catalog').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return ok(res, { perks: data || [] });
  } catch (err) {
    console.error('listPerks error:', err);
    return fail(res, 500, 'Failed to list perks');
  }
};

const createPerk = async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.title) return fail(res, 400, 'title is required');
    const { data, error } = await supabase
      .from('ambassador_perks_catalog')
      .insert({ title: p.title, description: p.description || null, is_active: p.is_active ?? true })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ perk: data });
  } catch (err) {
    console.error('createPerk error:', err);
    return fail(res, 500, 'Failed to create perk');
  }
};

const updatePerk = async (req, res) => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    const updateRaw = {
      title: p.title,
      description: p.description ?? null,
      is_active: typeof p.is_active === 'boolean' ? p.is_active : undefined,
    };
    const update = Object.fromEntries(Object.entries(updateRaw).filter(([, v]) => v !== undefined));
    const { data, error } = await supabase.from('ambassador_perks_catalog').update(update).eq('id', id).select().single();
    if (error) throw error;
    return ok(res, { perk: data });
  } catch (err) {
    console.error('updatePerk error:', err);
    return fail(res, 500, 'Failed to update perk');
  }
};

const deletePerk = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('ambassador_perks_catalog').delete().eq('id', id);
    if (error) throw error;
    return ok(res, { success: true });
  } catch (err) {
    console.error('deletePerk error:', err);
    return fail(res, 500, 'Failed to delete perk');
  }
};

// ===== Claims =====
const listClaims = async (req, res) => {
  try {
    const { user_id, status, type } = req.query;
    let q = supabase.from('ambassador_claims').select('*').order('created_at', { ascending: false });
    if (user_id) q = q.eq('user_id', user_id);
    if (status) q = q.eq('status', status);
    if (type) q = q.eq('type', type);
    const { data, error } = await q;
    if (error) throw error;
    return ok(res, { claims: data || [] });
  } catch (err) {
    console.error('listClaims error:', err);
    return fail(res, 500, 'Failed to list claims');
  }
};

const createClaim = async (req, res) => {
  try {
    const { user_id, type, catalog_id } = req.body || {};
    if (!user_id || !type || !catalog_id) return fail(res, 400, 'user_id, type and catalog_id are required');
    const { data, error } = await supabase
      .from('ambassador_claims')
      .insert({ user_id, type, catalog_id, status: 'requested' })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ claim: data });
  } catch (err) {
    console.error('createClaim error:', err);
    return fail(res, 500, 'Failed to create claim');
  }
};

const updateClaimStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['requested', 'approved', 'rejected', 'fulfilled'].includes(status)) return fail(res, 400, 'Invalid status');
    const { data, error } = await supabase
      .from('ambassador_claims')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return ok(res, { claim: data });
  } catch (err) {
    console.error('updateClaimStatus error:', err);
    return fail(res, 500, 'Failed to update claim');
  }
};

// ===== Resources =====
const listResources = async (_req, res) => {
  try {
    const { data, error } = await supabase.from('ambassador_resources').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return ok(res, { resources: data || [] });
  } catch (err) {
    console.error('listResources error:', err);
    return fail(res, 500, 'Failed to list resources');
  }
};

const createResource = async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.name || !p.type) return fail(res, 400, 'name and type are required');
    const { data, error } = await supabase
      .from('ambassador_resources')
      .insert({ name: p.name, type: p.type, link: p.link || null, file_path: p.file_path || null, is_active: p.is_active ?? true })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ resource: data });
  } catch (err) {
    console.error('createResource error:', err);
    return fail(res, 500, 'Failed to create resource');
  }
};

const updateResource = async (req, res) => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    const updateRaw = {
      name: p.name,
      type: p.type,
      link: p.link ?? null,
      file_path: p.file_path ?? null,
      is_active: typeof p.is_active === 'boolean' ? p.is_active : undefined,
    };
    const update = Object.fromEntries(Object.entries(updateRaw).filter(([, v]) => v !== undefined));
    const { data, error } = await supabase.from('ambassador_resources').update(update).eq('id', id).select().single();
    if (error) throw error;
    return ok(res, { resource: data });
  } catch (err) {
    console.error('updateResource error:', err);
    return fail(res, 500, 'Failed to update resource');
  }
};

const deleteResource = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('ambassador_resources').delete().eq('id', id);
    if (error) throw error;
    return ok(res, { success: true });
  } catch (err) {
    console.error('deleteResource error:', err);
    return fail(res, 500, 'Failed to delete resource');
  }
};

// Create signed upload URL for resources (Supabase Storage)
const createResourceUploadUrl = async (req, res) => {
  try {
    const { filename, contentType } = req.body || {};
    if (!filename) return fail(res, 400, 'filename is required');
    const bucket = 'affiliate-resources';
    // Ensure bucket exists and is public
    try { await supabase.storage.createBucket(bucket, { public: true }); } catch (_) {}
    await supabase.storage.updateBucket(bucket, { public: true });
    const objectPath = `${uuidv4()}-${filename}`;
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath, { upsert: true, contentType: contentType || 'application/octet-stream' });
    if (error) throw error;
    return ok(res, { upload: data, path: objectPath, bucket });
  } catch (err) {
    console.error('createResourceUploadUrl error:', err);
    return fail(res, 500, 'Failed to create upload URL');
  }
};

// Create ambassador: accept an existing user (by user_id or clerk_id) and ensure profile + role
const createAmbassador = async (req, res) => {
  try {
    const payload = req.body || {};
    // Accept user_id (uuid) or clerk_id to resolve the Supabase user
    const anyId = payload.user_id || payload.clerk_id;
    if (!anyId) return fail(res, 400, 'user_id or clerk_id is required');
    // Resolve user
    const byUuid = await supabase.from('users').select('id, email, first_name, last_name').eq('id', anyId).single();
    let user = (!byUuid.error && byUuid.data) ? byUuid.data : null;
    if (!user) {
      const byClerk = await supabase.from('users').select('id, email, first_name, last_name').eq('clerk_id', anyId).single();
      user = (!byClerk.error && byClerk.data) ? byClerk.data : null;
    }
    if (!user) return fail(res, 404, 'User not found');

    // Ensure ambassador custom role exists and assign
    const { data: ambRole } = await supabase
      .from('custom_roles')
      .select('id, name')
      .eq('name', 'ambassador')
      .maybeSingle();
    if (ambRole && ambRole.id) {
      await supabase
        .from('user_custom_roles')
        .upsert({ user_id: user.id, role_id: ambRole.id, assigned_at: new Date().toISOString() });
    }

    // Ensure ambassador profile
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Ambassador';
    const { data: existing } = await supabase
      .from('ambassadors')
      .select('id, is_active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing && existing.id) {
      const { error: updateErr } = await supabase
        .from('ambassadors')
        .update({ full_name: fullName, is_active: true })
        .eq('user_id', user.id);
      if (updateErr) throw updateErr;
      return res.status(200).json({ ambassador: { id: existing.id, user_id: user.id, full_name: fullName, is_active: true } });
    } else {
      const { data, error } = await supabase
        .from('ambassadors')
        .insert({
          user_id: user.id,
          full_name: fullName,
          pronouns: payload.pronouns || null,
          major: payload.major || null,
          location_state: payload.location_state || null,
          location_country: payload.location_country || null,
          avatar_url: payload.avatar_url || null,
          bio: payload.bio || null,
          preferred_contact: (payload.preferred_contact || 'email').toLowerCase(),
          contact_value: payload.contact_value || user.email || null,
          calendly_url: payload.calendly_url || null,
          is_active: payload.is_active ?? true,
        })
        .select()
        .single();
      if (error) return res.status(400).json({ error: 'DB insert error', code: error.code, message: error.message, details: error.details, hint: error.hint });
      return res.status(201).json({ ambassador: data });
    }
  } catch (err) {
    console.error('createAmbassador error:', err);
    res.status(500).json({ error: 'Failed to create ambassador' });
  }
};

// Update ambassador
const updateAmbassador = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const updateRaw = {
      full_name: payload.full_name,
      pronouns: payload.pronouns ?? null,
      major: payload.major ?? null,
      location_state: payload.location_state ?? null,
      location_country: payload.location_country ?? null,
      avatar_url: payload.avatar_url ?? null,
      bio: payload.bio ?? null,
      preferred_contact: payload.preferred_contact ? String(payload.preferred_contact).toLowerCase() : undefined,
      contact_value: payload.contact_value ?? null,
      calendly_url: payload.calendly_url ?? null,
      is_active: typeof payload.is_active === 'boolean' ? payload.is_active : undefined,
    };
    const update = Object.fromEntries(Object.entries(updateRaw).filter(([, v]) => v !== undefined));
    const { data, error } = await supabase
      .from('ambassadors')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      return res.status(400).json({ error: 'DB update error', code: error.code, message: error.message, details: error.details, hint: error.hint });
    }
    res.json({ ambassador: data });
  } catch (err) {
    console.error('updateAmbassador error:', err?.message || err);
    res.status(500).json({ error: 'Failed to update ambassador', details: err?.message || String(err) });
  }
};

// Delete ambassador
const deleteAmbassador = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('ambassadors').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteAmbassador error:', err);
    res.status(500).json({ error: 'Failed to delete ambassador' });
  }
};

module.exports = {
  listAmbassadors,
  createAmbassador,
  updateAmbassador,
  deleteAmbassador,
  // Representatives moved to controllers/representatives.js
  // Tasks
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  // Submissions
  listSubmissions,
  updateSubmissionStatus,
  createSubmission,
  // Points ledger
  listUserLedger,
  getMyPoints,
  createLedgerEntry,
  // Rewards catalog
  listRewards,
  createReward,
  updateReward,
  deleteReward,
  // Perks catalog
  listPerks,
  createPerk,
  updatePerk,
  deletePerk,
  // Claims
  listClaims,
  createClaim,
  updateClaimStatus,
  // Resources
  listResources,
  createResource,
  updateResource,
  deleteResource,
  // uploads
  createResourceUploadUrl,
};


