const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateToken, authorize } = require('../middleware/auth');

// Helper function to resolve user by any identifier (UUID, Clerk ID, or email)
async function resolveUserByAnyId(anyId) {
  if (!anyId) return null;
  
  console.log('Resolving user by identifier:', anyId);
  
  // 1. Try direct UUID match (most reliable)
  try {
    const { data: userById, error: idError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role, clerk_id')
      .eq('id', anyId)
      .single();
    
    if (!idError && userById) {
      console.log('Found user by UUID:', userById.id);
      return userById;
    }
  } catch (error) {
    console.log('No user found by UUID, trying other methods...');
  }
  
  // 2. Try Clerk ID match
  try {
    const { data: userByClerk, error: clerkError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role, clerk_id')
      .eq('clerk_id', anyId)
      .single();
    
    if (!clerkError && userByClerk) {
      console.log('Found user by Clerk ID:', userByClerk.id);
      return userByClerk;
    }
  } catch (error) {
    console.log('No user found by Clerk ID, trying email...');
  }
  
  // 3. Try email match (case-insensitive)
  try {
    const { data: userByEmail, error: emailError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role, clerk_id')
      .ilike('email', anyId)
      .single();
    
    if (!emailError && userByEmail) {
      console.log('Found user by email:', userByEmail.id);
      return userByEmail;
    }
  } catch (error) {
    console.log('No user found by email');
  }
  
  console.log('User not found with any identifier:', anyId);
  return null;
}

/**
 * USER INTELLIGENCE ROUTES
 * 
 * These routes handle comprehensive user activity tracking and analytics.
 * Provides detailed user behavior analysis, engagement metrics, and activity logs.
 * 
 * Purpose: Allow admins to track and analyze all user activities across the platform.
 */

// Get all users with their activity statistics
router.get('/users', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 100,  // Increased limit to get more users
      search,
      role,
      engagement_min,
      engagement_max,
      sort_by = 'last_active',
      sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

    // Check if Supabase is properly configured
    if (!supabase || !supabase.from) {
      console.error('Supabase client not properly configured');
      throw new Error('Database connection not configured - Supabase credentials are missing or invalid');
    }

    // Build the query for users with their activity statistics
    let query = supabase
      .from('users')
      .select(`
        id,
        first_name,
        last_name,
        email,
        role,
        created_at,
        last_active,
        engagement_score,
        total_sessions,
        total_time_spent,
        applications_submitted,
        tasks_completed,
        risk_level
      `, { count: 'exact' });

    // Apply filters
    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }
    if (role) query = query.eq('role', role);
    if (engagement_min) query = query.gte('engagement_score', engagement_min);
    if (engagement_max) query = query.lte('engagement_score', engagement_max);

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: users, error, count } = await query;

    if (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch users',
        details: error.message,
        hint: 'Check if the users table exists and has the required columns'
      });
    }

    res.json({
      users: users || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error in users GET:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Get detailed user information with activities
router.get('/users/:userId', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('Looking for user with identifier:', userId);

    // Use reliable user lookup
    const resolvedUser = await resolveUserByAnyId(userId);
    if (!resolvedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get full user data with relationships
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`
        *,
        applications:applications(
          id,
          school_id,
          program_id,
          application_status,
          application_stage,
          completion_percentage,
          submitted_at,
          school:schools(name, short_name),
          program:programs(title)
        ),
        tasks:tasks(
          id,
          title,
          status,
          priority,
          task_type,
          due_date,
          completed_at,
          application_id,
          school:schools(name)
        )
      `)
      .eq('id', resolvedUser.id)
      .single();

    if (userError) {
      console.error('Error fetching user details:', userError);
      return res.status(500).json({ error: 'Failed to fetch user details' });
    }

    // Get user activities using the reliable user ID
    const { data: activities, error: activitiesError } = await supabase
      .from('user_activities')
      .select(`
        id,
        activity_type,
        details,
        metadata,
        page_url,
        created_at,
        application_id,
        task_id
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    // Get AI chat history using the reliable user ID
    const { data: aiChats, error: aiChatsError } = await supabase
      .from('global_ai_chats')
      .select(`
        id,
        role,
        content,
        created_at
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Get school AI chats using the reliable user ID
    const { data: schoolChats, error: schoolChatsError } = await supabase
      .from('school_ai_chats')
      .select(`
        id,
        role,
        content,
        created_at,
        school_id
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (activitiesError) {
      console.error('Error fetching user activities:', activitiesError);
    }
    if (aiChatsError) {
      console.error('Error fetching AI chats:', aiChatsError);
    }
    if (schoolChatsError) {
      console.error('Error fetching school chats:', schoolChatsError);
    }

    // Combine all chats
    const allChats = [...(aiChats || []), ...(schoolChats || [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      user,
      activities: activities || [],
      chats: allChats,
      total_activities: activities?.length || 0,
      total_chats: allChats.length
    });
  } catch (error) {
    console.error('Error in user GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user activities with filters
router.get('/users/:userId/activities', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      type,
      start_date,
      end_date,
      page = 1,
      limit = 50,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('user_activities')
      .select(`
        *,
        application:applications(id, school:schools(name)),
        task:tasks(id, title)
      `)
      .eq('user_id', userId);

    // Apply filters
    if (type) query = query.eq('activity_type', type);
    if (start_date) query = query.gte('created_at', start_date);
    if (end_date) query = query.lte('created_at', end_date);

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: activities, error, count } = await query;

    if (error) {
      console.error('Error fetching user activities:', error);
      return res.status(500).json({ error: 'Failed to fetch user activities' });
    }

    res.json({
      activities,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in user activities GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user analytics and engagement metrics
router.get('/users/:userId/analytics', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '30d' } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    switch (period) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // Get activity counts by type
    const { data: activityCounts, error: activityError } = await supabase
      .from('user_activities')
      .select('activity_type')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (activityError) {
      console.error('Error fetching activity counts:', activityError);
      return res.status(500).json({ error: 'Failed to fetch activity analytics' });
    }

    // Get session data
    const { data: sessions, error: sessionError } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (sessionError) {
      console.error('Error fetching session data:', sessionError);
      return res.status(500).json({ error: 'Failed to fetch session analytics' });
    }

    // Get task completion data
    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .select('status, completed_at, created_at')
      .eq('assigned_to', userId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (taskError) {
      console.error('Error fetching task data:', taskError);
      return res.status(500).json({ error: 'Failed to fetch task analytics' });
    }

    // Calculate analytics
    const analytics = {
      period,
      total_activities: activityCounts.length,
      activity_breakdown: activityCounts.reduce((acc, activity) => {
        acc[activity.activity_type] = (acc[activity.activity_type] || 0) + 1;
        return acc;
      }, {}),
      total_sessions: sessions.length,
      total_session_time: sessions.reduce((sum, session) => sum + (session.duration || 0), 0),
      average_session_duration: sessions.length > 0 ? 
        sessions.reduce((sum, session) => sum + (session.duration || 0), 0) / sessions.length : 0,
      task_completion_rate: tasks.length > 0 ? 
        (tasks.filter(t => t.status === 'completed').length / tasks.length) * 100 : 0,
      tasks_completed: tasks.filter(t => t.status === 'completed').length,
      tasks_total: tasks.length,
      engagement_trend: calculateEngagementTrend(activityCounts, startDate, endDate)
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error in user analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log user activity
router.post('/activities', authenticateToken, async (req, res) => {
  try {
    const {
      activity_type,
      details,
      metadata = {},
      application_id,
      task_id,
      page_url,
      ip_address,
      user_agent,
      location
    } = req.body;

    const userId = req.user.id;

    // Validate required fields
    if (!activity_type || !details) {
      return res.status(400).json({ error: 'activity_type and details are required' });
    }

    // Create activity record
    const { data: activity, error } = await supabase
      .from('user_activities')
      .insert({
        user_id: userId,
        activity_type,
        details,
        metadata,
        application_id,
        task_id,
        page_url,
        ip_address,
        user_agent,
        location,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating activity:', error);
      return res.status(500).json({ error: 'Failed to log activity' });
    }

    // Update user's last_active timestamp
    await supabase
      .from('users')
      .update({ last_active: new Date().toISOString() })
      .eq('id', userId);

    res.status(201).json(activity);
  } catch (error) {
    console.error('Error in activity POST:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get platform-wide analytics
router.get('/analytics/overview', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    switch (period) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // Get user counts
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('role, status, created_at, last_active')
      .gte('created_at', startDate.toISOString());

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return res.status(500).json({ error: 'Failed to fetch user analytics' });
    }

    // Get activity counts
    const { data: activities, error: activitiesError } = await supabase
      .from('user_activities')
      .select('activity_type, created_at')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (activitiesError) {
      console.error('Error fetching activities:', activitiesError);
      return res.status(500).json({ error: 'Failed to fetch activity analytics' });
    }

    // Calculate analytics
    const analytics = {
      period,
      total_users: users.length,
      active_users: users.filter(u => u.last_active && new Date(u.last_active) >= startDate).length,
      new_users: users.filter(u => new Date(u.created_at) >= startDate).length,
      users_by_role: users.reduce((acc, user) => {
        acc[user.role] = (acc[user.role] || 0) + 1;
        return acc;
      }, {}),
      total_activities: activities.length,
      activity_breakdown: activities.reduce((acc, activity) => {
        acc[activity.activity_type] = (acc[activity.activity_type] || 0) + 1;
        return acc;
      }, {}),
      engagement_metrics: {
        average_activities_per_user: users.length > 0 ? activities.length / users.length : 0,
        most_active_users: await getMostActiveUsers(startDate, endDate),
        activity_trend: calculateActivityTrend(activities, startDate, endDate)
      }
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error in analytics overview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to calculate engagement trend
function calculateEngagementTrend(activities, startDate, endDate) {
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const dailyActivity = {};
  
  // Initialize daily activity counts
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    dailyActivity[date.toISOString().split('T')[0]] = 0;
  }
  
  // Count activities per day
  activities.forEach(activity => {
    const date = new Date(activity.created_at).toISOString().split('T')[0];
    if (dailyActivity[date] !== undefined) {
      dailyActivity[date]++;
    }
  });
  
  return Object.entries(dailyActivity).map(([date, count]) => ({ date, count }));
}

// Helper function to calculate activity trend
function calculateActivityTrend(activities, startDate, endDate) {
  return calculateEngagementTrend(activities, startDate, endDate);
}

// Helper function to get most active users
async function getMostActiveUsers(startDate, endDate) {
  const { data, error } = await supabase
    .from('user_activities')
    .select('user_id, users(first_name, last_name)')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString());

  if (error) return [];

  const userActivityCounts = data.reduce((acc, activity) => {
    acc[activity.user_id] = (acc[activity.user_id] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(userActivityCounts)
    .map(([userId, count]) => ({
      user_id: userId,
      activity_count: count,
      user: data.find(a => a.user_id === userId)?.users
    }))
    .sort((a, b) => b.activity_count - a.activity_count)
    .slice(0, 10);
}

// Get AI chat history for a user
router.get('/users/:userId/chat-history', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      page = 1, 
      limit = 50,
      start_date,
      end_date
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('user_activities')
      .select(`
        id,
        user_id,
        activity_type,
        activity_data,
        created_at,
        metadata
      `, { count: 'exact' })
      .eq('user_id', userId)
      .eq('activity_type', 'ai_chat')
      .order('created_at', { ascending: false });

    if (start_date) {
      query = query.gte('created_at', start_date);
    }
    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: chatHistory, error, count } = await query;

    if (error) {
      console.error('Error fetching chat history:', error);
      return res.status(500).json({ error: 'Failed to fetch chat history' });
    }

    res.json({
      chat_history: chatHistory || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error in chat history GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all user input and interactions
router.get('/users/:userId/input-history', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      page = 1, 
      limit = 100,
      start_date,
      end_date,
      input_type
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('user_activities')
      .select(`
        id,
        user_id,
        activity_type,
        activity_data,
        created_at,
        metadata,
        session_id
      `, { count: 'exact' })
      .eq('user_id', userId)
      .in('activity_type', ['form_interaction', 'text_input', 'search', 'click', 'ai_chat'])
      .order('created_at', { ascending: false });

    if (input_type) {
      query = query.eq('activity_type', input_type);
    }
    if (start_date) {
      query = query.gte('created_at', start_date);
    }
    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: inputHistory, error, count } = await query;

    if (error) {
      console.error('Error fetching input history:', error);
      return res.status(500).json({ error: 'Failed to fetch input history' });
    }

    res.json({
      input_history: inputHistory || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error in input history GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
