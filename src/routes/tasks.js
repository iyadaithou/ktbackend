const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateToken, authorize } = require('../middleware/auth');

/**
 * TASK MANAGEMENT ROUTES
 * 
 * These routes handle individual task CRUD operations for the task management system.
 * Tasks can be assigned by schools to students who have applied to them.
 * 
 * Purpose: Allow users to view, create, update, and complete tasks assigned to them.
 */

// Get all tasks for a user with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      type, 
      status, 
      priority, 
      application_id, 
      school_id,
      page = 1, 
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    const userId = req.user.id;
    const offset = (page - 1) * limit;

    // Simplified query without joins to avoid foreign key issues
    let query = supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', userId);

    // Apply filters
    if (type) query = query.eq('task_type', type);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (application_id) query = query.eq('application_id', application_id);
    if (school_id) query = query.eq('school_id', school_id);

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: tasks, error, count } = await query;

    if (error) {
      console.error('Error fetching tasks:', error);
      return res.status(500).json({ error: 'Failed to fetch tasks' });
    }

    res.json({
      tasks,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in tasks GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific task by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: task, error } = await supabase
      .from('tasks')
      .select(`
        *,
        assignee:assigned_to(first_name, last_name, email),
        assigner:assigned_by(first_name, last_name, email),
        application:applications(id, application_status, application_stage),
        school:schools(id, name, short_name),
        checklist_items:task_checklist_items(*),
        attachments:task_attachments(*)
      `)
      .eq('id', id)
      .eq('assigned_to', userId)
      .single();

    if (error) {
      console.error('Error fetching task:', error);
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    console.error('Error in task GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new task
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      description,
      task_type,
      priority = 'medium',
      assigned_to,
      application_id,
      school_id,
      due_date,
      checklist_items = []
    } = req.body;

    const userId = req.user.id;

    // Validate required fields
    if (!title || !assigned_to) {
      return res.status(400).json({ error: 'Title and assigned_to are required' });
    }

    // Resolve assigned_to (could be Clerk ID or UUID)
    let assignedToId = assigned_to;
    
    // If assigned_to is a Clerk ID (starts with 'user_'), resolve to Supabase user ID
    if (assigned_to && assigned_to.startsWith('user_')) {
      const { data: assignedUser, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('clerk_id', assigned_to)
        .single();
      
      if (userError || !assignedUser) {
        console.error('Error resolving assigned_to user:', userError);
        return res.status(400).json({ error: 'Invalid assigned_to user' });
      }
      
      assignedToId = assignedUser.id;
    }

    // Create the task
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert({
        title,
        description,
        task_type,
        priority,
        assigned_by: userId,
        assigned_to: assignedToId,
        application_id,
        school_id,
        due_date
      })
      .select()
      .single();

    if (taskError) {
      console.error('Error creating task:', taskError);
      return res.status(500).json({ error: 'Failed to create task' });
    }

    // Create checklist items if provided
    if (checklist_items.length > 0) {
      const checklistData = checklist_items.map((item, index) => ({
        task_id: task.id,
        title: item.title,
        description: item.description,
        order_index: index
      }));

      const { error: checklistError } = await supabase
        .from('task_checklist_items')
        .insert(checklistData);

      if (checklistError) {
        console.error('Error creating checklist items:', checklistError);
        // Don't fail the entire request, just log the error
      }
    }

    // Create notification for the assigned user
    await supabase
      .from('task_notifications')
      .insert({
        user_id: assigned_to,
        task_id: task.id,
        application_id,
        notification_type: 'task_assigned',
        title: 'New Task Assigned',
        message: `You have been assigned a new task: ${title}`
      });

    res.status(201).json(task);
  } catch (error) {
    console.error('Error in task POST:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a task
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    // Check if user can update this task
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('assigned_to, assigned_by')
      .eq('id', id)
      .single();

    if (fetchError || !existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Only the assigned user or the assigner can update
    if (existingTask.assigned_to !== userId && existingTask.assigned_by !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this task' });
    }

    // Update the task
    const { data: task, error } = await supabase
      .from('tasks')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating task:', error);
      return res.status(500).json({ error: 'Failed to update task' });
    }

    res.json(task);
  } catch (error) {
    console.error('Error in task PUT:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark task as completed
router.patch('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user can complete this task
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('assigned_to, status')
      .eq('id', id)
      .single();

    if (fetchError || !existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (existingTask.assigned_to !== userId) {
      return res.status(403).json({ error: 'Not authorized to complete this task' });
    }

    if (existingTask.status === 'completed') {
      return res.status(400).json({ error: 'Task is already completed' });
    }

    // Update task status
    const { data: task, error } = await supabase
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error completing task:', error);
      return res.status(500).json({ error: 'Failed to complete task' });
    }

    // Create notification for task completion
    await supabase
      .from('task_notifications')
      .insert({
        user_id: existingTask.assigned_to,
        task_id: id,
        notification_type: 'task_completed',
        title: 'Task Completed',
        message: `Task "${task.title}" has been completed`
      });

    res.json(task);
  } catch (error) {
    console.error('Error in task complete:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a task
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user can delete this task
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('assigned_by')
      .eq('id', id)
      .single();

    if (fetchError || !existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (existingTask.assigned_by !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this task' });
    }

    // Delete the task
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting task:', error);
      return res.status(500).json({ error: 'Failed to delete task' });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error in task DELETE:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get upcoming tasks for a user
router.get('/upcoming', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', userId)
      .in('status', ['pending', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching upcoming tasks:', error);
      return res.status(500).json({ error: 'Failed to fetch upcoming tasks' });
    }

    res.json({ tasks: tasks || [] });
  } catch (error) {
    console.error('Error in upcoming tasks GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get task statistics for a user
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get task counts by status
    const { data: statusCounts, error: statusError } = await supabase
      .from('tasks')
      .select('status')
      .eq('assigned_to', userId);

    if (statusError) {
      console.error('Error fetching status counts:', statusError);
      return res.status(500).json({ error: 'Failed to fetch task statistics' });
    }

    // Get task counts by type
    const { data: typeCounts, error: typeError } = await supabase
      .from('tasks')
      .select('task_type')
      .eq('assigned_to', userId);

    if (typeError) {
      console.error('Error fetching type counts:', typeError);
      return res.status(500).json({ error: 'Failed to fetch task statistics' });
    }

    // Get overdue tasks
    const { data: overdueTasks, error: overdueError } = await supabase
      .from('tasks')
      .select('id')
      .eq('assigned_to', userId)
      .eq('status', 'pending')
      .lt('due_date', new Date().toISOString());

    if (overdueError) {
      console.error('Error fetching overdue tasks:', overdueError);
      return res.status(500).json({ error: 'Failed to fetch task statistics' });
    }

    // Process statistics
    const stats = {
      total: statusCounts.length,
      by_status: {
        pending: statusCounts.filter(t => t.status === 'pending').length,
        in_progress: statusCounts.filter(t => t.status === 'in_progress').length,
        completed: statusCounts.filter(t => t.status === 'completed').length,
        overdue: statusCounts.filter(t => t.status === 'overdue').length,
        cancelled: statusCounts.filter(t => t.status === 'cancelled').length
      },
      by_type: {
        school_assigned: typeCounts.filter(t => t.task_type === 'school_assigned').length,
        pythagoras_assigned: typeCounts.filter(t => t.task_type === 'pythagoras_assigned').length,
        self_assigned: typeCounts.filter(t => t.task_type === 'self_assigned').length
      },
      overdue_count: overdueTasks.length
    };

    res.json(stats);
  } catch (error) {
    console.error('Error in task stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
