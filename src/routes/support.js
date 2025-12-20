const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const supportController = require('../controllers/support');
const { PERMISSIONS } = require('../utils/roles');

// Public route to create a ticket (requires authentication in our app)
router.use(authenticate);

// Tickets
router.post('/tickets', supportController.createTicket);
router.get('/tickets', authorize(PERMISSIONS.READ_SUPPORT_TICKETS), supportController.listTickets);
router.get('/my/tickets', supportController.listMyTickets);
router.get('/tickets/:id', authorize(PERMISSIONS.READ_SUPPORT_TICKETS), supportController.getTicketById);
router.patch('/tickets/:id', authorize(PERMISSIONS.MANAGE_SUPPORT_TICKETS), supportController.updateTicket);

// Comments
router.post('/tickets/:id/comments', authorize(PERMISSIONS.MANAGE_SUPPORT_TICKETS), supportController.addComment);
router.get('/tickets/:id/comments', authorize(PERMISSIONS.READ_SUPPORT_TICKETS), supportController.listComments);

// Assignment
router.post('/tickets/:id/assign', authorize(PERMISSIONS.MANAGE_SUPPORT_TICKETS), supportController.assignTicket);

// Email
router.get('/tickets/:id/emails', authorize(PERMISSIONS.READ_SUPPORT_TICKETS), supportController.listTicketEmails);
router.post('/tickets/:id/email', authorize(PERMISSIONS.SEND_SUPPORT_EMAIL), supportController.sendTicketEmail);

module.exports = router;


