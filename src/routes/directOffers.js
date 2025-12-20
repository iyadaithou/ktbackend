/**
 * Direct Offers routes
 * Handles the reverse application marketplace where schools send offers to students
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { PERMISSIONS, ROLES } = require('../utils/roles');
const { supabase } = require('../config/supabase');

// All routes require authentication
router.use(authenticate);

// ============== STUDENT ROUTES ==============

/**
 * Get opt-in status and offers for current student
 * GET /api/direct-offers/student/status
 */
router.get('/student/status', async (req, res) => {
  try {
    // Get student's global profile with pool status
    const { data: profile, error: profileError } = await supabase
      .from('global_profiles')
      .select('id, legal_first_name, legal_last_name, pool_visible, pool_opted_in_at, pool_verified_at')
      .eq('user_id', req.user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') throw profileError;

    // Check if profile is complete (has minimum required fields)
    const isProfileComplete = profile && 
      profile.id && 
      profile.legal_first_name && 
      profile.legal_last_name;

    res.json({
      success: true,
      data: {
        hasProfile: !!profile,
        isProfileComplete,
        isProfileVerified: !!profile?.pool_verified_at,
        poolVisible: profile?.pool_visible || false,
        optedInAt: profile?.pool_opted_in_at || null,
        verifiedAt: profile?.pool_verified_at || null
      }
    });
  } catch (error) {
    console.error('Error fetching student status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Verify profile before joining pool
 * POST /api/direct-offers/student/verify
 */
router.post('/student/verify', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('global_profiles')
      .update({
        pool_verified_at: new Date().toISOString()
      })
      .eq('user_id', req.user.id)
      .select('pool_verified_at')
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: {
        isProfileVerified: true,
        verifiedAt: data.pool_verified_at
      }
    });
  } catch (error) {
    console.error('Error verifying profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Opt in/out of the student pool
 * POST /api/direct-offers/student/opt-in
 * Body: { visible: boolean }
 */
router.post('/student/opt-in', authorize(PERMISSIONS.OPT_INTO_POOL), async (req, res) => {
  try {
    const { visible } = req.body;

    if (typeof visible !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'visible must be a boolean'
      });
    }

    const updateData = {
      pool_visible: visible,
      pool_opted_in_at: visible ? new Date().toISOString() : null
    };

    const { data, error } = await supabase
      .from('global_profiles')
      .update(updateData)
      .eq('user_id', req.user.id)
      .select('pool_visible, pool_opted_in_at')
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error updating opt-in status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get all offers for current student
 * GET /api/direct-offers/student/offers
 */
router.get('/student/offers', authorize(PERMISSIONS.VIEW_DIRECT_OFFERS), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('direct_offers')
      .select(`
        *,
        school:school_id (
          id,
          name,
          logo_url,
          location_city,
          location_country,
          website
        )
      `)
      .eq('student_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Respond to an offer (accept/decline)
 * POST /api/direct-offers/student/respond/:offerId
 * Body: { response: 'accepted' | 'declined', notes?: string }
 */
router.post('/student/respond/:offerId', authorize(PERMISSIONS.RESPOND_TO_OFFERS), async (req, res) => {
  try {
    const { offerId } = req.params;
    const { response, notes } = req.body;

    if (!['accepted', 'declined'].includes(response)) {
      return res.status(400).json({
        success: false,
        error: 'Response must be "accepted" or "declined"'
      });
    }

    // Verify the offer belongs to this student
    const { data: offer, error: offerError } = await supabase
      .from('direct_offers')
      .select('id, status')
      .eq('id', offerId)
      .eq('student_id', req.user.id)
      .single();

    if (offerError || !offer) {
      return res.status(404).json({
        success: false,
        error: 'Offer not found'
      });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Offer has already been responded to'
      });
    }

    const { data, error } = await supabase
      .from('direct_offers')
      .update({
        status: response,
        student_response_at: new Date().toISOString(),
        student_notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', offerId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error responding to offer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============== SCHOOL ROUTES ==============

/**
 * Browse anonymized student pool
 * GET /api/direct-offers/school/pool
 * Query: { minGpa?, maxGpa?, intendedMajor?, location? }
 */
router.get('/school/pool', authorize(PERMISSIONS.BROWSE_STUDENT_POOL), async (req, res) => {
  try {
    const { minGpa, maxGpa, intendedMajor, location } = req.query;

    let query = supabase
      .from('global_profiles')
      .select(`
        id,
        gpa,
        class_rank,
        test_scores,
        intended_majors,
        activities,
        personal_essay,
        city,
        state_province,
        country,
        languages,
        pool_opted_in_at
      `)
      .eq('pool_visible', true);

    // Apply filters
    if (minGpa) {
      query = query.gte('gpa', parseFloat(minGpa));
    }
    if (maxGpa) {
      query = query.lte('gpa', parseFloat(maxGpa));
    }
    if (intendedMajor) {
      query = query.contains('intended_majors', [intendedMajor]);
    }
    if (location) {
      query = query.or(`city.ilike.%${location}%,state_province.ilike.%${location}%,country.ilike.%${location}%`);
    }

    const { data, error } = await query.order('pool_opted_in_at', { ascending: false });

    if (error) throw error;

    // Return anonymized data (no name, email, phone, address)
    res.json({
      success: true,
      data: data.map(profile => ({
        id: profile.id,
        gpa: profile.gpa,
        classRank: profile.class_rank,
        testScores: profile.test_scores,
        intendedMajors: profile.intended_majors,
        activities: profile.activities,
        personalEssay: profile.personal_essay,
        location: {
          city: profile.city,
          state: profile.state_province,
          country: profile.country
        },
        languages: profile.languages,
        optedInAt: profile.pool_opted_in_at
      }))
    });
  } catch (error) {
    console.error('Error browsing student pool:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get a specific anonymized student profile
 * GET /api/direct-offers/school/pool/:profileId
 */
router.get('/school/pool/:profileId', authorize(PERMISSIONS.BROWSE_STUDENT_POOL), async (req, res) => {
  try {
    const { profileId } = req.params;

    const { data, error } = await supabase
      .from('global_profiles')
      .select(`
        id,
        gpa,
        class_rank,
        test_scores,
        intended_majors,
        activities,
        personal_essay,
        additional_info,
        city,
        state_province,
        country,
        languages,
        current_school,
        graduation_year,
        courses,
        honors_awards,
        volunteer_experience,
        work_experience,
        pool_opted_in_at
      `)
      .eq('id', profileId)
      .eq('pool_visible', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Profile not found or not visible'
        });
      }
      throw error;
    }

    // Return anonymized detailed profile
    res.json({
      success: true,
      data: {
        id: data.id,
        gpa: data.gpa,
        classRank: data.class_rank,
        testScores: data.test_scores,
        intendedMajors: data.intended_majors,
        activities: data.activities,
        personalEssay: data.personal_essay,
        additionalInfo: data.additional_info,
        location: {
          city: data.city,
          state: data.state_province,
          country: data.country
        },
        languages: data.languages,
        currentSchool: data.current_school,
        graduationYear: data.graduation_year,
        courses: data.courses,
        honorsAwards: data.honors_awards,
        volunteerExperience: data.volunteer_experience,
        workExperience: data.work_experience,
        optedInAt: data.pool_opted_in_at
      }
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Send a direct offer to a student
 * POST /api/direct-offers/school/send
 * Body: { profileId, conditions, scholarshipAmount?, deadline?, message? }
 */
router.post('/school/send', authorize(PERMISSIONS.SEND_DIRECT_OFFERS), async (req, res) => {
  try {
    const { profileId, conditions, scholarshipAmount, deadline, message } = req.body;

    if (!profileId || !conditions) {
      return res.status(400).json({
        success: false,
        error: 'profileId and conditions are required'
      });
    }

    // Get the user's school assignment
    const { data: schoolManager, error: managerError } = await supabase
      .from('school_managers')
      .select('school_id')
      .eq('user_id', req.user.id)
      .single();

    if (managerError || !schoolManager) {
      return res.status(403).json({
        success: false,
        error: 'You must be assigned to a school to send offers'
      });
    }

    // Get the student's user_id from their profile
    const { data: profile, error: profileError } = await supabase
      .from('global_profiles')
      .select('user_id, gpa, test_scores, intended_majors, activities, city, state_province, country')
      .eq('id', profileId)
      .eq('pool_visible', true)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        success: false,
        error: 'Student profile not found or not visible'
      });
    }

    // Create the offer
    const { data: offer, error: offerError } = await supabase
      .from('direct_offers')
      .insert({
        school_id: schoolManager.school_id,
        student_id: profile.user_id,
        offer_type: 'conditional',
        conditions,
        scholarship_amount: scholarshipAmount || null,
        deadline: deadline || null,
        message: message || null,
        status: 'pending'
      })
      .select()
      .single();

    if (offerError) throw offerError;

    // Store a snapshot of the profile at the time of the offer
    const { error: snapshotError } = await supabase
      .from('direct_offer_profile_snapshots')
      .insert({
        offer_id: offer.id,
        profile_data: {
          gpa: profile.gpa,
          testScores: profile.test_scores,
          intendedMajors: profile.intended_majors,
          activities: profile.activities,
          location: {
            city: profile.city,
            state: profile.state_province,
            country: profile.country
          }
        }
      });

    if (snapshotError) {
      console.error('Error creating profile snapshot:', snapshotError);
      // Don't fail the request, snapshot is supplementary
    }

    res.status(201).json({
      success: true,
      data: offer
    });
  } catch (error) {
    console.error('Error sending offer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get all offers sent by the school
 * GET /api/direct-offers/school/sent
 */
router.get('/school/sent', authorize(PERMISSIONS.SEND_DIRECT_OFFERS), async (req, res) => {
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
      .from('direct_offers')
      .select(`
        *,
        snapshot:direct_offer_profile_snapshots (
          profile_data
        )
      `)
      .eq('school_id', schoolManager.school_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // For accepted offers, include student contact info
    const enrichedData = await Promise.all(data.map(async (offer) => {
      if (offer.status === 'accepted') {
        const { data: student } = await supabase
          .from('users')
          .select('first_name, last_name, email')
          .eq('id', offer.student_id)
          .single();

        return {
          ...offer,
          student: student || null
        };
      }
      return offer;
    }));

    res.json({
      success: true,
      data: enrichedData
    });
  } catch (error) {
    console.error('Error fetching sent offers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Withdraw an offer
 * DELETE /api/direct-offers/school/withdraw/:offerId
 */
router.delete('/school/withdraw/:offerId', authorize(PERMISSIONS.SEND_DIRECT_OFFERS), async (req, res) => {
  try {
    const { offerId } = req.params;

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

    // Verify the offer belongs to this school and is pending
    const { data: offer, error: offerError } = await supabase
      .from('direct_offers')
      .select('id, status')
      .eq('id', offerId)
      .eq('school_id', schoolManager.school_id)
      .single();

    if (offerError || !offer) {
      return res.status(404).json({
        success: false,
        error: 'Offer not found'
      });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Only pending offers can be withdrawn'
      });
    }

    const { error } = await supabase
      .from('direct_offers')
      .update({
        status: 'withdrawn',
        updated_at: new Date().toISOString()
      })
      .eq('id', offerId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Offer withdrawn successfully'
    });
  } catch (error) {
    console.error('Error withdrawing offer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


