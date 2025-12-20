/**
 * Trello API Integration Service
 * Handles communication with Trello for translation order management
 */

const axios = require('axios');

const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'https://backend-pythagoras.vercel.app';

// Trello API base URL
const TRELLO_API_BASE = 'https://api.trello.com/1';

// Log configuration status
console.log('Trello Integration Configuration:');
console.log('- API Key:', TRELLO_API_KEY ? 'Configured' : 'Missing');
console.log('- Token:', TRELLO_TOKEN ? 'Configured' : 'Missing');
console.log('- Board ID:', TRELLO_BOARD_ID || 'Missing');

/**
 * Make authenticated request to Trello API
 */
async function trelloRequest(method, endpoint, data = null) {
  try {
    if (!TRELLO_API_KEY || !TRELLO_TOKEN) {
      throw new Error('Trello API credentials not configured');
    }

    const url = `${TRELLO_API_BASE}${endpoint}`;
    const params = {
      key: TRELLO_API_KEY,
      token: TRELLO_TOKEN
    };

    const config = {
      method,
      url,
      params,
      ...(data && { data })
    };

    console.log(`Trello API ${method} request to: ${endpoint}`);
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('Trello API error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get all lists from the configured board
 * Returns array of { id, name, pos } objects
 */
async function getBoardLists() {
  try {
    if (!TRELLO_BOARD_ID) {
      throw new Error('Trello Board ID not configured');
    }

    const lists = await trelloRequest('GET', `/boards/${TRELLO_BOARD_ID}/lists`);
    console.log(`Fetched ${lists.length} lists from Trello board`);
    
    // Sort by position
    return lists
      .sort((a, b) => a.pos - b.pos)
      .map(list => ({
        id: list.id,
        name: list.name,
        position: list.pos
      }));
  } catch (error) {
    console.error('Failed to fetch board lists:', error);
    throw error;
  }
}

/**
 * Create a new card in a specific list
 */
async function createCard(listId, cardData) {
  try {
    const { name, desc, idMembers, attachments } = cardData;

    const card = await trelloRequest('POST', '/cards', {
      idList: listId,
      name,
      desc,
      ...(idMembers && { idMembers }),
      pos: 'top' // Add to top of list
    });

    console.log(`Created Trello card: ${card.id} (${card.name})`);

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        try {
          await trelloRequest('POST', `/cards/${card.id}/attachments`, {
            url: attachment.url,
            name: attachment.name
          });
          console.log(`Added attachment to card: ${attachment.name}`);
        } catch (err) {
          console.error('Failed to add attachment:', err);
        }
      }
    }

    return card;
  } catch (error) {
    console.error('Failed to create Trello card:', error);
    throw error;
  }
}

/**
 * Update card's list (move card)
 */
async function moveCard(cardId, listId) {
  try {
    const card = await trelloRequest('PUT', `/cards/${cardId}`, {
      idList: listId
    });
    console.log(`Moved card ${cardId} to list ${listId}`);
    return card;
  } catch (error) {
    console.error('Failed to move card:', error);
    throw error;
  }
}

/**
 * Get card details
 */
async function getCard(cardId) {
  try {
    return await trelloRequest('GET', `/cards/${cardId}`);
  } catch (error) {
    console.error('Failed to get card:', error);
    throw error;
  }
}

/**
 * Find list ID by name
 */
async function findListByName(listName) {
  try {
    const lists = await getBoardLists();
    const list = lists.find(l => l.name.toLowerCase() === listName.toLowerCase());
    if (!list) {
      console.warn(`List not found: ${listName}`);
      return null;
    }
    return list.id;
  } catch (error) {
    console.error('Failed to find list:', error);
    return null;
  }
}

/**
 * Create a webhook for the board to listen for card movements
 */
async function createWebhook() {
  try {
    if (!TRELLO_BOARD_ID) {
      throw new Error('Trello Board ID not configured');
    }

    const callbackURL = `${BACKEND_URL}/api/webhooks/trello`;
    
    // Check if webhook already exists
    const existingWebhooks = await trelloRequest('GET', `/tokens/${TRELLO_TOKEN}/webhooks`);
    const existing = existingWebhooks.find(wh => wh.idModel === TRELLO_BOARD_ID);
    
    if (existing) {
      console.log('Trello webhook already exists:', existing.id);
      return existing;
    }

    // Create new webhook
    const webhook = await trelloRequest('POST', '/webhooks', {
      idModel: TRELLO_BOARD_ID,
      callbackURL,
      description: 'Pythagoras Translation Orders Integration'
    });

    console.log('Created Trello webhook:', webhook.id);
    return webhook;
  } catch (error) {
    console.error('Failed to create webhook:', error);
    throw error;
  }
}

/**
 * Delete a webhook
 */
async function deleteWebhook(webhookId) {
  try {
    await trelloRequest('DELETE', `/webhooks/${webhookId}`);
    console.log('Deleted Trello webhook:', webhookId);
  } catch (error) {
    console.error('Failed to delete webhook:', error);
    throw error;
  }
}

/**
 * Create a Trello card for a translation order
 */
async function createTranslationOrderCard(order) {
  try {
    const lists = await getBoardLists();
    
    // Find "Payment Received" or first list as default
    let targetList = lists.find(l => 
      l.name.toLowerCase().includes('payment') || 
      l.name.toLowerCase().includes('paid') ||
      l.name.toLowerCase().includes('new')
    );
    
    if (!targetList) {
      targetList = lists[0]; // Fallback to first list
    }

    const cardName = `${order.order_code} - ${order.from_language} → ${order.to_language}`;
    const cardDesc = `**Translation Order**
    
📋 **Order Code:** ${order.order_code}
📧 **Email:** ${order.contact_email || 'N/A'}
📱 **Phone:** ${order.contact_phone || 'N/A'}
🌐 **Languages:** ${order.from_language} → ${order.to_language}
📄 **Pages:** ${order.page_count || 0}
📅 **Created:** ${new Date(order.created_at).toLocaleString()}

${order.notes ? `📝 **Notes:** ${order.notes}` : ''}

🔗 **Order Link:** https://www.pythagoras.com/admin/translation-orders
`;

    const attachments = [];
    if (order.document_url) {
      attachments.push({
        url: order.document_url,
        name: order.document_name || 'Document'
      });
    }

    const card = await createCard(targetList.id, {
      name: cardName,
      desc: cardDesc,
      attachments
    });

    console.log(`Created Trello card for order ${order.order_code}: ${card.id}`);
    return { cardId: card.id, listId: targetList.id, listName: targetList.name };
  } catch (error) {
    console.error('Failed to create translation order card:', error);
    throw error;
  }
}

module.exports = {
  getBoardLists,
  createCard,
  moveCard,
  getCard,
  findListByName,
  createWebhook,
  deleteWebhook,
  createTranslationOrderCard,
  trelloRequest
};

