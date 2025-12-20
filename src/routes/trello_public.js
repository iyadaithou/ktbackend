/**
 * Public Trello read-only routes
 */
const express = require('express');
const router = express.Router();
const trello = require('../services/trello');

// GET /api/trello-public/lists - returns board lists (name/id) without auth
router.get('/lists', async (_req, res) => {
  try {
    const lists = await trello.getBoardLists();
    return res.json({ lists: (lists || []).map(l => ({ id: l.id, name: l.name })) });
  } catch (e) {
    console.error('trello-public lists error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to fetch Trello lists' });
  }
});

module.exports = router;


