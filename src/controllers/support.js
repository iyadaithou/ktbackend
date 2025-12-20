const supabase = require('../config/supabase');

const tableTickets = 'support_tickets';
const tableComments = 'support_ticket_comments';
const tableEmails = 'support_ticket_emails';

exports.createTicket = async (req, res) => {
  try {
    // Accept either authenticated user.id or a Clerk ID header as a fallback on first login
    let userId = req.user?.id;
    if (!userId && req.user?.clerkId) {
      // Resolve by clerk_id
      const { data: u } = await supabase
        .from('users')
        .select('id')
        .eq('clerk_id', req.user.clerkId)
        .maybeSingle();
      userId = u?.id || null;
    }
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { subject, category, message, priority } = req.body || {};
    if (!subject || !message) return res.status(400).json({ error: 'subject and message are required' });

    const insert = await supabase
      .from(tableTickets)
      .insert({
        user_id: userId,
        subject,
        category: category || 'general',
        message,
        priority: priority || 'normal',
        status: 'open'
      })
      .select()
      .single();
    if (insert.error) return res.status(400).json({ error: insert.error.message });
    return res.status(201).json({ ticket: insert.data });
  } catch (e) {
    console.error('createTicket error:', e);
    return res.status(500).json({ error: 'Failed to create ticket' });
  }
};

exports.listTickets = async (req, res) => {
  try {
    const { status, assignee_id } = req.query;
    let q = supabase.from(tableTickets).select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    if (assignee_id) q = q.eq('assignee_id', assignee_id);
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ tickets: data || [] });
  } catch (e) {
    console.error('listTickets error:', e);
    return res.status(500).json({ error: 'Failed to list tickets' });
  }
};

exports.listMyTickets = async (req, res) => {
  try {
    // Support both internal user id and Clerk ID fallback
    let userId = req.user?.id;
    if (!userId && req.user?.clerkId) {
      const { data: u } = await supabase
        .from('users')
        .select('id')
        .eq('clerk_id', req.user.clerkId)
        .maybeSingle();
      userId = u?.id || null;
    }
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { data, error } = await supabase
      .from(tableTickets)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ tickets: data || [] });
  } catch (e) {
    console.error('listMyTickets error:', e);
    return res.status(500).json({ error: 'Failed to list my tickets' });
  }
};

exports.getTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from(tableTickets).select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'Ticket not found' });
    return res.json({ ticket: data });
  } catch (e) {
    console.error('getTicketById error:', e);
    return res.status(500).json({ error: 'Failed to get ticket' });
  }
};

exports.updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, subject, category } = req.body || {};
    const updateData = {};
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;
    if (subject) updateData.subject = subject;
    if (category) updateData.category = category;
    if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const { data, error } = await supabase.from(tableTickets).update(updateData).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ticket: data });
  } catch (e) {
    console.error('updateTicket error:', e);
    return res.status(500).json({ error: 'Failed to update ticket' });
  }
};

exports.addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'comment body is required' });
    const insert = await supabase
      .from(tableComments)
      .insert({ ticket_id: id, user_id: userId, body })
      .select()
      .single();
    if (insert.error) return res.status(400).json({ error: insert.error.message });
    return res.status(201).json({ comment: insert.data });
  } catch (e) {
    console.error('addComment error:', e);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
};

exports.listComments = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from(tableComments).select('*').eq('ticket_id', id).order('created_at', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ comments: data || [] });
  } catch (e) {
    console.error('listComments error:', e);
    return res.status(500).json({ error: 'Failed to list comments' });
  }
};

exports.assignTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignee_id } = req.body || {};
    if (!assignee_id) return res.status(400).json({ error: 'assignee_id is required' });
    const { data, error } = await supabase.from(tableTickets).update({ assignee_id }).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ticket: data });
  } catch (e) {
    console.error('assignTicket error:', e);
    return res.status(500).json({ error: 'Failed to assign ticket' });
  }
};

exports.sendTicketEmail = async (_req, res) => {
  try {
    const { id } = _req.params;
    const { subject, body, to } = _req.body || {};
    if (!subject || !body) return res.status(400).json({ error: 'subject and body are required' });
    // Persist record (sending can be integrated later with provider/OAuth)
    const insert = await supabase
      .from(tableEmails)
      .insert({ ticket_id: id, direction: 'outbound', subject, body, to_address: to || null, from_address: _req.user?.email || null })
      .select()
      .single();
    if (insert.error) return res.status(400).json({ error: insert.error.message });
    return res.json({ email: insert.data });
  } catch (e) {
    console.error('sendTicketEmail error:', e);
    return res.status(500).json({ error: 'Failed to queue email' });
  }
};

exports.listTicketEmails = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from(tableEmails)
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ emails: data || [] });
  } catch (e) {
    console.error('listTicketEmails error:', e);
    return res.status(500).json({ error: 'Failed to list emails' });
  }
};


