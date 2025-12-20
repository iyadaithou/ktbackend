const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

/**
 * NOTIFICATION MANAGEMENT ROUTES
 * 
 * These routes handle notifications for the task management system.
 * Notifications alert users about task assignments, due dates, and application updates.
 * 
 * Purpose: Allow users to view, manage, and interact with task-related notifications.
 */

// Get all notifications for a user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      type, 
      is_read, 
      page = 1, 
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('task_notifications')
      .select(`
        *,
        task:tasks(id, title, status),
        application:applications(id, application_status, application_stage)
      `)
      .eq('user_id', userId);

    // Apply filters
    if (type) query = query.eq('notification_type', type);
    if (is_read !== undefined) query = query.eq('is_read', is_read === 'true');

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: notifications, error, count } = await query;

    if (error) {
      console.error('Error fetching notifications:', error);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in notifications GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get unread notification count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { count, error } = await supabase
      .from('task_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error fetching unread count:', error);
      return res.status(500).json({ error: 'Failed to fetch unread count' });
    }

    res.json({ unread_count: count });
  } catch (error) {
    console.error('Error in unread count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: notification, error } = await supabase
      .from('task_notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error marking notification as read:', error);
      return res.status(500).json({ error: 'Failed to mark notification as read' });
    }

    res.json(notification);
  } catch (error) {
    console.error('Error in mark notification read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark all notifications as read
router.patch('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: notifications, error } = await supabase
      .from('task_notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select();

    if (error) {
      console.error('Error marking all notifications as read:', error);
      return res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }

    res.json({ 
      message: 'All notifications marked as read',
      updated_count: notifications.length
    });
  } catch (error) {
    console.error('Error in mark all notifications read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a notification
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('task_notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting notification:', error);
      return res.status(500).json({ error: 'Failed to delete notification' });
    }

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error in delete notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get notification statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get notification counts by type
    const { data: typeCounts, error: typeError } = await supabase
      .from('task_notifications')
      .select('notification_type, is_read')
      .eq('user_id', userId);

    if (typeError) {
      console.error('Error fetching notification type counts:', typeError);
      return res.status(500).json({ error: 'Failed to fetch notification statistics' });
    }

    // Get recent notifications (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentNotifications, error: recentError } = await supabase
      .from('task_notifications')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (recentError) {
      console.error('Error fetching recent notifications:', recentError);
      return res.status(500).json({ error: 'Failed to fetch notification statistics' });
    }

    // Process statistics
    const stats = {
      total: typeCounts.length,
      unread: typeCounts.filter(n => !n.is_read).length,
      read: typeCounts.filter(n => n.is_read).length,
      by_type: {
        task_assigned: typeCounts.filter(n => n.notification_type === 'task_assigned').length,
        task_due_soon: typeCounts.filter(n => n.notification_type === 'task_due_soon').length,
        task_overdue: typeCounts.filter(n => n.notification_type === 'task_overdue').length,
        task_completed: typeCounts.filter(n => n.notification_type === 'task_completed').length,
        application_updated: typeCounts.filter(n => n.notification_type === 'application_updated').length,
        document_required: typeCounts.filter(n => n.notification_type === 'document_required').length,
        interview_scheduled: typeCounts.filter(n => n.notification_type === 'interview_scheduled').length
      },
      recent_count: recentNotifications.length
    };

    res.json(stats);
  } catch (error) {
    console.error('Error in notification stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a notification (internal use)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      user_id,
      task_id,
      application_id,
      notification_type,
      title,
      message
    } = req.body;

    // Validate required fields
    if (!user_id || !notification_type || !title || !message) {
      return res.status(400).json({ error: 'user_id, notification_type, title, and message are required' });
    }

    const { data: notification, error } = await supabase
      .from('task_notifications')
      .insert({
        user_id,
        task_id,
        application_id,
        notification_type,
        title,
        message
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      return res.status(500).json({ error: 'Failed to create notification' });
    }

    res.status(201).json(notification);
  } catch (error) {
    console.error('Error in notification POST:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
