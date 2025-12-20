/**
 * Webhook routes for handling external service events
 */
const express = require('express');
const router = express.Router();
const { Webhook } = require('svix');
const supabase = require('../config/supabase');
const Stripe = require('stripe');

/**
 * Handle Clerk webhook events
 * This receives events when users are created, updated, or deleted in Clerk
 */
router.post('/clerk', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify webhook signature
    const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
    if (!CLERK_WEBHOOK_SECRET) {
      console.error('CLERK_WEBHOOK_SECRET is not defined');
      return res.status(500).send('Webhook secret not configured');
    }

    // Get the Svix headers for verification
    const svixId = req.headers['svix-id'];
    const svixTimestamp = req.headers['svix-timestamp'];
    const svixSignature = req.headers['svix-signature'];

    // If there are no Svix headers, error out
    if (!svixId || !svixTimestamp || !svixSignature) {
      console.error('Missing Svix headers');
      return res.status(400).send('Missing Svix headers');
    }

    // Log headers for debugging
    console.log('Webhook headers:', {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature.substring(0, 20) + '...' // Don't log the entire signature
    });

    // Create a Webhook instance with your secret
    const wh = new Webhook(CLERK_WEBHOOK_SECRET);
    
    // Verify the payload with the headers
    // The body is a Buffer since we're using express.raw
    let evt;
    try {
      // Convert Buffer to string
      const payloadString = req.body.toString('utf8');
      console.log('Payload string length:', payloadString.length);
      
      evt = wh.verify(payloadString, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
    } catch (err) {
      console.error('Error verifying webhook:', err);
      return res.status(400).send('Webhook verification failed');
    }

    // Get the event type and data
    const { type, data } = evt;
    console.log(`Webhook event received: ${type}`);

    // Handle user creation events
    if (type === 'user.created') {
      await handleUserCreated(data);
    }
    // Handle user updated events
    else if (type === 'user.updated') {
      await handleUserUpdated(data);
    }
    // Handle user deleted events
    else if (type === 'user.deleted') {
      await handleUserDeleted(data);
    }

    // Return a 200 response
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
});

// Stripe webhook for payment events
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!secret || !stripeKey) {
      console.error('Stripe webhook not configured');
      return res.status(500).send('Stripe webhook not configured');
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20.acacia' });
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error('Stripe signature verification failed:', err.message || err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const appId = session.metadata?.application_id;
        // Translation orders have been removed from the product; ignore order_id.
        if (appId) {
          await supabase
            .from('application_payments')
            .update({ status: 'succeeded', stripe_payment_intent_id: session.payment_intent || null, receipt_url: session?.receipt_url || null })
            .eq('stripe_checkout_session_id', session.id);
          await supabase
            .from('student_application_tracking')
            .update({ fee_paid: true, last_updated: new Date().toISOString() })
            .eq('id', appId);
        }
        break;
      }
      case 'payment_intent.succeeded': {
        // no-op: handled above when session completes
        break;
      }
      case 'checkout.session.expired': {
        const session = event.data.object;
        const appId = session.metadata?.application_id;
        // Translation orders have been removed from the product; ignore order_id.
        if (appId) {
          await supabase
            .from('application_payments')
            .update({ status: 'failed' })
            .eq('stripe_checkout_session_id', session.id);
        }
        break;
      }
      default:
        // ignore other events
        break;
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error:', e);
    res.status(500).send('Webhook processing failed');
  }
});

/**
 * Handle user.created event
 * @param {Object} data - Clerk user data
 */
async function handleUserCreated(data) {
  try {
    const { id, email_addresses, first_name, last_name } = data;
    
    // Get primary email
    const primaryEmail = email_addresses?.find(email => email.id === data.primary_email_address_id);
    if (!primaryEmail) {
      console.error('No primary email found for user:', id);
      return;
    }
    
    // Define role based on email domain or specific addresses
    let role = 'student';
    const email = primaryEmail.email_address.toLowerCase();
    
    // List of admin emails (you can move this to environment variables or database)
    const adminEmails = [
      'iyad@pythagoras.com',
      'admin@pythagoras.com',
      'iyad.aithou@gwu.edu',
      'iyadaithou3@gmail.com'
      // Add other admin emails here
    ];
    
    if (adminEmails.includes(email)) {
      role = 'admin';
      console.log(`Setting user ${email} as admin`);
    } else if (email.endsWith('@employee.pythagoras.com') || email.includes('staff.') || email.includes('employee.')) {
      role = 'employee';
    }
    
    // Check if supabase is properly initialized
    if (!supabase || !supabase.from) {
      console.error('Supabase client is not properly initialized. Check your Supabase credentials.');
      return;
    }
    
    // Check if user already exists with this clerk_id
    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', id)
      .single();
    
    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking for existing user:', selectError);
      return;
    }
    
    if (existingUser) {
      console.log(`User with clerk_id ${id} already exists`);
      return;
    }
    
    // Create user in Supabase
    console.log(`Creating user in Supabase: ${email} (${first_name} ${last_name}) with role ${role}`);
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email: email,
        first_name: first_name || '',
        last_name: last_name || '',
        clerk_id: id,
        role: role,
        subscription_level: 'free',
        subscription_expiry: null,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating user in Supabase:', error);
    } else {
      console.log('User created in Supabase:', newUser?.id || 'Unknown ID');
    }
  } catch (error) {
    console.error('Unexpected error in handleUserCreated:', error);
  }
}

/**
 * Handle user.updated event
 * @param {Object} data - Clerk user data
 */
async function handleUserUpdated(data) {
  const { id, email_addresses, first_name, last_name } = data;
  
  // Get primary email
  const primaryEmail = email_addresses?.find(email => email.id === data.primary_email_address_id);
  if (!primaryEmail) {
    console.error('No primary email found for user:', id);
    return;
  }
  
  // Update user in Supabase
  const { data: updatedUser, error } = await supabase
    .from('users')
    .update({
      email: primaryEmail.email_address.toLowerCase(),
      first_name: first_name || '',
      last_name: last_name || '',
    })
    .eq('clerk_id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating user in Supabase:', error);
  } else if (updatedUser) {
    console.log('User updated in Supabase:', updatedUser.id);
  } else {
    // If user doesn't exist, create them
    await handleUserCreated(data);
  }
}

/**
 * Handle user.deleted event
 * @param {Object} data - Clerk user data
 */
async function handleUserDeleted(data) {
  const { id } = data;
  
  // Delete user in Supabase
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('clerk_id', id);
  
  if (error) {
    console.error('Error deleting user in Supabase:', error);
  } else {
    console.log('User deleted in Supabase for clerk_id:', id);
  }
}

module.exports = router; 