/**
 * Trello Setup and Testing Routes
 * Public endpoints to help setup and debug Trello integration
 */

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { 
  getBoardLists, 
  createWebhook,
  createTranslationOrderCard,
  trelloRequest 
} = require('../services/trello');

/**
 * GET /api/trello-setup/test
 * Test Trello connection and configuration
 */
router.get('/test', async (req, res) => {
  try {
    const results = {
      timestamp: new Date().toISOString(),
      envVars: {
        TRELLO_API_KEY: process.env.TRELLO_API_KEY ? 'Set ✓' : 'Missing ✗',
        TRELLO_TOKEN: process.env.TRELLO_TOKEN ? 'Set ✓' : 'Missing ✗',
        TRELLO_BOARD_ID: process.env.TRELLO_BOARD_ID || 'Missing ✗',
        BREVO_API_KEY: process.env.BREVO_API_KEY ? 'Set ✓' : 'Missing ✗',
      },
      tests: {}
    };

    // Test 1: Fetch board info
    try {
      const boardId = process.env.TRELLO_BOARD_ID;
      if (boardId) {
        const board = await trelloRequest('GET', `/boards/${boardId}`);
        results.tests.board = {
          success: true,
          name: board.name,
          url: board.url,
          id: board.id
        };
      } else {
        results.tests.board = { success: false, error: 'Board ID not configured' };
      }
    } catch (e) {
      results.tests.board = { success: false, error: e.message };
    }

    // Test 2: Fetch lists
    try {
      const lists = await getBoardLists();
      results.tests.lists = {
        success: true,
        count: lists.length,
        lists: lists.map(l => l.name)
      };
    } catch (e) {
      results.tests.lists = { success: false, error: e.message };
    }

    // Test 3: Check database columns
    try {
      const { data, error } = await supabase
        .from('translation_orders')
        .select('id, trello_card_id, trello_list_id, trello_list_name')
        .limit(1);
      
      if (error && error.message.includes('column')) {
        results.tests.database = {
          success: false,
          error: 'Database columns missing',
          action: 'Run the migration SQL in Supabase SQL editor'
        };
      } else {
        results.tests.database = { success: true, message: 'Columns exist' };
      }
    } catch (e) {
      results.tests.database = { success: false, error: e.message };
    }

    // Test 4: Check webhooks
    try {
      const token = process.env.TRELLO_TOKEN;
      if (token) {
        const webhooks = await trelloRequest('GET', `/tokens/${token}/webhooks`);
        const boardId = process.env.TRELLO_BOARD_ID;
        const existing = webhooks.find(wh => wh.idModel === boardId);
        
        results.tests.webhook = {
          success: true,
          exists: !!existing,
          webhookId: existing?.id,
          callbackURL: existing?.callbackURL,
          active: existing?.active
        };
      } else {
        results.tests.webhook = { success: false, error: 'Token not configured' };
      }
    } catch (e) {
      results.tests.webhook = { success: false, error: e.message };
    }

    res.json(results);
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ 
      error: 'Test failed',
      details: error.message 
    });
  }
});

/**
 * POST /api/trello-setup/init
 * Initialize Trello integration (create webhook, add database columns)
 */
router.post('/init', async (req, res) => {
  try {
    const results = {
      timestamp: new Date().toISOString(),
      steps: {}
    };

    // Step 1: Add database columns (if needed)
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `
          ALTER TABLE translation_orders 
          ADD COLUMN IF NOT EXISTS trello_card_id TEXT,
          ADD COLUMN IF NOT EXISTS trello_list_id TEXT,
          ADD COLUMN IF NOT EXISTS trello_list_name TEXT;
          
          CREATE INDEX IF NOT EXISTS idx_translation_orders_trello_card 
          ON translation_orders(trello_card_id) 
          WHERE trello_card_id IS NOT NULL;
        `
      });

      if (error) {
        results.steps.database = { 
          success: false, 
          error: error.message,
          note: 'You may need to run the migration SQL manually in Supabase SQL editor'
        };
      } else {
        results.steps.database = { success: true };
      }
    } catch (e) {
      results.steps.database = { 
        success: false, 
        error: e.message,
        note: 'Run trello_integration_migration.sql in Supabase SQL editor'
      };
    }

    // Step 2: Create webhook
    try {
      const webhook = await createWebhook();
      results.steps.webhook = {
        success: true,
        webhookId: webhook.id,
        callbackURL: webhook.callbackURL
      };
    } catch (e) {
      results.steps.webhook = { success: false, error: e.message };
    }

    res.json(results);
  } catch (error) {
    console.error('Init error:', error);
    res.status(500).json({ 
      error: 'Initialization failed',
      details: error.message 
    });
  }
});

/**
 * POST /api/trello-setup/test-card
 * Create a test Trello card
 */
router.post('/test-card', async (req, res) => {
  try {
    const lists = await getBoardLists();
    if (lists.length === 0) {
      return res.status(400).json({ error: 'No lists found in Trello board' });
    }

    const testOrder = {
      order_code: 'TEST-' + Date.now().toString().slice(-4),
      contact_email: 'test@example.com',
      contact_phone: '+1234567890',
      from_language: 'English',
      to_language: 'Spanish',
      page_count: 5,
      amount_cents: 2500,
      currency: 'USD',
      document_name: 'test-document.pdf',
      document_url: 'https://example.com/test.pdf',
      created_at: new Date().toISOString(),
      notes: 'This is a test card created via setup endpoint'
    };

    const result = await createTranslationOrderCard(testOrder);

    res.json({
      success: true,
      cardId: result.cardId,
      listName: result.listName,
      cardURL: `https://trello.com/c/${result.cardId}`,
      testOrder
    });
  } catch (error) {
    console.error('Test card error:', error);
    res.status(500).json({ 
      error: 'Failed to create test card',
      details: error.message 
    });
  }
});

module.exports = router;

