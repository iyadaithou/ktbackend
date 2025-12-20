const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');

// Smart search endpoint using OpenAI
router.post('/schools/smart-search', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Get OpenAI API key
    const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_Pythagoras;
    if (!openaiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Get all schools data for context
    const { data: schools, error: schoolsError } = await supabase
      .from('schools')
      .select(`
        id,
        name,
        short_name,
        location_city,
        location_country,
        cover_image_url,
        logo_url,
        currency,
        acceptance_rate,
        student_count,
        website,
        average_tuition,
        average_financial_aid,
        scholarships_info,
        financial_aid_policy,
        majors,
        accepts_pythagoras_applications,
        sat_required,
        description,
        is_active
      `)
      .or('is_active.is.true,is_active.is.null');

    if (schoolsError) {
      console.error('Error fetching schools:', schoolsError);
      return res.status(500).json({ error: 'Failed to fetch schools data' });
    }

    // Create context for OpenAI
    const schoolsContext = schools.map(school => ({
      id: school.id,
      name: school.name,
      location: `${school.location_city || ''}, ${school.location_country || ''}`.trim(),
      majors: school.majors || [],
      accepts_pythagoras: school.accepts_pythagoras_applications,
      sat_required: school.sat_required,
      scholarships_info: school.scholarships_info,
      average_tuition: school.average_tuition,
      acceptance_rate: school.acceptance_rate,
      description: school.description
    }));

    // Call OpenAI to process the query
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: openaiKey });

    const systemPrompt = `You are a helpful assistant that helps students find universities and colleges. 
    
    Given a user query and a list of schools, you need to:
    1. Understand what the user is looking for
    2. Filter and rank schools based on their query
    3. Return the most relevant school IDs

    Available schools data:
    ${JSON.stringify(schoolsContext, null, 2)}

    Rules:
    - Return ONLY a JSON array of school IDs that match the query
    - Be smart about matching requirements (e.g., "no SAT" means sat_required is false)
    - Consider scholarships, location, majors, and other criteria
    - Return up to 20 most relevant schools
    - If no schools match, return an empty array

    Example responses:
    - Query: "Schools with no SAT requirement" → [1, 5, 12]
    - Query: "Engineering schools in California" → [3, 7, 15]
    - Query: "Schools with scholarships over $10k" → [2, 8, 11]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const response = completion.choices[0].message.content;
    
    // Parse the response to get school IDs
    let schoolIds = [];
    try {
      schoolIds = JSON.parse(response);
      if (!Array.isArray(schoolIds)) {
        schoolIds = [];
      }
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      console.log('Raw response:', response);
      schoolIds = [];
    }

    // Filter schools based on the IDs returned by OpenAI
    const filteredSchools = schools.filter(school => schoolIds.includes(school.id));

    res.json({
      schools: filteredSchools,
      query: query,
      total_found: filteredSchools.length,
      ai_reasoning: response
    });

  } catch (error) {
    console.error('Smart search error:', error);
    res.status(500).json({ 
      error: 'Smart search failed',
      details: error.message 
    });
  }
});

module.exports = router;
