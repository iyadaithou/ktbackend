/**
 * Trello Admin Routes
 * Manage Trello integration, fetch lists, create webhooks, etc.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { 
  getBoardLists, 
  createWebhook, 
  deleteWebhook,
  trelloRequest 
} = require('../services/trello');

/**
 * GET /api/trello/lists
 * Fetch all lists from the configured Trello board
 */
router.get('/lists', authenticate, async (req, res) => {
  try {
    console.log('Fetching Trello board lists...');
    const lists = await getBoardLists();
    
    res.json({ 
      success: true, 
      lists,
      count: lists.length
    });
  } catch (error) {
    console.error('Failed to fetch Trello lists:', error);
    res.status(500).json({ 
      error: 'Failed to fetch Trello lists',
      details: error.message 
    });
  }
});

/**
 * GET /api/trello/board
 * Get board information
 */
router.get('/board', authenticate, async (req, res) => {
  try {
    const boardId = process.env.TRELLO_BOARD_ID;
    if (!boardId) {
      return res.status(400).json({ error: 'Trello Board ID not configured' });
    }

    const board = await trelloRequest('GET', `/boards/${boardId}`, null);
    
    res.json({ 
      success: true, 
      board: {
        id: board.id,
        name: board.name,
        url: board.url,
        desc: board.desc
      }
    });
  } catch (error) {
    console.error('Failed to fetch Trello board:', error);
    res.status(500).json({ 
      error: 'Failed to fetch Trello board',
      details: error.message 
    });
  }
});

/**
 * POST /api/trello/webhook/setup
 * Create or update webhook for the board
 */
router.post('/webhook/setup', authenticate, async (req, res) => {
  try {
    console.log('Setting up Trello webhook...');
    const webhook = await createWebhook();
    
    res.json({ 
      success: true, 
      webhook: {
        id: webhook.id,
        active: webhook.active,
        callbackURL: webhook.callbackURL
      }
    });
  } catch (error) {
    console.error('Failed to setup webhook:', error);
    res.status(500).json({ 
      error: 'Failed to setup webhook',
      details: error.message 
    });
  }
});

/**
 * GET /api/trello/webhooks
 * List all webhooks
 */
router.get('/webhooks', authenticate, async (req, res) => {
  try {
    const token = process.env.TRELLO_TOKEN;
    if (!token) {
      return res.status(400).json({ error: 'Trello Token not configured' });
    }

    const webhooks = await trelloRequest('GET', `/tokens/${token}/webhooks`, null);
    
    res.json({ 
      success: true, 
      webhooks: webhooks.map(wh => ({
        id: wh.id,
        active: wh.active,
        callbackURL: wh.callbackURL,
        description: wh.description,
        idModel: wh.idModel
      }))
    });
  } catch (error) {
    console.error('Failed to fetch webhooks:', error);
    res.status(500).json({ 
      error: 'Failed to fetch webhooks',
      details: error.message 
    });
  }
});

/**
 * DELETE /api/trello/webhook/:id
 * Delete a specific webhook
 */
router.delete('/webhook/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteWebhook(id);
    
    res.json({ 
      success: true, 
      message: 'Webhook deleted successfully' 
    });
  } catch (error) {
    console.error('Failed to delete webhook:', error);
    res.status(500).json({ 
      error: 'Failed to delete webhook',
      details: error.message 
    });
  }
});

/**
 * GET /api/trello/config
 * Check Trello configuration status
 */
router.get('/config', authenticate, async (req, res) => {
  try {
    const config = {
      apiKeyConfigured: !!process.env.TRELLO_API_KEY,
      tokenConfigured: !!process.env.TRELLO_TOKEN,
      boardIdConfigured: !!process.env.TRELLO_BOARD_ID,
      boardId: process.env.TRELLO_BOARD_ID || null
    };

    res.json({ 
      success: true, 
      config
    });
  } catch (error) {
    console.error('Failed to check config:', error);
    res.status(500).json({ 
      error: 'Failed to check config',
      details: error.message 
    });
  }
});

module.exports = router;

