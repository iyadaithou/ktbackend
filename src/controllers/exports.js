const supabase = require('../config/supabase');
const { ROLES } = require('../utils/roles');
const XLSX = require('xlsx');

// Helper to check school manager or admin
async function ensureSchoolManagerOrAdmin(req, schoolId) {
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
}

// Export applications to CSV
async function exportApplicationsCSV(req, res) {
  try {
    const { schoolId } = req.params;
    const allowed = await ensureSchoolManagerOrAdmin(req, schoolId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const { data: applications, error } = await supabase
      .from('student_application_tracking')
      .select(`
        id, user_id, application_id, application_type, current_status, priority_level,
        submitted_at, last_updated, notes, fee_paid,
        users:users(id, email, first_name, last_name),
        student_applications:student_applications(application_data, score)
      `)
      .eq('school_id', schoolId)
      .order('submitted_at', { ascending: false, nullsLast: true });

    if (error) throw error;

    // Build CSV
    const headers = [
      'Application ID',
      'Student Email',
      'Student Name',
      'Status',
      'Type',
      'Priority',
      'Fee Paid',
      'Submitted At',
      'Score',
      'Notes'
    ];

    const rows = (applications || []).map(app => {
      const user = app.users || {};
      const studentApp = app.student_applications || {};
      return [
        app.id || '',
        user.email || '',
        `${user.first_name || ''} ${user.last_name || ''}`.trim() || '',
        app.current_status || '',
        app.application_type || '',
        app.priority_level || '',
        app.fee_paid ? 'Yes' : 'No',
        app.submitted_at || '',
        studentApp.score || '',
        (app.notes || '').replace(/"/g, '""') // Escape quotes
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${schoolId}-${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    console.error('exportApplicationsCSV error:', err);
    return res.status(500).json({ error: 'Failed to export applications' });
  }
}

// Export applications to XLSX
async function exportApplicationsXLSX(req, res) {
  try {
    const { schoolId } = req.params;
    const allowed = await ensureSchoolManagerOrAdmin(req, schoolId);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const { data: applications, error } = await supabase
      .from('student_application_tracking')
      .select(`
        id, user_id, application_id, application_type, current_status, priority_level,
        submitted_at, last_updated, notes, fee_paid,
        users:users(id, email, first_name, last_name),
        student_applications:student_applications(application_data, score)
      `)
      .eq('school_id', schoolId)
      .order('submitted_at', { ascending: false, nullsLast: true });

    if (error) throw error;

    // Prepare data for XLSX
    const data = (applications || []).map(app => {
      const user = app.users || {};
      const studentApp = app.student_applications || {};
      return {
        'Application ID': app.id || '',
        'Student Email': user.email || '',
        'First Name': user.first_name || '',
        'Last Name': user.last_name || '',
        'Status': app.current_status || '',
        'Type': app.application_type || '',
        'Priority': app.priority_level || '',
        'Fee Paid': app.fee_paid ? 'Yes' : 'No',
        'Submitted At': app.submitted_at || '',
        'Last Updated': app.last_updated || '',
        'Score': studentApp.score || '',
        'Notes': app.notes || ''
      };
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    
    // Set column widths
    const colWidths = [
      { wch: 15 }, // Application ID
      { wch: 25 }, // Student Email
      { wch: 15 }, // First Name
      { wch: 15 }, // Last Name
      { wch: 15 }, // Status
      { wch: 10 }, // Type
      { wch: 10 }, // Priority
      { wch: 10 }, // Fee Paid
      { wch: 20 }, // Submitted At
      { wch: 20 }, // Last Updated
      { wch: 10 }, // Score
      { wch: 30 }  // Notes
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Applications');

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${schoolId}-${Date.now()}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    console.error('exportApplicationsXLSX error:', err);
    return res.status(500).json({ error: 'Failed to export applications' });
  }
}

// Export all applications (admin only)
async function exportAllApplications(req, res) {
  try {
    if (req.user?.role !== ROLES.ADMIN) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const format = req.query.format || 'csv';
    const schoolId = req.query.schoolId;

    let query = supabase
      .from('student_application_tracking')
      .select(`
        id, user_id, application_id, application_type, current_status, priority_level,
        submitted_at, last_updated, notes, fee_paid, school_id,
        users:users(id, email, first_name, last_name),
        student_applications:student_applications(application_data, score),
        schools:schools(id, name, short_name)
      `)
      .order('submitted_at', { ascending: false, nullsLast: true });

    if (schoolId) {
      query = query.eq('school_id', schoolId);
    }

    const { data: applications, error } = await query;
    if (error) throw error;

    if (format === 'xlsx') {
      // XLSX export
      const data = (applications || []).map(app => {
        const user = app.users || {};
        const studentApp = app.student_applications || {};
        const school = app.schools || {};
        return {
          'Application ID': app.id || '',
          'School': school.name || school.short_name || '',
          'Student Email': user.email || '',
          'First Name': user.first_name || '',
          'Last Name': user.last_name || '',
          'Status': app.current_status || '',
          'Type': app.application_type || '',
          'Priority': app.priority_level || '',
          'Fee Paid': app.fee_paid ? 'Yes' : 'No',
          'Submitted At': app.submitted_at || '',
          'Last Updated': app.last_updated || '',
          'Score': studentApp.score || '',
          'Notes': app.notes || ''
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      
      const colWidths = [
        { wch: 15 }, { wch: 25 }, { wch: 25 }, { wch: 15 }, { wch: 15 },
        { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
        { wch: 20 }, { wch: 10 }, { wch: 30 }
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'All Applications');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="all-applications-${Date.now()}.xlsx"`);
      return res.send(buffer);
    } else {
      // CSV export
      const headers = [
        'Application ID', 'School', 'Student Email', 'Student Name', 'Status',
        'Type', 'Priority', 'Fee Paid', 'Submitted At', 'Score', 'Notes'
      ];

      const rows = (applications || []).map(app => {
        const user = app.users || {};
        const studentApp = app.student_applications || {};
        const school = app.schools || {};
        return [
          app.id || '',
          school.name || school.short_name || '',
          user.email || '',
          `${user.first_name || ''} ${user.last_name || ''}`.trim() || '',
          app.current_status || '',
          app.application_type || '',
          app.priority_level || '',
          app.fee_paid ? 'Yes' : 'No',
          app.submitted_at || '',
          studentApp.score || '',
          (app.notes || '').replace(/"/g, '""')
        ];
      });

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="all-applications-${Date.now()}.csv"`);
      return res.send(csvContent);
    }
  } catch (err) {
    console.error('exportAllApplications error:', err);
    return res.status(500).json({ error: 'Failed to export applications' });
  }
}

module.exports = {
  exportApplicationsCSV,
  exportApplicationsXLSX,
  exportAllApplications,
};

