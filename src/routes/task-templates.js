const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { authenticateToken, authorize } = require('../middleware/auth');

/**
 * TASK TEMPLATE MANAGEMENT ROUTES
 * 
 * These routes handle reusable task templates for the task management system.
 * Templates allow schools to quickly assign common tasks to applicants.
 * 
 * Purpose: Allow admins and school managers to create, manage, and use task templates.
 */

// Get all task templates
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      school_id, 
      task_type, 
      is_active = true,
      page = 1, 
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('task_templates')
      .select(`
        *,
        creator:created_by(first_name, last_name, email),
        school:school_id(id, name, short_name)
      `)
      .eq('is_active', is_active);

    // Apply filters
    if (school_id) query = query.eq('school_id', school_id);
    if (task_type) query = query.eq('task_type', task_type);

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: templates, error, count } = await query;

    if (error) {
      console.error('Error fetching task templates:', error);
      return res.status(500).json({ error: 'Failed to fetch task templates' });
    }

    res.json({
      templates,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in task templates GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific task template by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: template, error } = await supabase
      .from('task_templates')
      .select(`
        *,
        creator:created_by(first_name, last_name, email),
        school:school_id(id, name, short_name)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching task template:', error);
      return res.status(404).json({ error: 'Task template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error in task template GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new task template (admin/school manager only)
router.post('/', authenticateToken, authorize(['admin', 'school_manager']), async (req, res) => {
  try {
    const {
      name,
      description,
      task_type,
      title,
      template_description,
      estimated_duration,
      required_documents = [],
      prerequisites = [],
      auto_assign = false,
      school_id
    } = req.body;

    const userId = req.user.id;

    // Validate required fields
    if (!name || !task_type || !title) {
      return res.status(400).json({ error: 'Name, task_type, and title are required' });
    }

    // Create the task template
    const { data: template, error } = await supabase
      .from('task_templates')
      .insert({
        name,
        description,
        task_type,
        title,
        template_description,
        estimated_duration,
        required_documents,
        prerequisites,
        auto_assign,
        school_id,
        created_by: userId
      })
      .select(`
        *,
        creator:created_by(first_name, last_name, email),
        school:school_id(id, name, short_name)
      `)
      .single();

    if (error) {
      console.error('Error creating task template:', error);
      return res.status(500).json({ error: 'Failed to create task template' });
    }

    res.status(201).json(template);
  } catch (error) {
    console.error('Error in task template POST:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a task template (admin/school manager only)
router.put('/:id', authenticateToken, authorize(['admin', 'school_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.created_by;
    delete updates.created_at;

    // Add updated_at timestamp
    updates.updated_at = new Date().toISOString();

    const { data: template, error } = await supabase
      .from('task_templates')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        creator:created_by(first_name, last_name, email),
        school:school_id(id, name, short_name)
      `)
      .single();

    if (error) {
      console.error('Error updating task template:', error);
      return res.status(500).json({ error: 'Failed to update task template' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error in task template PUT:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a task template (admin/school manager only)
router.delete('/:id', authenticateToken, authorize(['admin', 'school_manager']), async (req, res) => {
  try {
    const { id } = req.params;

    // Soft delete by setting is_active to false
    const { data: template, error } = await supabase
      .from('task_templates')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error deleting task template:', error);
      return res.status(500).json({ error: 'Failed to delete task template' });
    }

    res.json({ message: 'Task template deleted successfully' });
  } catch (error) {
    console.error('Error in task template DELETE:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get task templates by category
router.get('/category/:task_type', authenticateToken, async (req, res) => {
  try {
    const { task_type } = req.params;
    const { school_id } = req.query;

    let query = supabase
      .from('task_templates')
      .select(`
        *,
        creator:created_by(first_name, last_name, email),
        school:school_id(id, name, short_name)
      `)
      .eq('task_type', task_type)
      .eq('is_active', true);

    if (school_id) {
      query = query.eq('school_id', school_id);
    }

    const { data: templates, error } = await query;

    if (error) {
      console.error('Error fetching task templates by category:', error);
      return res.status(500).json({ error: 'Failed to fetch task templates' });
    }

    res.json(templates);
  } catch (error) {
    console.error('Error in task templates by category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get task template statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const { school_id } = req.query;

    let query = supabase
      .from('task_templates')
      .select('task_type, is_active')
      .eq('is_active', true);

    if (school_id) {
      query = query.eq('school_id', school_id);
    }

    const { data: templates, error } = await query;

    if (error) {
      console.error('Error fetching template statistics:', error);
      return res.status(500).json({ error: 'Failed to fetch template statistics' });
    }

    // Process statistics
    const stats = {
      total: templates.length,
      by_type: {
        document_submission: templates.filter(t => t.task_type === 'document_submission').length,
        interview: templates.filter(t => t.task_type === 'interview').length,
        financial: templates.filter(t => t.task_type === 'financial').length,
        academic: templates.filter(t => t.task_type === 'academic').length,
        administrative: templates.filter(t => t.task_type === 'administrative').length
      }
    };

    res.json(stats);
  } catch (error) {
    console.error('Error in template stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
