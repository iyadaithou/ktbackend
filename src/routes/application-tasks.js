const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { authenticateToken, authorize } = require('../middleware/auth');

/**
 * APPLICATION TASK MANAGEMENT ROUTES
 * 
 * These routes handle task assignment and management within the application process.
 * This is separate from the core application submission/review system.
 * 
 * Purpose: Allow schools to assign tasks to students who have applied to them,
 * track progress, and manage the application workflow through task completion.
 */

// Get all applications for a school (admin/school manager only)
router.get('/school/:schoolId', authenticateToken, authorize(['admin', 'school_manager']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { 
      status, 
      stage, 
      page = 1, 
      limit = 20,
      sort_by = 'submitted_at',
      sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('application_summary')
      .select('*')
      .eq('school_id', schoolId);

    // Apply filters
    if (status) query = query.eq('application_status', status);
    if (stage) query = query.eq('application_stage', stage);

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: applications, error, count } = await query;

    if (error) {
      console.error('Error fetching applications:', error);
      return res.status(500).json({ error: 'Failed to fetch applications' });
    }

    res.json({
      applications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in applications GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get applications for a specific applicant
router.get('/my-applications', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      status, 
      stage, 
      page = 1, 
      limit = 20,
      sort_by = 'submitted_at',
      sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('application_summary')
      .select('*')
      .eq('applicant_id', userId);

    // Apply filters
    if (status) query = query.eq('application_status', status);
    if (stage) query = query.eq('application_stage', stage);

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: applications, error, count } = await query;

    if (error) {
      console.error('Error fetching applications:', error);
      return res.status(500).json({ error: 'Failed to fetch applications' });
    }

    res.json({
      applications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in my-applications GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific application by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: application, error } = await supabase
      .from('applications')
      .select(`
        *,
        applicant:applicant_id(first_name, last_name, email),
        school:school_id(id, name, short_name),
        program:program_id(id, title),
        progress:application_progress(*),
        tasks:tasks(*),
        smart_recommendations:smart_recommendations(*)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching application:', error);
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check if user can access this application
    if (application.applicant_id !== userId && req.user.role !== 'admin' && req.user.role !== 'school_manager') {
      return res.status(403).json({ error: 'Not authorized to view this application' });
    }

    res.json(application);
  } catch (error) {
    console.error('Error in application GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new application
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      school_id,
      program_id,
      application_data = {}
    } = req.body;

    const userId = req.user.id;

    // Validate required fields
    if (!school_id) {
      return res.status(400).json({ error: 'School ID is required' });
    }

    // Create the application
    const { data: application, error } = await supabase
      .from('applications')
      .insert({
        applicant_id: userId,
        school_id,
        program_id,
        application_status: 'submitted',
        application_stage: 'initial_review',
        completion_percentage: 0,
        submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating application:', error);
      return res.status(500).json({ error: 'Failed to create application' });
    }

    // Create initial progress record
    await supabase
      .from('application_progress')
      .insert({
        application_id: application.id,
        applicant_id: userId,
        school_id,
        program_id,
        stage: 'initial_review',
        completion_percentage: 0,
        tasks_completed: 0,
        tasks_total: 0
      });

    res.status(201).json(application);
  } catch (error) {
    console.error('Error in application POST:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update application status (admin/school manager only)
router.patch('/:id/status', authenticateToken, authorize(['admin', 'school_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, stage, notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const updateData = {
      application_status: status,
      updated_at: new Date().toISOString()
    };

    if (stage) updateData.application_stage = stage;
    if (notes) updateData.notes = notes;

    // Add reviewed_at timestamp if status is being changed
    if (status !== 'submitted') {
      updateData.reviewed_at = new Date().toISOString();
    }

    const { data: application, error } = await supabase
      .from('applications')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating application status:', error);
      return res.status(500).json({ error: 'Failed to update application status' });
    }

    // Create notification for the applicant
    await supabase
      .from('task_notifications')
      .insert({
        user_id: application.applicant_id,
        application_id: id,
        notification_type: 'application_updated',
        title: 'Application Status Updated',
        message: `Your application status has been updated to: ${status}`
      });

    res.json(application);
  } catch (error) {
    console.error('Error in application status update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign tasks to an application (admin/school manager only)
router.post('/:id/assign-tasks', authenticateToken, authorize(['admin', 'school_manager']), async (req, res) => {
  try {
    const { id: applicationId } = req.params;
    const { task_template_ids, due_date, priority = 'medium' } = req.body;

    if (!task_template_ids || !Array.isArray(task_template_ids) || task_template_ids.length === 0) {
      return res.status(400).json({ error: 'Task template IDs are required' });
    }

    // Get application details
    const { data: application, error: appError } = await supabase
      .from('applications')
      .select('applicant_id, school_id')
      .eq('id', applicationId)
      .single();

    if (appError || !application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Get task templates
    const { data: templates, error: templateError } = await supabase
      .from('task_templates')
      .select('*')
      .in('id', task_template_ids);

    if (templateError || !templates || templates.length === 0) {
      return res.status(400).json({ error: 'Invalid task templates' });
    }

    const userId = req.user.id;
    const tasks = [];
    const applicationTasks = [];

    // Create tasks from templates
    for (const template of templates) {
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          title: template.title,
          description: template.template_description,
          task_type: 'school_assigned',
          priority,
          assigned_by: userId,
          assigned_to: application.applicant_id,
          application_id: applicationId,
          school_id: application.school_id,
          due_date
        })
        .select()
        .single();

      if (taskError) {
        console.error('Error creating task:', taskError);
        continue;
      }

      tasks.push(task);

      // Create application task relationship
      const { data: appTask, error: appTaskError } = await supabase
        .from('application_tasks')
        .insert({
          application_id: applicationId,
          task_id: task.id,
          assigned_by: userId,
          due_date,
          status: 'pending'
        })
        .select()
        .single();

      if (appTaskError) {
        console.error('Error creating application task:', appTaskError);
        continue;
      }

      applicationTasks.push(appTask);

      // Create notification for the applicant
      await supabase
        .from('task_notifications')
        .insert({
          user_id: application.applicant_id,
          task_id: task.id,
          application_id: applicationId,
          notification_type: 'task_assigned',
          title: 'New Task Assigned',
          message: `You have been assigned a new task: ${task.title}`
        });
    }

    res.status(201).json({
      message: 'Tasks assigned successfully',
      tasks,
      application_tasks: applicationTasks
    });
  } catch (error) {
    console.error('Error in assign tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get application statistics for a school
router.get('/stats/school/:schoolId', authenticateToken, authorize(['admin', 'school_manager']), async (req, res) => {
  try {
    const { schoolId } = req.params;

    // Get application counts by status
    const { data: statusCounts, error: statusError } = await supabase
      .from('applications')
      .select('application_status')
      .eq('school_id', schoolId);

    if (statusError) {
      console.error('Error fetching status counts:', statusError);
      return res.status(500).json({ error: 'Failed to fetch application statistics' });
    }

    // Get application counts by stage
    const { data: stageCounts, error: stageError } = await supabase
      .from('applications')
      .select('application_stage')
      .eq('school_id', schoolId);

    if (stageError) {
      console.error('Error fetching stage counts:', stageError);
      return res.status(500).json({ error: 'Failed to fetch application statistics' });
    }

    // Get average completion percentage
    const { data: completionData, error: completionError } = await supabase
      .from('applications')
      .select('completion_percentage')
      .eq('school_id', schoolId);

    if (completionError) {
      console.error('Error fetching completion data:', completionError);
      return res.status(500).json({ error: 'Failed to fetch application statistics' });
    }

    const avgCompletion = completionData.length > 0 
      ? completionData.reduce((sum, app) => sum + app.completion_percentage, 0) / completionData.length 
      : 0;

    const stats = {
      total: statusCounts.length,
      by_status: {
        submitted: statusCounts.filter(a => a.application_status === 'submitted').length,
        under_review: statusCounts.filter(a => a.application_status === 'under_review').length,
        documents_required: statusCounts.filter(a => a.application_status === 'documents_required').length,
        interview_scheduled: statusCounts.filter(a => a.application_status === 'interview_scheduled').length,
        interview_completed: statusCounts.filter(a => a.application_status === 'interview_completed').length,
        accepted: statusCounts.filter(a => a.application_status === 'accepted').length,
        rejected: statusCounts.filter(a => a.application_status === 'rejected').length,
        waitlisted: statusCounts.filter(a => a.application_status === 'waitlisted').length
      },
      by_stage: {
        initial_review: stageCounts.filter(a => a.application_stage === 'initial_review').length,
        document_collection: stageCounts.filter(a => a.application_stage === 'document_collection').length,
        interview: stageCounts.filter(a => a.application_stage === 'interview').length,
        final_review: stageCounts.filter(a => a.application_stage === 'final_review').length,
        completed: stageCounts.filter(a => a.application_stage === 'completed').length
      },
      average_completion: Math.round(avgCompletion)
    };

    res.json(stats);
  } catch (error) {
    console.error('Error in application stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
