const supabase = require('../config/supabase');

// List representatives (admin; supports include_inactive)
const listRepresentatives = async (req, res) => {
  try {
    const { include_inactive } = req.query || {};
    let query = supabase
      .from('representatives')
      .select('*')
      .order('updated_at', { ascending: false, nullsLast: true });
    if (!include_inactive || include_inactive === 'false') {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query;
    if (error) {
      console.error('Supabase error (list reps):', error);
      throw error;
    }
    res.json({ representatives: data || [] });
  } catch (err) {
    console.error('listRepresentatives error:', err);
    res.status(500).json({ error: 'Failed to list representatives' });
  }
};

// Public-only list (no auth, only active)
const listRepresentativesPublic = async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('representatives')
      .select('*')
      .eq('is_active', true)
      .order('full_name');
    if (error) {
      console.error('Supabase error (public reps):', error);
      throw error;
    }
    res.json({ representatives: data || [] });
  } catch (err) {
    console.error('listRepresentativesPublic error:', err);
    res.status(500).json({ error: 'Failed to list representatives' });
  }
};

const createRepresentative = async (req, res) => {
  try {
    const p = req.body || {};
    
    // Input validation
    if (!p.full_name || typeof p.full_name !== 'string') {
      return res.status(400).json({ error: 'full_name is required and must be a string' });
    }
    
    // Sanitize and validate inputs
    const sanitizedData = {
      full_name: p.full_name.trim().substring(0, 255),
      pronouns: p.pronouns ? String(p.pronouns).trim().substring(0, 50) : null,
      major: p.major ? String(p.major).trim().substring(0, 255) : null,
      location_state: p.location_state ? String(p.location_state).trim().substring(0, 100) : null,
      location_country: p.location_country ? String(p.location_country).trim().substring(0, 100) : null,
      avatar_url: p.avatar_url ? String(p.avatar_url).trim().substring(0, 500) : null,
      bio: p.bio ? String(p.bio).trim().substring(0, 2000) : null,
      preferred_contact: p.preferred_contact ? String(p.preferred_contact).trim().substring(0, 50) : null,
      contact_value: p.contact_value ? String(p.contact_value).trim().substring(0, 255) : null,
      calendly_url: p.calendly_url ? String(p.calendly_url).trim().substring(0, 500) : null,
      is_active: typeof p.is_active === 'boolean' ? p.is_active : true,
    };
    
    // Validate URLs if provided
    if (sanitizedData.avatar_url) {
      try {
        new URL(sanitizedData.avatar_url);
      } catch {
        return res.status(400).json({ error: 'Invalid avatar_url format' });
      }
    }
    
    if (sanitizedData.calendly_url) {
      try {
        new URL(sanitizedData.calendly_url);
      } catch {
        return res.status(400).json({ error: 'Invalid calendly_url format' });
      }
    }
    
    const { data, error } = await supabase
      .from('representatives')
      .insert(sanitizedData)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ representative: data });
  } catch (err) {
    console.error('createRepresentative error:', err);
    res.status(500).json({ error: 'Failed to create representative' });
  }
};

const updateRepresentative = async (req, res) => {
  try {
    const { id } = req.params;
    const p = req.body || {};
    
    // Build sanitized update object
    const updateRaw = {};
    
    // Validate and sanitize each field if provided
    if (p.full_name !== undefined) {
      if (typeof p.full_name !== 'string' || !p.full_name.trim()) {
        return res.status(400).json({ error: 'full_name must be a non-empty string' });
      }
      updateRaw.full_name = p.full_name.trim().substring(0, 255);
    }
    
    if (p.pronouns !== undefined) {
      updateRaw.pronouns = p.pronouns ? String(p.pronouns).trim().substring(0, 50) : null;
    }
    
    if (p.major !== undefined) {
      updateRaw.major = p.major ? String(p.major).trim().substring(0, 255) : null;
    }
    
    if (p.location_state !== undefined) {
      updateRaw.location_state = p.location_state ? String(p.location_state).trim().substring(0, 100) : null;
    }
    
    if (p.location_country !== undefined) {
      updateRaw.location_country = p.location_country ? String(p.location_country).trim().substring(0, 100) : null;
    }
    
    if (p.avatar_url !== undefined) {
      if (p.avatar_url) {
        try {
          new URL(p.avatar_url);
          updateRaw.avatar_url = String(p.avatar_url).trim().substring(0, 500);
        } catch {
          return res.status(400).json({ error: 'Invalid avatar_url format' });
        }
      } else {
        updateRaw.avatar_url = null;
      }
    }
    
    if (p.bio !== undefined) {
      updateRaw.bio = p.bio ? String(p.bio).trim().substring(0, 2000) : null;
    }
    
    if (p.preferred_contact !== undefined) {
      updateRaw.preferred_contact = p.preferred_contact ? String(p.preferred_contact).trim().substring(0, 50) : null;
    }
    
    if (p.contact_value !== undefined) {
      updateRaw.contact_value = p.contact_value ? String(p.contact_value).trim().substring(0, 255) : null;
    }
    
    if (p.calendly_url !== undefined) {
      if (p.calendly_url) {
        try {
          new URL(p.calendly_url);
          updateRaw.calendly_url = String(p.calendly_url).trim().substring(0, 500);
        } catch {
          return res.status(400).json({ error: 'Invalid calendly_url format' });
        }
      } else {
        updateRaw.calendly_url = null;
      }
    }
    
    if (p.is_active !== undefined) {
      if (typeof p.is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active must be a boolean' });
      }
      updateRaw.is_active = p.is_active;
    }
    
    // Check if there's anything to update
    if (Object.keys(updateRaw).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    const { data, error } = await supabase
      .from('representatives')
      .update(updateRaw)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ representative: data });
  } catch (err) {
    console.error('updateRepresentative error:', err);
    res.status(500).json({ error: 'Failed to update representative' });
  }
};

const deleteRepresentative = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('representatives').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteRepresentative error:', err);
    res.status(500).json({ error: 'Failed to delete representative' });
  }
};

module.exports = {
  listRepresentatives,
  listRepresentativesPublic,
  createRepresentative,
  updateRepresentative,
  deleteRepresentative,
};


