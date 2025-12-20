// Schools controller
const supabase = require('../config/supabase');
const Stripe = require('stripe');
const crypto = require('crypto');
const { ROLES } = require('../utils/roles');
const { createClient } = require('@supabase/supabase-js');

// Helper to create service role client for bypassing RLS
const getServiceClient = () => {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
};

// Media (gallery)
const listSchoolMedia = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase
      .from('school_media')
      .select('*')
      .eq('school_id', id)
      .order('display_order', { ascending: true });
    if (error) throw error;
    const normalized = (data || []).map(r => ({
      id: r.id,
      school_id: r.school_id,
      url: r.image_url || r.url || null,
      caption: r.caption || null,
      display_order: r.display_order || 0,
      media_type: 'image',
    }));
    res.json({ media: normalized });
  } catch (err) {
    console.error('listSchoolMedia error:', err);
    res.status(500).json({ message: 'Failed to load media', details: err?.message || String(err) });
  }
};

const addSchoolMedia = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { url, media_type = 'image', title = '', caption = '' } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!process.env.SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ message: 'Server missing SUPABASE_SERVICE_KEY', hint: 'Set SUPABASE_SERVICE_KEY in backend environment' });
    }

    // Determine next display order
    let nextOrder = 1;
    try {
      const { data: rows } = await supabase
        .from('school_media')
        .select('display_order')
        .eq('school_id', id)
        .order('display_order', { ascending: false })
        .limit(1);
      if (Array.isArray(rows) && rows.length > 0) {
        nextOrder = Number(rows[0].display_order || 0) + 1;
      }
    } catch (_) {}

    // Route videos to school_videos table; images to school_media
    let data, error;
    if (String(media_type).toLowerCase() === 'video') {
      const insertVideo = {
        school_id: id,
        video_url: url,
        title: title || '',
        display_order: nextOrder,
      };
      ({ data, error } = await supabase
        .from('school_videos')
        .insert(insertVideo)
        .select()
        .single());
    } else {
      const insertImage = {
        school_id: id,
        image_url: url,
        caption: caption || '',
        display_order: nextOrder,
      };
      ({ data, error } = await supabase
        .from('school_media')
        .insert(insertImage)
        .select()
        .single());
    }
    if (error) {
      console.error('addSchoolMedia supabase error:', error);
      const msg = String(error.message || '');
      // Retry with created_by if table requires it (for either table)
      if (/null value in column\s+"created_by"/i.test(msg) && req.user?.id) {
        try {
          const lower = String(media_type).toLowerCase();
          const table = lower === 'video' ? 'school_videos' : 'school_media';
          const payload = lower === 'video'
            ? { school_id: id, video_url: url, title: title || '', display_order: nextOrder, created_by: req.user.id }
            : { school_id: id, image_url: url, caption: caption || '', display_order: nextOrder, created_by: req.user.id };
          const retry = await supabase.from(table).insert(payload).select().single();
          if (!retry.error) {
            return res.status(201).json({ media: retry.data });
          }
          console.error('addSchoolMedia retry error:', retry.error);
        } catch (re) {
          console.error('addSchoolMedia retry exception:', re);
        }
      }
      return res.status(400).json({ message: 'Insert failed', code: error.code || null, details: msg });
    }
    res.status(201).json({ media: data });
  } catch (err) {
    console.error('addSchoolMedia error:', err);
    res.status(500).json({ message: 'Failed to add media', details: err?.message || String(err) });
  }
};

const deleteSchoolMedia = async (req, res) => {
  try {
    const { mediaId } = req.params;
    // Load media to determine school
    const { data: row } = await supabase.from('school_media').select('school_id').eq('id', mediaId).maybeSingle();
    const schoolId = row?.school_id;
    if (!schoolId) return res.status(404).json({ error: 'Media not found' });
    const allowed = await ensureSchoolManagerOrAdmin(req, schoolId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { error } = await supabase.from('school_media').delete().eq('id', mediaId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteSchoolMedia error:', err);
    res.status(500).json({ message: 'Failed to delete media', details: err?.message || String(err) });
  }
};

// Living Costs
const listSchoolLivingCosts = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase
      .from('school_living_costs')
      .select('*')
      .eq('school_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ living_costs: data || [] });
  } catch (err) {
    console.error('listSchoolLivingCosts error:', err);
    res.status(500).json({ message: 'Failed to load living costs', details: err?.message || String(err) });
  }
};

const addSchoolLivingCost = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { category, cadence = 'year', amount, currency = 'USD', notes } = req.body || {};
    if (!category || String(category).trim() === '') {
      return res.status(400).json({ error: 'category is required' });
    }
    const payload = {
      school_id: id,
      category: String(category).trim(),
      cadence: String(cadence || 'year'),
      amount: amount === null || amount === undefined || String(amount) === '' ? null : Number(amount),
      currency: String(currency || 'USD').toUpperCase(),
      notes: notes || null,
    };
    const { data, error } = await supabase
      .from('school_living_costs')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ living_cost: data });
  } catch (err) {
    console.error('addSchoolLivingCost error:', err);
    res.status(500).json({ message: 'Failed to add living cost', details: err?.message || String(err) });
  }
};

const deleteSchoolLivingCost = async (req, res) => {
  try {
    const { livingCostId } = req.params;
    const { data: row } = await supabase
      .from('school_living_costs')
      .select('school_id')
      .eq('id', livingCostId)
      .maybeSingle();
    const schoolId = row?.school_id;
    if (!schoolId) return res.status(404).json({ error: 'Living cost not found' });
    const allowed = await ensureSchoolManagerOrAdmin(req, schoolId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { error } = await supabase
      .from('school_living_costs')
      .delete()
      .eq('id', livingCostId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteSchoolLivingCost error:', err);
    res.status(500).json({ message: 'Failed to delete living cost', details: err?.message || String(err) });
  }
};

// Scholarships
const listSchoolScholarships = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase
      .from('school_scholarships')
      .select('*')
      .eq('school_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ scholarships: data || [] });
  } catch (err) {
    console.error('listSchoolScholarships error:', err);
    res.status(500).json({ message: 'Failed to load scholarships', details: err?.message || String(err) });
  }
};

const addSchoolScholarship = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { name, amount, eligibility, notes, link } = req.body || {};
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }
    const payload = {
      school_id: id,
      name: String(name).trim(),
      amount: amount === null || amount === undefined || String(amount) === '' ? null : Number(amount),
      eligibility: eligibility || null,
      notes: notes || null,
      link: link || null,
    };
    const { data, error } = await supabase
      .from('school_scholarships')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ scholarship: data });
  } catch (err) {
    console.error('addSchoolScholarship error:', err);
    res.status(500).json({ message: 'Failed to add scholarship', details: err?.message || String(err) });
  }
};

const deleteSchoolScholarship = async (req, res) => {
  try {
    const { scholarshipId } = req.params;
    const { data: row } = await supabase
      .from('school_scholarships')
      .select('school_id')
      .eq('id', scholarshipId)
      .maybeSingle();
    const schoolId = row?.school_id;
    if (!schoolId) return res.status(404).json({ error: 'Scholarship not found' });
    const allowed = await ensureSchoolManagerOrAdmin(req, schoolId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { error } = await supabase
      .from('school_scholarships')
      .delete()
      .eq('id', scholarshipId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteSchoolScholarship error:', err);
    res.status(500).json({ message: 'Failed to delete scholarship', details: err?.message || String(err) });
  }
};


// Helpers for managers
const listSchoolManagers = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('school_managers')
      .select('user_id, role, manager_type, assigned_at, users:users(id, email, first_name, last_name)')
      .eq('school_id', id);
    if (error) throw error;
    res.json({ managers: data || [] });
  } catch (err) {
    console.error('listSchoolManagers error:', err);
    res.status(500).json({ error: 'Failed to list managers' });
  }
};

const addSchoolManager = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const { userId, role = 'manager' } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { error } = await supabase
      .from('school_managers')
      .upsert({ school_id: id, user_id: userId, role }, { onConflict: 'school_id,user_id' });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('addSchoolManager error:', err);
    res.status(500).json({ error: 'Failed to add manager' });
  }
};

const removeSchoolManager = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { error } = await supabase
      .from('school_managers')
      .delete()
      .eq('school_id', id)
      .eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('removeSchoolManager error:', err);
    res.status(500).json({ error: 'Failed to remove manager' });
  }
};

// List schools (admin sees all)
const listSchools = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .order('updated_at', { ascending: false, nullsLast: true });
    if (error) throw error;
    res.json({ schools: data || [] });
  } catch (err) {
    console.error('listSchools error:', err);
    res.status(500).json({ error: 'Failed to list schools' });
  }
};

// Get school by id
const getSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    res.json({ school: data });
  } catch (err) {
    console.error('getSchool error:', err);
    res.status(500).json({ error: 'Failed to get school' });
  }
};

// Create school
const createSchool = async (req, res) => {
  try {
    const payload = req.body || {};
    const insert = {
      name: payload.name,
      short_name: payload.short_name || null,
      location_city: payload.location_city || null,
      location_country: payload.location_country || null,
      logo_url: payload.logo_url || null,
      cover_image_url: payload.cover_image_url || null,
      website: payload.website || null,
      is_active: payload.is_active ?? true,
      entity_type: payload.entity_type || null,
      financial_aid_policy: payload.financial_aid_policy || null,
      scholarships_info: payload.scholarships_info || null,
      featured_video_url: payload.featured_video_url || null,
      // extended fields for full page reflection
      acceptance_rate: payload.acceptance_rate ?? null,
      student_count: payload.student_count ?? null,
      founded_year: payload.founded_year ?? null,
      application_deadline: payload.application_deadline || null,
      application_fee: payload.application_fee ?? null,
      accepts_pythagoras_applications: payload.accepts_pythagoras_applications ?? false,
      requires_entrance_exam: payload.requires_entrance_exam ?? false,
      majors: payload.majors || null,
      description: payload.description || null,
      // standard stats
      application_volume: payload.application_volume ?? null,
      application_portal: payload.application_portal || null,
      supplemental_essays: payload.supplemental_essays ?? null,
      recommendation_required: payload.recommendation_required ?? null,
      entrance_exams: payload.entrance_exams || null,
      test_optional: payload.test_optional ?? null,
      average_tuition: payload.average_tuition ?? null,
      enrollment_policy: payload.enrollment_policy || null,
      international_acceptance_rate: payload.international_acceptance_rate ?? null,
      average_financial_aid: payload.average_financial_aid ?? null,
      work_study_available: payload.work_study_available ?? null,
      faculty_student_ratio: payload.faculty_student_ratio ?? null,
      graduation_rate: payload.graduation_rate ?? null,
      retention_rate: payload.retention_rate ?? null,
      accreditation: payload.accreditation || null,
      housing_available: payload.housing_available ?? null,
      clubs_count: payload.clubs_count ?? null,
    };
    const { data, error } = await supabase
      .from('schools')
      .insert(insert)
      .select()
      .single();
    if (error) throw error;
    // Ensure storage folder/bucket initialized for this school (best-effort)
    try {
      await supabase.storage.createBucket('school-ai', { public: true })
        .catch((err) => console.warn('Bucket creation skipped (may already exist):', err?.message || err));
      await supabase.storage.updateBucket('school-ai', { public: true })
        .catch((err) => console.warn('Bucket update failed:', err?.message || err));
      // create a placeholder object so folder appears (Node: use Buffer)
      const buf = Buffer.from('keep');
      await supabase.storage.from('school-ai').upload(`${data.id}/.keep`, buf, { upsert: true, contentType: 'text/plain' })
        .catch((err) => console.warn('Placeholder file upload failed:', err?.message || err));
    } catch (e) {
      console.warn('init school bucket failed:', e?.message || e);
    }
    res.status(201).json({ school: data });
  } catch (err) {
    console.error('createSchool error:', err);
    res.status(500).json({ error: 'Failed to create school' });
  }
};

// Update school
const updateSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const update = {
      name: payload.name,
      short_name: payload.short_name || null,
      location_city: payload.location_city || null,
      location_country: payload.location_country || null,
      logo_url: payload.logo_url || null,
      cover_image_url: payload.cover_image_url || null,
      website: payload.website || null,
      is_active: payload.is_active ?? true,
      entity_type: payload.entity_type || null,
      financial_aid_policy: payload.financial_aid_policy || null,
      scholarships_info: payload.scholarships_info || null,
      featured_video_url: payload.featured_video_url || null,
      // extended fields for full page reflection
      acceptance_rate: payload.acceptance_rate ?? null,
      student_count: payload.student_count ?? null,
      founded_year: payload.founded_year ?? null,
      application_deadline: payload.application_deadline || null,
      application_fee: payload.application_fee ?? null,
      accepts_pythagoras_applications: payload.accepts_pythagoras_applications ?? false,
      requires_entrance_exam: payload.requires_entrance_exam ?? false,
      majors: payload.majors || null,
      description: payload.description || null,
      // standard stats
      application_volume: payload.application_volume ?? null,
      application_portal: payload.application_portal || null,
      supplemental_essays: payload.supplemental_essays ?? null,
      recommendation_required: payload.recommendation_required ?? null,
      entrance_exams: payload.entrance_exams || null,
      test_optional: payload.test_optional ?? null,
      average_tuition: payload.average_tuition ?? null,
      enrollment_policy: payload.enrollment_policy || null,
      international_acceptance_rate: payload.international_acceptance_rate ?? null,
      average_financial_aid: payload.average_financial_aid ?? null,
      work_study_available: payload.work_study_available ?? null,
      faculty_student_ratio: payload.faculty_student_ratio ?? null,
      graduation_rate: payload.graduation_rate ?? null,
      retention_rate: payload.retention_rate ?? null,
      accreditation: payload.accreditation || null,
      housing_available: payload.housing_available ?? null,
      clubs_count: payload.clubs_count ?? null,
    };
    const { data, error } = await supabase
      .from('schools')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ school: data });
  } catch (err) {
    console.error('updateSchool error:', err);
    res.status(500).json({ error: 'Failed to update school' });
  }
};

// Delete school
const deleteSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('schools').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteSchool error:', err);
    res.status(500).json({ error: 'Failed to delete school' });
  }
};

// List schools managed by current user
const listMyManagedSchools = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    // Get school IDs the user manages
    const { data: links, error: linkErr } = await supabase
      .from('school_managers')
      .select('school_id')
      .eq('user_id', req.user.id);
    if (linkErr) throw linkErr;
    const ids = Array.from(new Set((links || []).map(r => r.school_id).filter(Boolean)));
    if (ids.length === 0) return res.json({ schools: [] });

    const { data: schools, error: schErr } = await supabase
      .from('schools')
      .select('id, name, short_name, logo_url, location_city, location_country')
      .in('id', ids)
      .order('name', { ascending: true });
    if (schErr) throw schErr;
    res.json({ schools: schools || [] });
  } catch (err) {
    console.error('listMyManagedSchools error:', err);
    res.status(500).json({ error: 'Failed to list managed schools', details: err?.message || String(err) });
  }
};

// Get latest school application form (JSON config)
const getSchoolForm = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('school_application_forms')
      .select('id, school_id, form_config, version, created_at')
      .eq('school_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json({ form: data || { school_id: id, form_config: { questions: [] }, version: 1 } });
  } catch (err) {
    console.error('getSchoolForm error:', err);
    res.status(500).json({ error: 'Failed to load school form' });
  }
};

// Upsert school form (creates a new version)
const upsertSchoolForm = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const payload = req.body || {};
    const formConfig = payload.form_config || payload.form || payload.config;
    if (!formConfig || typeof formConfig !== 'object') {
      return res.status(400).json({ error: 'form_config (object) is required' });
    }

    // Load current max version for this school
    let nextVersion = 1;
    try {
      const { data: cur, error: curErr } = await supabase
        .from('school_application_forms')
        .select('version')
        .eq('school_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!curErr && cur && typeof cur.version === 'number') {
        nextVersion = cur.version + 1;
      }
    } catch (e) {
      // ignore
    }

    const { data, error } = await supabase
      .from('school_application_forms')
      .insert({ school_id: id, form_config: formConfig, version: nextVersion })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ form: data });
  } catch (err) {
    console.error('upsertSchoolForm error:', err);
    res.status(500).json({ error: 'Failed to save school form' });
  }
};

// Country-specific application process config
// Reads latest form_config from school_application_forms and returns process_by_country
const getProcessConfig = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const { country } = req.query || {};
    const { data, error } = await supabase
      .from('school_application_forms')
      .select('form_config')
      .eq('school_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const cfg = (data?.form_config && typeof data.form_config === 'object') ? data.form_config : {};
    const byCountry = cfg.process_by_country && typeof cfg.process_by_country === 'object' ? cfg.process_by_country : {};
    const countries = Object.keys(byCountry);
    const selected = country && byCountry[country] ? byCountry[country] : null;
    res.json({ countries, process_by_country: byCountry, selected: selected ? { country, ...selected } : null });
  } catch (err) {
    console.error('getProcessConfig error:', err);
    res.status(500).json({ error: 'Failed to load process config', details: err?.message || String(err) });
  }
};

// Upsert process config for a school (manager/admin)
const upsertProcessConfig = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const payload = req.body || {};
    const incomingByCountry = (payload.process_by_country && typeof payload.process_by_country === 'object') ? payload.process_by_country : null;
    const targetCountry = payload.country || null;
    const targetSteps = Array.isArray(payload.steps) ? payload.steps : null;
    const targetDocs = Array.isArray(payload.required_documents) ? payload.required_documents : null;

    // Load current latest form_config
    const { data: cur } = await supabase
      .from('school_application_forms')
      .select('form_config, version')
      .eq('school_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const currentCfg = (cur?.form_config && typeof cur.form_config === 'object') ? cur.form_config : {};
    const next = { ...currentCfg };
    const byCountry = (next.process_by_country && typeof next.process_by_country === 'object') ? { ...next.process_by_country } : {};

    if (incomingByCountry) {
      // Merge incoming map into existing
      Object.keys(incomingByCountry).forEach((ct) => {
        const entry = incomingByCountry[ct] || {};
        byCountry[ct] = {
          steps: Array.isArray(entry.steps) ? entry.steps : (byCountry[ct]?.steps || []),
          required_documents: Array.isArray(entry.required_documents) ? entry.required_documents : (byCountry[ct]?.required_documents || []),
        };
      });
    } else if (targetCountry) {
      const prev = byCountry[targetCountry] || { steps: [], required_documents: [] };
      byCountry[targetCountry] = {
        steps: targetSteps !== null ? targetSteps : prev.steps,
        required_documents: targetDocs !== null ? targetDocs : prev.required_documents,
      };
    } else {
      return res.status(400).json({ error: 'Provide process_by_country map or { country, steps?, required_documents? }' });
    }

    next.process_by_country = byCountry;

    // Determine next version
    let nextVersion = 1;
    try {
      const { data: curMax } = await supabase
        .from('school_application_forms')
        .select('version')
        .eq('school_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (curMax && typeof curMax.version === 'number') nextVersion = curMax.version + 1;
    } catch {}

    const { data: inserted, error: insErr } = await supabase
      .from('school_application_forms')
      .insert({ school_id: id, form_config: next, version: nextVersion })
      .select()
      .single();
    if (insErr) throw insErr;
    res.status(201).json({ form: inserted });
  } catch (err) {
    console.error('upsertProcessConfig error:', err);
    res.status(500).json({ error: 'Failed to save process config', details: err?.message || String(err) });
  }
};

// Get current user's checklist progress for a given school and country
const getStudentProcessProgress = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const country = String(req.query.country || '').trim();
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
    if (!country) return res.status(400).json({ error: 'country is required' });
    
    // Use service role to bypass RLS policies
    const serviceClient = getServiceClient();
    const { data, error } = await serviceClient
      .from('student_process_progress')
      .select('checked_indices')
      .eq('user_id', req.user.id)
      .eq('school_id', id)
      .eq('country', country)
      .maybeSingle();
    if (error) throw error;
    res.json({ checked_indices: Array.isArray(data?.checked_indices) ? data.checked_indices : [] });
  } catch (err) {
    console.error('getStudentProcessProgress error:', err);
    res.status(500).json({ error: 'Failed to load progress', details: err?.message || String(err) });
  }
};

// Upsert current user's checklist progress
const upsertStudentProcessProgress = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const { country, checked_indices } = req.body || {};
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
    if (!country) return res.status(400).json({ error: 'country is required' });
    const indices = Array.isArray(checked_indices) ? checked_indices.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0) : [];
    const payload = { user_id: req.user.id, school_id: id, country: String(country), checked_indices: indices, updated_at: new Date().toISOString() };
    
    // Use service role to bypass RLS policies
    const serviceClient = getServiceClient();
    const { data, error } = await serviceClient
      .from('student_process_progress')
      .upsert(payload, { onConflict: 'user_id,school_id,country' })
      .select('checked_indices')
      .single();
    if (error) throw error;
    res.status(201).json({ checked_indices: data?.checked_indices || [] });
  } catch (err) {
    console.error('upsertStudentProcessProgress error:', err);
    res.status(500).json({ error: 'Failed to save progress', details: err?.message || String(err) });
  }
};

// Submit an application to a given school (student)
const submitApplicationToSchool = async (req, res) => {
  try {
    const { id: schoolId } = req.params;
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const studentId = req.user.id;
    const payload = req.body || {};
    const applicationData = payload.application_data || payload.data || {};
    const status = (payload.status || 'submitted').toLowerCase();
    const priority = (payload.priority || 'medium').toLowerCase();

    // Resolve school -> institution (optional)
    let institutionId = null;
    try {
      const { data: schoolRow } = await supabase
        .from('schools')
        .select('institution_id')
        .eq('id', schoolId)
        .maybeSingle();
      institutionId = schoolRow?.institution_id || null;
    } catch (_) {}

    // Insert into student_applications
    const insertApp = {
      student_id: studentId,
      institution_id: institutionId,
      template_id: null,
      stage_id: null,
      application_data: applicationData,
      status,
      priority,
      notes: payload.notes || null,
      score: payload.score || null,
      submitted_at: status === 'submitted' ? new Date().toISOString() : null,
    };
    const { data: appRow, error: appErr } = await supabase
      .from('student_applications')
      .insert(insertApp)
      .select()
      .single();
    if (appErr) throw appErr;

    // Track per-school for student's submissions page
    const track = {
      user_id: studentId,
      school_id: schoolId,
      application_id: appRow.id,
      application_type: payload.application_type || 'regular',
      current_status: status,
      priority_level: Number(payload.priority_level) || 3,
      submitted_at: status === 'submitted' ? new Date().toISOString() : null,
      last_updated: new Date().toISOString(),
      notes: payload.tracking_notes || null,
      required_documents: Array.isArray(payload.required_documents) ? payload.required_documents : [],
      submitted_documents: Array.isArray(payload.submitted_documents) ? payload.submitted_documents : [],
    };
    const { error: trackErr } = await supabase
      .from('student_application_tracking')
      .insert(track);
    if (trackErr) {
      // Non-fatal; log and continue
      console.warn('Tracking insert failed:', trackErr);
    }

    res.status(201).json({ application: appRow });
  } catch (err) {
    console.error('submitApplicationToSchool error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
};

// Check if requester manages the school or is admin
const ensureSchoolManagerOrAdmin = async (req, schoolId) => {
  try {
    if (req.user?.role === ROLES.ADMIN) return true;
    if (!req.user?.id) return false;
    const { data, error } = await supabase
      .from('school_managers')
      .select('user_id')
      .eq('school_id', schoolId)
      .eq('user_id', req.user.id)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
};

// List applications for a school (manager) or own (student) with ?mine=1
const listSchoolApplications = async (req, res) => {
  try {
    const { id: schoolId } = req.params;
    const mine = String(req.query.mine || '').toLowerCase() === '1';

    if (!mine) {
      const allowed = await ensureSchoolManagerOrAdmin(req, schoolId);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    }

    let query = supabase
      .from('student_application_tracking')
      .select('id, user_id, school_id, application_id, application_type, current_status, priority_level, submitted_at, last_updated, notes, required_documents, submitted_documents, student_applications:student_applications(*), users:users(id, email, first_name, last_name)')
      .eq('school_id', schoolId)
      .order('submitted_at', { ascending: false, nullsLast: true });

    if (mine && req.user?.id) {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ applications: data || [] });
  } catch (err) {
    console.error('listSchoolApplications error:', err);
    res.status(500).json({ error: 'Failed to list applications' });
  }
};

// List current user's applications across all schools (student view)
const listMyApplications = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const { data, error } = await supabase
      .from('student_application_tracking')
      .select(`
        id, user_id, school_id, application_id, application_type, current_status, priority_level,
        submitted_at, last_updated, notes, required_documents, submitted_documents,
        schools:schools ( id, name, short_name, logo_url, location_city, location_country, school_type ),
        student_applications:student_applications ( id, status, priority, submitted_at )
      `)
      .eq('user_id', req.user.id)
      .order('last_updated', { ascending: false, nullsLast: true });

    if (error) throw error;
    res.json({ applications: data || [] });
  } catch (err) {
    console.error('listMyApplications error:', err);
    res.status(500).json({ error: 'Failed to list my applications' });
  }
};

// Update an application (manager can change status/notes/stage; student can move draft->submitted)
const updateApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const body = req.body || {};

    // Accept either student_application id OR tracking id
    let targetAppId = applicationId;
    let trackRow = null;

    // Try app by id first
    let { data: app, error: appErr } = await supabase
      .from('student_applications')
      .select('*')
      .eq('id', targetAppId)
      .maybeSingle();

    if (appErr || !app) {
      // If not found, assume tracking id and resolve application_id
      const { data: track, error: tErr } = await supabase
        .from('student_application_tracking')
        .select('id, application_id, school_id, user_id, current_status')
      .eq('id', applicationId)
        .maybeSingle();
      if (tErr || !track?.application_id) return res.status(404).json({ error: 'Application not found' });
      trackRow = track;
      targetAppId = track.application_id;
      const got = await supabase
        .from('student_applications')
        .select('*')
        .eq('id', targetAppId)
      .single();
      if (got.error || !got.data) return res.status(404).json({ error: 'Application not found' });
      app = got.data;
    } else {
      // get tracking by application id for auth and status sync
      const tr = await supabase
      .from('student_application_tracking')
      .select('id, school_id, user_id, current_status')
        .eq('application_id', targetAppId)
      .maybeSingle();
      trackRow = tr?.data || null;
    }

    const schoolId = trackRow?.school_id || null;

    const isOwner = req.user?.id && app.student_id === req.user.id;
    const isManager = schoolId ? await ensureSchoolManagerOrAdmin(req, schoolId) : false;

    if (!isOwner && !isManager) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Prepare updates
    const appUpdate = {};
    if (isManager) {
      if (body.status) appUpdate.status = String(body.status).toLowerCase();
      if (body.stage_id !== undefined) appUpdate.stage_id = body.stage_id;
      if (body.notes !== undefined) appUpdate.notes = body.notes;
      if (body.priority) appUpdate.priority = String(body.priority).toLowerCase();
      if (body.score !== undefined) appUpdate.score = body.score;
      if (appUpdate.status && appUpdate.status !== app.status && ['accepted','rejected','under_review','submitted','waitlisted'].includes(appUpdate.status)) {
        appUpdate.reviewed_by = req.user.id;
        appUpdate.reviewed_at = new Date().toISOString();
      }
    } else if (isOwner) {
      // Owner can save draft answers and promote to submitted
      if (body.application_data && app.status === 'draft') {
        appUpdate.application_data = body.application_data;
      }
      if (body.status && String(body.status).toLowerCase() === 'submitted' && app.status === 'draft') {
        // If school has fee configured, require succeeded payment before submit
        let requiresFee = false;
        let schoolRow = null;
        try {
          const s = await supabase.from('schools').select('id, application_fee').eq('id', trackRow?.school_id).maybeSingle();
          schoolRow = s?.data || null;
          let fee = schoolRow?.application_fee;
          
          // If no school-level fee, check form-level fee
          if (!fee || Number(fee) <= 0) {
            const { data: tracking } = await supabase
              .from('student_application_tracking')
              .select('form_config')
              .eq('id', trackRow?.id)
              .single();
            
            if (tracking?.form_config?.settings?.application_fee) {
              fee = tracking.form_config.settings.application_fee;
            }
          }
          
          requiresFee = !!fee && Number(fee) > 0;
        } catch {}
        if (requiresFee) {
          const pay = await supabase
            .from('application_payments')
            .select('id, status')
            .eq('application_id', trackRow?.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const latest = pay?.data || null;
          if (!latest || latest.status !== 'succeeded') {
            return res.status(400).json({ error: 'Application fee required and not paid' });
          }
        }
        appUpdate.status = 'submitted';
        appUpdate.submitted_at = new Date().toISOString();
      }
    }

    let updatedApp = app;
    if (Object.keys(appUpdate).length > 0) {
      const { data: newApp, error: updErr } = await supabase
        .from('student_applications')
        .update(appUpdate)
        .eq('id', targetAppId)
        .select()
        .single();
      if (updErr) throw updErr;
      updatedApp = newApp;
    }

    // Sync tracking current_status if given
    if (trackRow?.id && (body.status || appUpdate.status)) {
      await supabase
        .from('student_application_tracking')
        .update({ current_status: appUpdate.status || body.status, last_updated: new Date().toISOString() })
        .eq('id', trackRow.id);
    }

    res.json({ application: updatedApp });
  } catch (err) {
    console.error('updateApplication error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  }
};

// Delete or withdraw an application tracking
const deleteOrWithdrawApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const hard = String(req.query.hard || '').toLowerCase() === '1';

    // Load tracking and application
    const { data: track, error: tErr } = await supabase
      .from('student_application_tracking')
      .select('id, application_id, user_id, current_status')
      .eq('id', applicationId)
      .maybeSingle();
    if (tErr || !track) return res.status(404).json({ error: 'Tracking not found' });

    // Only owner or admin can act
    const isOwner = req.user?.id && track.user_id === req.user.id;
    const isAdmin = req.user?.role === ROLES.ADMIN;
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    if (hard && track.current_status === 'draft') {
      // Delete tracking and orphaned application row if exists
      if (track.application_id) {
        await supabase.from('student_applications').delete().eq('id', track.application_id);
      }
      await supabase.from('student_application_tracking').delete().eq('id', track.id);
      return res.json({ success: true, action: 'deleted' });
    }

    // Withdraw: mark both records accordingly
    if (track.application_id) {
      await supabase
        .from('student_applications')
        .update({ status: 'withdrawn', reviewed_at: new Date().toISOString() })
        .eq('id', track.application_id);
    }
    await supabase
      .from('student_application_tracking')
      .update({ current_status: 'withdrawn', last_updated: new Date().toISOString() })
      .eq('id', track.id);
    return res.json({ success: true, action: 'withdrawn' });
  } catch (err) {
    console.error('deleteOrWithdrawApplication error:', err);
    res.status(500).json({ error: 'Failed to update application state' });
  }
};

// Resources (Successful Applications / Entrance Exams)
// Table: school_resources
// Columns: id (pk), school_id, resource_type ('success'|'exam'|'other'), title, content_html, attachments (json[]), category, tags (text[]), created_by, created_at, updated_at
const listSchoolResources = async (req, res) => {
  try {
    const { id } = req.params; // school id
    // Allow all authenticated users to read resources (RLS policy handles security)
    const type = String(req.query.type || '').toLowerCase();
    const category = (req.query.category ?? '').toString().trim();
    
    // Use service role to bypass RLS policies
    const serviceClient = getServiceClient();
    let query = serviceClient
      .from('school_resources')
      .select('*')
      .eq('school_id', id)
      .order('created_at', { ascending: false });
    if (type && ['success','exam','other'].includes(type)) {
      query = query.eq('resource_type', type);
    }
    if (category) {
      query = query.ilike('category', `%${category}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ resources: data || [] });
  } catch (err) {
    console.error('listSchoolResources error:', err);
    res.status(500).json({ message: 'Failed to list resources', details: err?.message || String(err) });
  }
};

const addSchoolResource = async (req, res) => {
  try {
    const { id } = req.params; // school id
    const allowed = await ensureSchoolManagerOrAdmin(req, id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { resource_type, title, content_html, attachments, category, tags } = req.body || {};
    if (!resource_type || !['success','exam','other'].includes(String(resource_type).toLowerCase())) {
      return res.status(400).json({ error: 'resource_type must be one of success|exam|other' });
    }
    if (!title || String(title).trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }
    const payload = {
      school_id: id,
      resource_type: String(resource_type).toLowerCase(),
      title: String(title).trim(),
      content_html: content_html || null,
      attachments: Array.isArray(attachments) ? attachments : [],
      category: category || null,
      tags: Array.isArray(tags) ? tags : null,
      created_by: req.user?.id || null,
    };
    const { data, error } = await supabase
      .from('school_resources')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ resource: data });
  } catch (err) {
    console.error('addSchoolResource error:', err);
    res.status(500).json({ message: 'Failed to add resource', details: err?.message || String(err) });
  }
};

const updateSchoolResource = async (req, res) => {
  try {
    const { resourceId } = req.params;
    // Load to check school and auth
    const { data: row, error: rowErr } = await supabase
      .from('school_resources')
      .select('school_id')
      .eq('id', resourceId)
      .maybeSingle();
    if (rowErr || !row?.school_id) return res.status(404).json({ error: 'Resource not found' });
    const allowed = await ensureSchoolManagerOrAdmin(req, row.school_id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { title, content_html, attachments, category, tags, resource_type } = req.body || {};
    const update = {};
    if (title !== undefined) update.title = String(title);
    if (content_html !== undefined) update.content_html = content_html;
    if (attachments !== undefined) update.attachments = Array.isArray(attachments) ? attachments : [];
    if (category !== undefined) update.category = category;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags : null;
    if (resource_type && ['success','exam','other'].includes(String(resource_type).toLowerCase())) update.resource_type = String(resource_type).toLowerCase();
    const { data, error } = await supabase
      .from('school_resources')
      .update(update)
      .eq('id', resourceId)
      .select()
      .single();
    if (error) throw error;
    res.json({ resource: data });
  } catch (err) {
    console.error('updateSchoolResource error:', err);
    res.status(500).json({ message: 'Failed to update resource', details: err?.message || String(err) });
  }
};

// Create a draft application and corresponding tracking row
const trackNewApplication = async (req, res) => {
  try {
    const { id: schoolId } = req.params;
    const userId = req.user?.id || req.auth?.userId || req.body.user_id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Prevent duplicates: return existing tracking if present
    try {
      const { data: existing } = await supabase
        .from('student_application_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('school_id', String(schoolId))
        .order('last_updated', { ascending: false, nullsLast: true })
        .limit(1)
        .maybeSingle();
      if (existing) {
        return res.status(409).json({ error: 'Application already exists for this school', tracking: existing });
      }
    } catch (_) {}

    // Enforce 25 school limit
    try {
      const { data: allApps, error: countErr } = await supabase
        .from('student_application_tracking')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      const count = allApps?.length || 0;
      if (count >= 25) {
        return res.status(400).json({ error: 'Maximum 25 applications allowed per student' });
      }
    } catch (_) {}

    // Resolve institution for the school (optional)
    let institutionId = null;
    try {
      const { data: schoolRow } = await supabase
        .from('schools')
        .select('institution_id')
        .eq('id', schoolId)
        .maybeSingle();
      institutionId = schoolRow?.institution_id || null;
    } catch (_) {}

    // 1) Create a draft application row
    const appInsert = {
      student_id: userId,
      institution_id: institutionId,
      template_id: null,
      stage_id: null,
      application_data: {},
      status: 'draft',
      priority: 'medium',
      notes: null,
      score: null,
      submitted_at: null,
    };
    const { data: appRow, error: appErr } = await supabase
      .from('student_applications')
      .insert(appInsert)
      .select()
      .single();
    if (appErr) throw appErr;

    // 2) Create tracking row linked to the application
    const trackInsert = {
      user_id: userId,
      school_id: String(schoolId),
      application_id: appRow.id,
      application_type: 'regular',
      current_status: 'draft',
      priority_level: 3,
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
    const { data: trackingRow, error: trackErr } = await supabase
      .from('student_application_tracking')
      .insert(trackInsert)
      .select()
      .single();
    if (trackErr) throw trackErr;

    res.status(201).json({ tracking: trackingRow, application: appRow });
  } catch (err) {
    console.error('trackNewApplication error:', err);
    res.status(500).json({ error: 'Failed to create application tracking' });
  }
};

const deleteSchoolResource = async (req, res) => {
  try {
    const { resourceId } = req.params;
    const { data: row, error: rowErr } = await supabase
      .from('school_resources')
      .select('school_id')
      .eq('id', resourceId)
      .maybeSingle();
    if (rowErr || !row?.school_id) return res.status(404).json({ error: 'Resource not found' });
    const allowed = await ensureSchoolManagerOrAdmin(req, row.school_id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { error } = await supabase
      .from('school_resources')
      .delete()
      .eq('id', resourceId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteSchoolResource error:', err);
    res.status(500).json({ message: 'Failed to delete resource', details: err?.message || String(err) });
  }
};

module.exports = {
  listSchools,
  getSchool,
  createSchool,
  updateSchool,
  deleteSchool,
  // process & progress
  getProcessConfig,
  upsertProcessConfig,
  getStudentProcessProgress,
  upsertStudentProcessProgress,
  // managers
  listSchoolManagers,
  addSchoolManager,
  removeSchoolManager,
  // applications/forms
  getSchoolForm,
  upsertSchoolForm,
  submitApplicationToSchool,
  listSchoolApplications,
  // new: my applications across schools
  listMyApplications,
  updateApplication,
  // media (gallery)
  listSchoolMedia,
  addSchoolMedia,
  deleteSchoolMedia,
  // living costs
  listSchoolLivingCosts,
  addSchoolLivingCost,
  deleteSchoolLivingCost,
  // scholarships
  listSchoolScholarships,
  addSchoolScholarship,
  deleteSchoolScholarship,
  // resources
  listSchoolResources,
  addSchoolResource,
  updateSchoolResource,
  deleteSchoolResource,
  trackNewApplication,
  // managed
  listMyManagedSchools,
  // payments & recommenders
  createApplicationPaymentSession,
  getApplicationPaymentStatus,
  listApplicationRecommenders,
  inviteRecommender,
  // payments extra
  waiveApplicationFee,
  // form alias
  getActiveSchoolForm,
  // documents
  listApplicationDocuments,
  addApplicationDocument,
  deleteApplicationDocument,
  // appended in export above
};

// --- Application Payments ---
async function createApplicationPaymentSession(req, res) {
  try {
    const { applicationId } = req.params;
    console.log('Creating payment session for applicationId:', applicationId);
    
    const { data: appRow, error: appErr } = await supabase
      .from('student_application_tracking')
      .select('id, student_id, school_id')
      .eq('id', applicationId)
      .single();
    
    console.log('Application lookup result:', { appRow, appErr });
    
    if (appErr || !appRow) {
      console.error('Application not found:', { applicationId, appErr });
      return res.status(404).json({ error: 'Application not found' });
    }
    if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
    const { data: school } = await supabase.from('schools').select('application_fee,name').eq('id', appRow.school_id).single();
    
    // Check for application fee in multiple places
    let feeAmount = null;
    
    // First check school-level fee
    if (school?.application_fee && Number(school.application_fee) > 0) {
      feeAmount = Number(school.application_fee);
    }
    
    // If no school-level fee, check form-level fee from application tracking
    if (!feeAmount) {
      const { data: tracking } = await supabase
        .from('student_application_tracking')
        .select('form_config')
        .eq('id', applicationId)
        .single();
      
      if (tracking?.form_config?.settings?.application_fee && Number(tracking.form_config.settings.application_fee) > 0) {
        feeAmount = Number(tracking.form_config.settings.application_fee);
      }
    }
    
    const amount = feeAmount ? Math.round(feeAmount * 100) : null;
    if (!amount) return res.status(400).json({ error: 'No application fee configured' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: (process.env.PUBLIC_APP_URL || 'https://www.pythagoras.com') + `/submissions?paid=1&applicationId=${encodeURIComponent(String(applicationId))}`,
      cancel_url: (process.env.PUBLIC_APP_URL || 'https://www.pythagoras.com') + `/submissions?paid=0&applicationId=${encodeURIComponent(String(applicationId))}`,
      line_items: [{ price_data: { currency: 'usd', product_data: { name: `${school?.name || 'School'} application fee` }, unit_amount: amount }, quantity: 1 }],
      metadata: { application_id: String(applicationId), student_id: String(appRow.student_id), school_id: String(appRow.school_id) },
    });
    await supabase.from('application_payments').insert({ application_id: applicationId, amount_cents: amount, currency: 'USD', status: 'requires_payment', stripe_checkout_session_id: session.id });
    return res.json({ url: session.url, id: session.id });
  } catch (e) {
    console.error('createApplicationPaymentSession error:', e);
    return res.status(500).json({ error: 'Failed to create payment session' });
  }
}

async function getApplicationPaymentStatus(req, res) {
  try {
    const { applicationId } = req.params;
    const { data, error } = await supabase
      .from('application_payments')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return res.json({ payment: data || null });
  } catch (e) {
    console.error('getApplicationPaymentStatus error:', e);
    return res.status(500).json({ error: 'Failed to get payment status' });
  }
}

// --- Recommenders ---
async function listApplicationRecommenders(req, res) {
  try {
    const { applicationId } = req.params;
    const { data, error } = await supabase
      .from('recommenders')
      .select('id, email, name, relationship, status, submitted_at, created_at')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ recommenders: data || [] });
  } catch (e) {
    console.error('listApplicationRecommenders error:', e);
    return res.status(500).json({ error: 'Failed to list recommenders' });
  }
}

// --- Payments extra ---
async function waiveApplicationFee(req, res) {
  try {
    const { applicationId } = req.params;
    const reason = (req.body?.reason || 'waived').toString();
    // Only managers/admin via controller-level check
    const { data: track } = await supabase
      .from('student_application_tracking')
      .select('id, school_id')
      .eq('id', applicationId)
      .maybeSingle();
    const allowed = track?.school_id ? await ensureSchoolManagerOrAdmin(req, track.school_id) : false;
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    await supabase
      .from('application_payments')
      .insert({ application_id: applicationId, amount_cents: 0, currency: 'USD', status: 'succeeded', metadata: { waived: true, reason } });
    await supabase
      .from('student_application_tracking')
      .update({ fee_paid: true, last_updated: new Date().toISOString() })
      .eq('id', applicationId);
    return res.json({ success: true });
  } catch (e) {
    console.error('waiveApplicationFee error:', e);
    return res.status(500).json({ error: 'Failed to waive fee' });
  }
}

// --- Form alias ---
async function getActiveSchoolForm(req, res) {
  return getSchoolForm(req, res);
}
async function inviteRecommender(req, res) {
  try {
    const { applicationId } = req.params;
    const { email, name, relationship } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });
    // Generate secure token (32 bytes = 64 hex chars)
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const { data, error } = await supabase
      .from('recommenders')
      .insert({ application_id: applicationId, email, name: name || null, relationship: relationship || null, status: 'invited', token_hash: tokenHash, token_expires_at: expiresAt.toISOString() })
      .select()
      .single();
    if (error) throw error;
    const inviteUrl = (process.env.PUBLIC_APP_URL || 'https://www.pythagoras.com') + `/recommend/${token}`;
    return res.status(201).json({ recommender: { ...data, token_hash: undefined }, invite_url: inviteUrl });
  } catch (e) {
    console.error('inviteRecommender error:', e);
    return res.status(500).json({ error: 'Failed to invite recommender' });
  }
}

// --- Application Documents ---
async function listApplicationDocuments(req, res) {
  try {
    const { applicationId } = req.params;
    const { data, error } = await supabase
      .from('application_documents')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ documents: data || [] });
  } catch (e) {
    console.error('listApplicationDocuments error:', e);
    return res.status(500).json({ error: 'Failed to list application documents' });
  }
}

async function addApplicationDocument(req, res) {
  try {
    const { applicationId } = req.params;
    const { category, name, url, type, size, metadata } = req.body || {};
    if (!url || !name) return res.status(400).json({ error: 'name and url are required' });
    const { data, error } = await supabase
      .from('application_documents')
      .insert({ application_id: applicationId, category: category || null, name, url, type: type || null, size: size || null, metadata: metadata || null })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ document: data });
  } catch (e) {
    console.error('addApplicationDocument error:', e);
    return res.status(500).json({ error: 'Failed to add application document' });
  }
}

async function deleteApplicationDocument(req, res) {
  try {
    const { documentId } = req.params;
    const { error } = await supabase
      .from('application_documents')
      .delete()
      .eq('id', documentId);
    if (error) throw error;
    return res.json({ success: true });
  } catch (e) {
    console.error('deleteApplicationDocument error:', e);
    return res.status(500).json({ error: 'Failed to delete application document' });
  }
}


