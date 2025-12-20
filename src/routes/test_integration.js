/**
 * Complete Integration Test Endpoint
 * Tests all Trello + Email + SMS functionality
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabaseClient');
const { sendEmail, sendSms } = require('../services/notifications');
const { 
  getBoardLists, 
  createTranslationOrderCard,
  trelloRequest 
} = require('../services/trello');

/**
 * GET /api/test-integration/full
 * Complete integration test
 */
router.get('/full', async (req, res) => {
  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };

  console.log('=== STARTING FULL INTEGRATION TEST ===');

  // Test 1: Environment Variables
  results.tests.envVars = {
    TRELLO_API_KEY: !!process.env.TRELLO_API_KEY,
    TRELLO_TOKEN: !!process.env.TRELLO_TOKEN,
    TRELLO_BOARD_ID: !!process.env.TRELLO_BOARD_ID,
    BREVO_API_KEY: !!process.env.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || 'Not set',
    BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || 'Not set'
  };

  // Test 2: Database Columns
  try {
    const { data, error } = await supabase
      .from('translation_orders')
      .select('trello_card_id, trello_list_id, trello_list_name')
      .limit(1);
    
    if (error) {
      results.tests.database = { success: false, error: error.message };
    } else {
      results.tests.database = { success: true, message: 'Trello columns exist' };
    }
  } catch (e) {
    results.tests.database = { success: false, error: e.message };
  }

  // Test 3: Trello Connection
  try {
    const board = await trelloRequest('GET', `/boards/${process.env.TRELLO_BOARD_ID}`);
    results.tests.trello = {
      success: true,
      boardName: board.name,
      boardUrl: board.url
    };
  } catch (e) {
    results.tests.trello = { success: false, error: e.message };
  }

  // Test 4: Trello Lists
  try {
    const lists = await getBoardLists();
    results.tests.trelloLists = {
      success: true,
      count: lists.length,
      lists: lists.map(l => l.name)
    };
  } catch (e) {
    results.tests.trelloLists = { success: false, error: e.message };
  }

  // Test 5: Webhook Check
  try {
    const webhooks = await trelloRequest('GET', `/tokens/${process.env.TRELLO_TOKEN}/webhooks`);
    const boardWebhook = webhooks.find(wh => wh.idModel === process.env.TRELLO_BOARD_ID);
    results.tests.webhook = {
      success: true,
      exists: !!boardWebhook,
      webhookId: boardWebhook?.id,
      active: boardWebhook?.active,
      callbackURL: boardWebhook?.callbackURL
    };
  } catch (e) {
    results.tests.webhook = { success: false, error: e.message };
  }

  console.log('=== TEST RESULTS ===');
  console.log(JSON.stringify(results, null, 2));

  res.json(results);
});

/**
 * POST /api/test-integration/email
 * Test email sending
 */
router.post('/email', async (req, res) => {
  try {
    const { to } = req.body;
    const testEmail = to || 'translation@pythagoras.com';

    console.log('Testing email to:', testEmail);
    
    const result = await sendEmail({
      to: testEmail,
      subject: 'Test Email from Pythagoras',
      html: '<h1>Test Email</h1><p>This is a test email from the Trello integration.</p><p>Timestamp: ' + new Date().toISOString() + '</p>'
    });

    res.json({
      success: result.ok,
      message: result.ok ? 'Email sent successfully' : 'Email failed',
      error: result.error,
      testEmail
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/test-integration/sms
 * Test SMS sending
 */
router.post('/sms', async (req, res) => {
  try {
    const { to, message } = req.body;
    
    if (!to) {
      return res.status(400).json({ error: 'Phone number required in body: { "to": "+1234567890" }' });
    }

    console.log('Testing SMS to:', to);
    
    const result = await sendSms({
      to,
      body: message || 'Test SMS from Pythagoras. Timestamp: ' + new Date().toISOString()
    });

    res.json({
      success: result.ok,
      message: result.ok ? 'SMS sent successfully' : 'SMS failed',
      error: result.error,
      testPhone: to
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/test-integration/trello-card
 * Test Trello card creation
 */
router.post('/trello-card', async (req, res) => {
  try {
    console.log('Testing Trello card creation...');
    
    const testOrder = {
      order_code: 'TEST-' + Date.now().toString().slice(-4),
      contact_email: 'test@example.com',
      contact_phone: '+1234567890',
      from_language: 'English',
      to_language: 'Spanish',
      page_count: 3,
      amount_cents: 1800,
      currency: 'USD',
      document_name: 'test-document.pdf',
      document_url: 'https://example.com/test.pdf',
      created_at: new Date().toISOString(),
      notes: 'Test card created via integration test'
    };

    const result = await createTranslationOrderCard(testOrder);

    res.json({
      success: true,
      cardId: result.cardId,
      listName: result.listName,
      cardURL: `https://trello.com/c/${result.cardId}`,
      message: 'Check your Trello board!'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/test-integration/complete
 * Test complete flow: Create order, send email/SMS, create Trello card
 */
router.post('/complete', async (req, res) => {
  try {
    const { email, phone } = req.body;
    
    if (!email || !phone) {
      return res.status(400).json({ 
        error: 'Email and phone required',
        example: { "email": "test@example.com", "phone": "+1234567890" }
      });
    }

    const results = {
      timestamp: new Date().toISOString(),
      steps: {}
    };

    // Step 1: Create test order
    const testOrder = {
      order_code: 'TEST-' + Date.now().toString().slice(-4),
      contact_email: email,
      contact_phone: phone,
      from_language: 'English',
      to_language: 'Spanish',
      page_count: 5,
      amount_cents: 2500,
      currency: 'USD',
      document_name: 'complete-test.pdf',
      document_url: 'https://example.com/test.pdf',
      created_at: new Date().toISOString()
    };

    results.steps.order = {
      success: true,
      orderCode: testOrder.order_code
    };

    // Step 2: Send email
    try {
      const emailResult = await sendEmail({
        to: email,
        subject: 'Test Order - Payment Received',
        html: `<h2>Payment Received</h2><p>Order Code: <strong>${testOrder.order_code}</strong></p><p>This is a complete integration test.</p>`
      });
      results.steps.email = {
        success: emailResult.ok,
        error: emailResult.error
      };
    } catch (e) {
      results.steps.email = { success: false, error: e.message };
    }

    // Step 3: Send SMS
    try {
      const smsResult = await sendSms({
        to: phone,
        body: `Pythagoras: Payment received! Order Code: ${testOrder.order_code}. This is a test.`
      });
      results.steps.sms = {
        success: smsResult.ok,
        error: smsResult.error
      };
    } catch (e) {
      results.steps.sms = { success: false, error: e.message };
    }

    // Step 4: Create Trello card
    try {
      const trelloResult = await createTranslationOrderCard(testOrder);
      results.steps.trello = {
        success: true,
        cardId: trelloResult.cardId,
        cardURL: `https://trello.com/c/${trelloResult.cardId}`
      };
    } catch (e) {
      results.steps.trello = { success: false, error: e.message };
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;

