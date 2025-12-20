/**
 * Agent Students routes
 * Handles guest students managed by agents (students without Pythagoras accounts)
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');
const { supabase } = require('../config/supabase');

// All routes require authentication
router.use(authenticate);

/**
 * Get all agent students for the current agent
 * GET /api/agent-students
 */
router.get('/', authorize(PERMISSIONS.MANAGE_AGENT_STUDENTS), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('agent_students')
      .select('*')
      .eq('agent_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching agent students:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get a single agent student
 * GET /api/agent-students/:id
 */
router.get('/:id', authorize(PERMISSIONS.MANAGE_AGENT_STUDENTS), async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('agent_students')
      .select('*')
      .eq('id', id)
      .eq('agent_id', req.user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Student not found'
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching agent student:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Create a new agent student
 * POST /api/agent-students
 * Body: { firstName, lastName, email?, phone?, globalProfileData? }
 */
router.post('/', authorize(PERMISSIONS.CREATE_AGENT_STUDENT), async (req, res) => {
  try {
    const { firstName, lastName, email, phone, globalProfileData } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'firstName and lastName are required'
      });
    }

    const { data, error } = await supabase
      .from('agent_students')
      .insert({
        agent_id: req.user.id,
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        phone: phone || null,
        global_profile_data: globalProfileData || {}
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error creating agent student:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update an agent student
 * PUT /api/agent-students/:id
 * Body: { firstName?, lastName?, email?, phone?, globalProfileData? }
 */
router.put('/:id', authorize(PERMISSIONS.MANAGE_AGENT_STUDENTS), async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, phone, globalProfileData } = req.body;

    // Build update object
    const updateData = {};
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (globalProfileData !== undefined) updateData.global_profile_data = globalProfileData;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('agent_students')
      .update(updateData)
      .eq('id', id)
      .eq('agent_id', req.user.id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Student not found'
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error updating agent student:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update global profile data for an agent student
 * PATCH /api/agent-students/:id/profile
 * Body: { globalProfileData }
 */
router.patch('/:id/profile', authorize(PERMISSIONS.MANAGE_AGENT_STUDENTS), async (req, res) => {
  try {
    const { id } = req.params;
    const { globalProfileData } = req.body;

    if (!globalProfileData) {
      return res.status(400).json({
        success: false,
        error: 'globalProfileData is required'
      });
    }

    // First get current profile data
    const { data: existing, error: fetchError } = await supabase
      .from('agent_students')
      .select('global_profile_data')
      .eq('id', id)
      .eq('agent_id', req.user.id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Student not found'
        });
      }
      throw fetchError;
    }

    // Merge with existing data
    const mergedData = {
      ...existing.global_profile_data,
      ...globalProfileData
    };

    const { data, error } = await supabase
      .from('agent_students')
      .update({
        global_profile_data: mergedData,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('agent_id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error updating agent student profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete an agent student
 * DELETE /api/agent-students/:id
 */
router.delete('/:id', authorize(PERMISSIONS.MANAGE_AGENT_STUDENTS), async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('agent_students')
      .delete()
      .eq('id', id)
      .eq('agent_id', req.user.id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Student deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting agent student:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get applications for an agent student
 * GET /api/agent-students/:id/applications
 */
router.get('/:id/applications', authorize(PERMISSIONS.MANAGE_AGENT_STUDENTS), async (req, res) => {
  try {
    const { id } = req.params;

    // Verify the student belongs to this agent
    const { data: student, error: studentError } = await supabase
      .from('agent_students')
      .select('id')
      .eq('id', id)
      .eq('agent_id', req.user.id)
      .single();

    if (studentError || !student) {
      return res.status(404).json({
        success: false,
        error: 'Student not found'
      });
    }

    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        school:school_id (
          id,
          name,
          logo_url,
          location_city,
          location_country
        )
      `)
      .eq('agent_student_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


