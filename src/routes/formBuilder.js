/**
 * Form Builder routes
 * Handles custom application forms created by schools
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS } = require('../utils/roles');
const { supabase } = require('../config/supabase');

// All routes require authentication
router.use(authenticate);

// ============== SCHOOL ROUTES (Form Management) ==============

/**
 * Get all forms for the current user's school
 * GET /api/form-builder/forms
 */
router.get('/forms', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    // Get the user's school
    const { data: schoolManager, error: managerError } = await supabase
      .from('school_managers')
      .select('school_id')
      .eq('user_id', req.user.id)
      .single();

    if (managerError || !schoolManager) {
      return res.status(403).json({
        success: false,
        error: 'You must be assigned to a school'
      });
    }

    const { data, error } = await supabase
      .from('school_application_forms')
      .select(`
        *,
        sections:school_form_sections (
          id,
          title,
          description,
          order_index,
          is_required,
          questions:school_form_questions (
            id,
            question_type,
            question_text,
            help_text,
            options,
            validation_rules,
            order_index,
            is_required,
            word_limit
          )
        )
      `)
      .eq('school_id', schoolManager.school_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Sort sections and questions by order_index
    const sortedData = data.map(form => ({
      ...form,
      sections: (form.sections || [])
        .sort((a, b) => a.order_index - b.order_index)
        .map(section => ({
          ...section,
          questions: (section.questions || []).sort((a, b) => a.order_index - b.order_index)
        }))
    }));

    res.json({
      success: true,
      data: sortedData
    });
  } catch (error) {
    console.error('Error fetching forms:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Create a new form
 * POST /api/form-builder/forms
 * Body: { formName?, isActive?, requiresGlobalProfile? }
 */
router.post('/forms', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    const { formName, isActive, requiresGlobalProfile } = req.body;

    // Get the user's school
    const { data: schoolManager, error: managerError } = await supabase
      .from('school_managers')
      .select('school_id')
      .eq('user_id', req.user.id)
      .single();

    if (managerError || !schoolManager) {
      return res.status(403).json({
        success: false,
        error: 'You must be assigned to a school'
      });
    }

    const { data, error } = await supabase
      .from('school_application_forms')
      .insert({
        school_id: schoolManager.school_id,
        form_config: {
          name: formName || 'Default Application',
          is_active: isActive !== false,
          requires_global_profile: requiresGlobalProfile !== false
        },
        version: 1
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error creating form:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Add a section to a form
 * POST /api/form-builder/forms/:formId/sections
 * Body: { title, description?, isRequired? }
 */
router.post('/forms/:formId/sections', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    const { formId } = req.params;
    const { title, description, isRequired } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    // Get current max order_index
    const { data: existingSections, error: fetchError } = await supabase
      .from('school_form_sections')
      .select('order_index')
      .eq('form_id', formId)
      .order('order_index', { ascending: false })
      .limit(1);

    if (fetchError) throw fetchError;

    const nextOrder = existingSections.length > 0 ? existingSections[0].order_index + 1 : 0;

    const { data, error } = await supabase
      .from('school_form_sections')
      .insert({
        form_id: formId,
        title,
        description: description || null,
        order_index: nextOrder,
        is_required: isRequired !== false
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error adding section:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update a section
 * PUT /api/form-builder/sections/:sectionId
 * Body: { title?, description?, orderIndex?, isRequired? }
 */
router.put('/sections/:sectionId', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { title, description, orderIndex, isRequired } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (orderIndex !== undefined) updateData.order_index = orderIndex;
    if (isRequired !== undefined) updateData.is_required = isRequired;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('school_form_sections')
      .update(updateData)
      .eq('id', sectionId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error updating section:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete a section
 * DELETE /api/form-builder/sections/:sectionId
 */
router.delete('/sections/:sectionId', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    const { sectionId } = req.params;

    const { error } = await supabase
      .from('school_form_sections')
      .delete()
      .eq('id', sectionId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Section deleted'
    });
  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Add a question to a section
 * POST /api/form-builder/sections/:sectionId/questions
 * Body: { questionType, questionText, helpText?, options?, validationRules?, isRequired?, wordLimit? }
 */
router.post('/sections/:sectionId/questions', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { questionType, questionText, helpText, options, validationRules, isRequired, wordLimit } = req.body;

    if (!questionType || !questionText) {
      return res.status(400).json({
        success: false,
        error: 'questionType and questionText are required'
      });
    }

    const validTypes = ['text', 'textarea', 'select', 'checkbox', 'radio', 'file', 'essay', 'date', 'number'];
    if (!validTypes.includes(questionType)) {
      return res.status(400).json({
        success: false,
        error: `questionType must be one of: ${validTypes.join(', ')}`
      });
    }

    // Get current max order_index
    const { data: existingQuestions, error: fetchError } = await supabase
      .from('school_form_questions')
      .select('order_index')
      .eq('section_id', sectionId)
      .order('order_index', { ascending: false })
      .limit(1);

    if (fetchError) throw fetchError;

    const nextOrder = existingQuestions.length > 0 ? existingQuestions[0].order_index + 1 : 0;

    const { data, error } = await supabase
      .from('school_form_questions')
      .insert({
        section_id: sectionId,
        question_type: questionType,
        question_text: questionText,
        help_text: helpText || null,
        options: options || null,
        validation_rules: validationRules || null,
        order_index: nextOrder,
        is_required: isRequired !== false,
        word_limit: wordLimit || null
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error adding question:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update a question
 * PUT /api/form-builder/questions/:questionId
 */
router.put('/questions/:questionId', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    const { questionId } = req.params;
    const { questionType, questionText, helpText, options, validationRules, orderIndex, isRequired, wordLimit } = req.body;

    const updateData = {};
    if (questionType !== undefined) updateData.question_type = questionType;
    if (questionText !== undefined) updateData.question_text = questionText;
    if (helpText !== undefined) updateData.help_text = helpText;
    if (options !== undefined) updateData.options = options;
    if (validationRules !== undefined) updateData.validation_rules = validationRules;
    if (orderIndex !== undefined) updateData.order_index = orderIndex;
    if (isRequired !== undefined) updateData.is_required = isRequired;
    if (wordLimit !== undefined) updateData.word_limit = wordLimit;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('school_form_questions')
      .update(updateData)
      .eq('id', questionId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete a question
 * DELETE /api/form-builder/questions/:questionId
 */
router.delete('/questions/:questionId', authorize(PERMISSIONS.MANAGE_SCHOOL_FORMS), async (req, res) => {
  try {
    const { questionId } = req.params;

    const { error } = await supabase
      .from('school_form_questions')
      .delete()
      .eq('id', questionId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Question deleted'
    });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============== PUBLIC ROUTES (For Students) ==============

/**
 * Get the active form for a school (for students filling applications)
 * GET /api/form-builder/school/:schoolId/active-form
 */
router.get('/school/:schoolId/active-form', async (req, res) => {
  try {
    const { schoolId } = req.params;

    const { data, error } = await supabase
      .from('school_application_forms')
      .select(`
        *,
        sections:school_form_sections (
          id,
          title,
          description,
          order_index,
          is_required,
          questions:school_form_questions (
            id,
            question_type,
            question_text,
            help_text,
            options,
            validation_rules,
            order_index,
            is_required,
            word_limit
          )
        )
      `)
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return res.json({
        success: true,
        data: null
      });
    }

    // Sort sections and questions
    const sortedData = {
      ...data,
      sections: (data.sections || [])
        .sort((a, b) => a.order_index - b.order_index)
        .map(section => ({
          ...section,
          questions: (section.questions || []).sort((a, b) => a.order_index - b.order_index)
        }))
    };

    res.json({
      success: true,
      data: sortedData
    });
  } catch (error) {
    console.error('Error fetching active form:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Submit responses to a form
 * POST /api/form-builder/submit/:applicationId
 * Body: { responses: [{ questionId, responseText?, responseData?, responseFileUrl? }] }
 */
router.post('/submit/:applicationId', async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { responses } = req.body;

    if (!responses || !Array.isArray(responses)) {
      return res.status(400).json({
        success: false,
        error: 'responses array is required'
      });
    }

    // Verify the application belongs to this user
    const { data: application, error: appError } = await supabase
      .from('applications')
      .select('id, applicant_id')
      .eq('id', applicationId)
      .single();

    if (appError || !application || application.applicant_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Application not found or access denied'
      });
    }

    // Upsert all responses
    const responseData = responses.map(r => ({
      application_id: applicationId,
      question_id: r.questionId,
      response_text: r.responseText || null,
      response_data: r.responseData || null,
      response_file_url: r.responseFileUrl || null
    }));

    const { data, error } = await supabase
      .from('application_responses')
      .upsert(responseData, {
        onConflict: 'application_id,question_id'
      })
      .select();

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error submitting responses:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get responses for an application
 * GET /api/form-builder/responses/:applicationId
 */
router.get('/responses/:applicationId', async (req, res) => {
  try {
    const { applicationId } = req.params;

    const { data, error } = await supabase
      .from('application_responses')
      .select(`
        *,
        question:question_id (
          id,
          question_type,
          question_text
        )
      `)
      .eq('application_id', applicationId);

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching responses:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


