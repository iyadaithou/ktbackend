/**
 * Sales Student Assignments routes
 * Handles assignment of students to sales team members
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
 * Get students assigned to current sales user
 * GET /api/sales-assignments/my-students
 */
router.get('/my-students', authorize(PERMISSIONS.VIEW_ASSIGNED_STUDENTS), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sales_student_assignments')
      .select(`
        id,
        assigned_at,
        student:student_user_id (
          id,
          email,
          first_name,
          last_name,
          profile_image_url
        )
      `)
      .eq('sales_user_id', req.user.id)
      .order('assigned_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data.map(assignment => ({
        ...assignment.student,
        assignedAt: assignment.assigned_at
      }))
    });
  } catch (error) {
    console.error('Error fetching assigned students:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get student details with global profile
 * GET /api/sales-assignments/student/:studentId
 */
router.get('/student/:studentId', authorize(PERMISSIONS.VIEW_ASSIGNED_STUDENTS), async (req, res) => {
  try {
    const { studentId } = req.params;

    // Verify the student is assigned to this sales user
    const { data: assignment, error: assignmentError } = await supabase
      .from('sales_student_assignments')
      .select('id')
      .eq('sales_user_id', req.user.id)
      .eq('student_user_id', studentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(403).json({
        success: false,
        error: 'Student is not assigned to you'
      });
    }

    // Get student with their global profile
    const { data: student, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        first_name,
        last_name,
        profile_image_url,
        global_profiles (*)
      `)
      .eq('id', studentId)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: {
        ...student,
        globalProfile: student.global_profiles?.[0] || null
      }
    });
  } catch (error) {
    console.error('Error fetching student details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get applications for an assigned student
 * GET /api/sales-assignments/student/:studentId/applications
 */
router.get('/student/:studentId/applications', authorize(PERMISSIONS.VIEW_ASSIGNED_STUDENTS), async (req, res) => {
  try {
    const { studentId } = req.params;

    // Verify the student is assigned to this sales user
    const { data: assignment, error: assignmentError } = await supabase
      .from('sales_student_assignments')
      .select('id')
      .eq('sales_user_id', req.user.id)
      .eq('student_user_id', studentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(403).json({
        success: false,
        error: 'Student is not assigned to you'
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
      .eq('applicant_id', studentId)
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

// ============== ADMIN ROUTES ==============

/**
 * Assign a student to a sales user (Admin only)
 * POST /api/sales-assignments/assign
 * Body: { salesUserId, studentUserId }
 */
router.post('/assign', authorize(PERMISSIONS.MANAGE_STUDENT_ASSIGNMENTS), async (req, res) => {
  try {
    const { salesUserId, studentUserId } = req.body;

    if (!salesUserId || !studentUserId) {
      return res.status(400).json({
        success: false,
        error: 'salesUserId and studentUserId are required'
      });
    }

    // Verify the sales user has the sales role
    const { data: salesUser, error: salesError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', salesUserId)
      .single();

    if (salesError || !salesUser || salesUser.role !== 'sales') {
      return res.status(400).json({
        success: false,
        error: 'Invalid sales user'
      });
    }

    // Verify the student exists and has student role
    const { data: student, error: studentError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', studentUserId)
      .single();

    if (studentError || !student || student.role !== 'student') {
      return res.status(400).json({
        success: false,
        error: 'Invalid student user'
      });
    }

    // Create the assignment
    const { data, error } = await supabase
      .from('sales_student_assignments')
      .upsert({
        sales_user_id: salesUserId,
        student_user_id: studentUserId,
        assigned_by: req.user.id
      }, {
        onConflict: 'sales_user_id,student_user_id'
      })
      .select();

    if (error) throw error;

    res.json({
      success: true,
      data: data[0]
    });
  } catch (error) {
    console.error('Error assigning student:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Remove a student assignment (Admin only)
 * DELETE /api/sales-assignments/unassign
 * Body: { salesUserId, studentUserId }
 */
router.delete('/unassign', authorize(PERMISSIONS.MANAGE_STUDENT_ASSIGNMENTS), async (req, res) => {
  try {
    const { salesUserId, studentUserId } = req.body;

    if (!salesUserId || !studentUserId) {
      return res.status(400).json({
        success: false,
        error: 'salesUserId and studentUserId are required'
      });
    }

    const { error } = await supabase
      .from('sales_student_assignments')
      .delete()
      .eq('sales_user_id', salesUserId)
      .eq('student_user_id', studentUserId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Assignment removed'
    });
  } catch (error) {
    console.error('Error removing assignment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get all sales-student assignments (Admin only)
 * GET /api/sales-assignments/all
 */
router.get('/all', authorize(PERMISSIONS.MANAGE_STUDENT_ASSIGNMENTS), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sales_student_assignments')
      .select(`
        id,
        assigned_at,
        sales_user:sales_user_id (
          id,
          email,
          first_name,
          last_name
        ),
        student:student_user_id (
          id,
          email,
          first_name,
          last_name
        ),
        assigned_by_user:assigned_by (
          id,
          first_name,
          last_name
        )
      `)
      .order('assigned_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching all assignments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get unassigned students (Admin only)
 * GET /api/sales-assignments/unassigned-students
 */
router.get('/unassigned-students', authorize(PERMISSIONS.MANAGE_STUDENT_ASSIGNMENTS), async (req, res) => {
  try {
    // Get all students
    const { data: allStudents, error: studentsError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, created_at')
      .eq('role', 'student')
      .order('created_at', { ascending: false });

    if (studentsError) throw studentsError;

    // Get assigned student IDs
    const { data: assignments, error: assignmentsError } = await supabase
      .from('sales_student_assignments')
      .select('student_user_id');

    if (assignmentsError) throw assignmentsError;

    const assignedIds = new Set(assignments.map(a => a.student_user_id));

    // Filter to only unassigned
    const unassignedStudents = allStudents.filter(s => !assignedIds.has(s.id));

    res.json({
      success: true,
      data: unassignedStudents
    });
  } catch (error) {
    console.error('Error fetching unassigned students:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


