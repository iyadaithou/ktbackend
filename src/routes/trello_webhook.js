/**
 * Trello Webhook Handler
 * Receives updates from Trello when cards are moved between lists
 */

const express = require('express');
const router = express.Router();
// Use the central Supabase client
const supabase = require('../config/supabase');
const { sendEmail, sendSms } = require('../services/notifications');

/**
 * HEAD request for Trello webhook verification
 */
router.head('/', (req, res) => {
  console.log('Trello webhook verification request');
  res.status(200).send();
});

/**
 * POST request for Trello webhook events
 */
router.post('/', async (req, res) => {
  try {
    const { action } = req.body;
    
    console.log('=== Trello Webhook Received ===');
    console.log('Action type:', action?.type);
    
    // We only care about card updates (moving between lists)
    if (action?.type !== 'updateCard') {
      console.log('Ignoring non-updateCard action');
      return res.status(200).send('OK');
    }

    // Check if the card was moved to a different list
    const listBefore = action.data?.listBefore;
    const listAfter = action.data?.listAfter;
    const card = action.data?.card;

    if (!listBefore || !listAfter || !card) {
      console.log('Missing list or card data, ignoring');
      return res.status(200).send('OK');
    }

    if (listBefore.id === listAfter.id) {
      console.log('Card not moved to different list, ignoring');
      return res.status(200).send('OK');
    }

    console.log(`Card moved from "${listBefore.name}" to "${listAfter.name}"`);
    console.log('Card name:', card.name);
    console.log('Card ID:', card.id);

    // Extract order code from card name (format: "ORDER-CODE - Lang → Lang")
    const orderCodeMatch = card.name.match(/^([A-Z0-9]{4}-[A-Z0-9]{4})/);
    if (!orderCodeMatch) {
      console.log('Could not extract order code from card name, ignoring');
      return res.status(200).send('OK');
    }

    const orderCode = orderCodeMatch[1];
    console.log('Extracted order code:', orderCode);

    // Find the order in database
    const { data: order, error: fetchError } = await supabase
      .from('translation_orders')
      .select('*')
      .eq('order_code', orderCode)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching order:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch order' });
    }

    if (!order) {
      console.log('Order not found for code:', orderCode);
      return res.status(404).json({ error: 'Order not found' });
    }

    console.log('Found order:', order.id);

    // Use Trello list name directly as the status - no mapping needed
    const newStatus = listAfter.name;
    const oldStatus = order.status;

    console.log(`Status change: ${oldStatus} → ${newStatus}`);

    if (oldStatus === newStatus) {
      console.log('Status unchanged, no update needed');
      return res.status(200).send('OK');
    }

    // Update order status in database
    const { error: updateError } = await supabase
      .from('translation_orders')
      .update({
        status: newStatus,
        trello_card_id: card.id,
        trello_list_id: listAfter.id,
        trello_list_name: listAfter.name,
        updated_at: new Date().toISOString()
      })
      .eq('id', order.id);

    if (updateError) {
      console.error('Error updating order:', updateError);
      return res.status(500).json({ error: 'Failed to update order' });
    }

    console.log(`✅ Order ${orderCode} status updated to ${newStatus}`);

    // Insert stage-change event for analytics
    try {
      const { error: insertEventError } = await supabase
        .from('translation_order_events')
        .insert({
          order_id: order.id,
          order_code: order.order_code,
          trello_card_id: card.id,
          from_list_id: listBefore.id,
          from_list_name: listBefore.name,
          to_list_id: listAfter.id,
          to_list_name: listAfter.name,
          occurred_at: new Date().toISOString()
        });
      if (insertEventError) {
        console.error('Failed to insert translation_order_event:', insertEventError);
      }
    } catch (evtErr) {
      console.error('Unexpected error inserting translation_order_event:', evtErr);
    }

    // Send notification to customer about status change
    console.log('=== NOTIFICATION PROCESS START ===');
    console.log('Order ID:', order.id, 'Order Code:', orderCode);
    console.log('Contact Email:', order.contact_email || 'NONE');
    console.log('Contact Phone:', order.contact_phone || 'NONE');
    
    // Generate appropriate message based on stage name
    let message = '';
    const listNameLower = listAfter.name.toLowerCase();
    
    if (listNameLower.includes('closed') || listNameLower === 'closed') {
      message = 'Your order is closed.';
    } else if (listNameLower.includes('sent') && listNameLower.includes('student')) {
      message = 'The documents have been sent to your email.';
    } else if (listNameLower.includes('verif') || listNameLower.includes('quality') || listNameLower.includes('check')) {
      message = 'Your translation is being verified for quality assurance.';
    } else if (listNameLower.includes('translat') || listNameLower.includes('progress') || listNameLower.includes('working')) {
      message = 'Your translation is now in progress. Our translators are working on your document.';
    } else if (listNameLower.includes('deliver') || listNameLower.includes('sent')) {
      message = 'Your translation is complete and has been sent to your email!';
    } else if (listNameLower.includes('cancel')) {
      message = 'Your translation order has been cancelled. Please contact us if you have questions.';
    } else {
      // Generic message for other stages
      message = `Your translation is now at stage: ${listAfter.name}`;
    }
    
    console.log('Generated message:', message);
    
    // Send email notification (with individual try-catch)
    if (order.contact_email) {
      try {
        console.log('📧 [EMAIL] Starting email send...');
        const trackingUrl = `https://www.pythagoras.com/programs/translation`;
        const emailHtml = `
          <h2>Translation Order Update</h2>
          <p>Your translation order <strong>${orderCode}</strong> has been updated.</p>
          <p><strong>Current Stage:</strong> ${listAfter.name}</p>
          <p>${message}</p>
          <p>Track your order: <a href="${trackingUrl}">${trackingUrl}</a></p>
          <hr>
          <p style="color: #666; font-size: 12px;">Pythagoras Translation Services</p>
        `;

        const emailResult = await sendEmail({
          to: order.contact_email,
          subject: `Order ${orderCode} - Now at ${listAfter.name}`,
          html: emailHtml
        });

        console.log('📧 [EMAIL] Result:', emailResult);
        console.log('✅ [EMAIL] Successfully sent to:', order.contact_email);
      } catch (emailError) {
        console.error('❌ [EMAIL] Failed:', emailError.message);
        console.error('❌ [EMAIL] Stack:', emailError.stack);
      }
    } else {
      console.log('⚠️  [EMAIL] No contact email - skipping');
    }

    // Send SMS notification (with individual try-catch)
    if (order.contact_phone) {
      try {
        console.log('📱 [SMS] Starting SMS send...');
        console.log('📱 [SMS] Phone number:', order.contact_phone);
        const trackingUrl = `https://www.pythagoras.com/programs/translation`;
        const smsText = `Pythagoras: Order ${orderCode} - ${listAfter.name}. ${message} Track: ${trackingUrl}`;
        
        console.log('📱 [SMS] Message text:', smsText);
        console.log('📱 [SMS] Message length:', smsText.length, 'chars');
        
        const smsResult = await sendSms({
          to: order.contact_phone,
          body: smsText
        });

        console.log('📱 [SMS] Result:', smsResult);
        console.log('✅ [SMS] Successfully sent to:', order.contact_phone);
      } catch (smsError) {
        console.error('❌ [SMS] Failed:', smsError.message);
        console.error('❌ [SMS] Stack:', smsError.stack);
        console.error('❌ [SMS] Full error:', JSON.stringify(smsError, null, 2));
      }
    } else {
      console.log('⚠️  [SMS] No contact phone - skipping');
    }
    
    console.log('=== NOTIFICATION PROCESS END ===');

    res.status(200).json({ 
      success: true, 
      orderCode, 
      oldStatus, 
      newStatus,
      listName: listAfter.name
    });
  } catch (error) {
    console.error('Trello webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

