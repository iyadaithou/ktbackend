const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { authenticate } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { sendEmail, sendSms } = require('../services/notifications');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
  } catch (e) {
    console.error('Failed to initialize Stripe:', e?.message || e);
  }
} else {
  console.warn('STRIPE_SECRET_KEY not set; Stripe checkout will be disabled');
}

async function calculateAmountCents(pageCount, programId) {
  let perPageCents = 1000;
  let coverCents = 500;
  if (programId) {
    try {
      const { data } = await supabase
        .from('programs')
        .select('translation_price_per_page_cents, translation_cover_fee_cents')
        .eq('id', programId)
        .maybeSingle();
      if (data) {
        if (Number.isFinite(Number(data.translation_price_per_page_cents))) perPageCents = Number(data.translation_price_per_page_cents);
        if (Number.isFinite(Number(data.translation_cover_fee_cents))) coverCents = Number(data.translation_cover_fee_cents);
      }
    } catch (_) {}
  }
  return perPageCents * pageCount + coverCents;
}

// Create translation order and Stripe Checkout session (no auth required)
router.post('/', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const {
      document_url,
      document_name,
      document_type,
      from_language,
      to_language,
      page_count,
      currency = 'USD',
      notes,
      contact_email,
      contact_phone,
      program_id,
      // Optional coupon/promo support
      promo_code,
      allow_promotion_codes
    } = req.body || {};

    if (!document_url || !from_language || !to_language || !page_count) {
      return res.status(400).json({ error: 'document_url, from_language, to_language, and page_count are required' });
    }

    const pageCountNum = Number(page_count);
    if (!Number.isFinite(pageCountNum) || pageCountNum <= 0) {
      return res.status(400).json({ error: 'page_count must be a positive number' });
    }

    const amount_cents = await calculateAmountCents(pageCountNum, program_id || null);

    // Generate short order code
    const orderCode = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Date.now().toString().slice(-4);

    // Create DB row first
    const insert = await supabase
      .from('translation_orders')
      .insert({
        user_id: userId,
        document_url,
        document_name: document_name || null,
        document_type: document_type || null,
        from_language,
        to_language,
        page_count: pageCountNum,
        amount_cents,
        currency,
        status: 'NEW',
        notes: notes || null,
        contact_email: contact_email || null,
        contact_phone: contact_phone || null,
        order_code: orderCode,
        program_id: program_id || null
      })
      .select()
      .single();
    if (insert.error) {
      console.error('Failed to create translation order:', insert.error);
      return res.status(400).json({ error: insert.error.message });
    }
    const order = insert.data;

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured on the server' });
    }

    // Determine program page path for redirect
    let programPath = '/programs';
    if (program_id) {
      try {
        const { data: prog } = await supabase
          .from('programs')
          .select('id, slug')
          .eq('id', program_id)
          .maybeSingle();
        if (prog) programPath = `/programs/${prog.slug || prog.id}`;
      } catch (_) {}
    }

    // Ensure FRONTEND_URL is properly set (not localhost in production)
    const frontendUrl = process.env.FRONTEND_URL || 'https://www.pythagoras.com';
    console.log('Using frontend URL for redirects:', frontendUrl);
    console.log('Environment FRONTEND_URL:', process.env.FRONTEND_URL);

    // Create Stripe Checkout Session
    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: String(currency).toLowerCase(),
            product_data: {
              name: 'Document Translation',
              description: `${from_language} to ${to_language} (${pageCountNum} pages + cover)`
            },
            unit_amount: amount_cents
          },
          quantity: 1
        }
      ],
      // Let customers add promotion codes directly on the Stripe checkout page
      allow_promotion_codes: allow_promotion_codes !== false, // default true
      // Include customer information for Stripe checkout
      customer_email: (contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) ? contact_email : undefined,
      metadata: {
        order_id: order.id,
        user_id: userId || '',
        promo_code: promo_code || '',
        contact_email: contact_email || '',
        contact_phone: contact_phone || ''
      },
      success_url: `${frontendUrl}${programPath}?translate=1&translation=success&order_id=${order.id}&order_code=${encodeURIComponent(orderCode)}`,
      cancel_url: `${frontendUrl}${programPath}?translate=1&translation=cancelled&order_id=${order.id}&order_code=${encodeURIComponent(orderCode)}`
    };

    // If a promo code was provided, try to apply it server-side
    if (promo_code) {
      try {
        const promoList = await stripe.promotionCodes.list({ code: String(promo_code).trim(), active: true, limit: 1 });
        const promo = Array.isArray(promoList?.data) ? promoList.data[0] : null;
        if (promo && promo.id) {
          // Check if the coupon is restricted to specific products
          const coupon = await stripe.coupons.retrieve(promo.coupon);
          console.log('Coupon details:', {
            id: coupon.id,
            applies_to: coupon.applies_to,
            product: coupon.product,
            restriction: coupon.restriction
          });
          
          // Only apply if not restricted to specific products
          if (!coupon.product && !coupon.applies_to?.products?.length) {
            sessionParams.discounts = [{ promotion_code: promo.id }];
            console.log('Applied promo code:', promo_code, 'to checkout session');
          } else {
            console.warn('Promo code is restricted to specific products, cannot apply to dynamic line items:', promo_code);
            // Still allow the checkout to proceed, user can apply manually on Stripe page
          }
        } else {
          console.warn('Promo code not found or inactive:', promo_code);
        }
      } catch (e) {
        console.warn('Promo code lookup failed:', e?.message || e);
      }
    }

    console.log('Creating Stripe session with params:', {
      success_url: sessionParams.success_url,
      cancel_url: sessionParams.cancel_url,
      order_id: order.id,
      order_code: orderCode,
      customer_email: sessionParams.customer_email
    });
    
    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (stripeError) {
      console.error('Stripe session creation failed:', stripeError);
      return res.status(500).json({ 
        error: 'Failed to create payment session', 
        details: stripeError.message 
      });
    }

    // Update order with session IDs
    await supabase
      .from('translation_orders')
      .update({ stripe_session_id: session.id, stripe_payment_intent_id: session.payment_intent || null })
      .eq('id', order.id);

    // Notify user and admin on new order (non-blocking)
    (async () => {
      const subject = 'Translation order confirmed';
      const html = `<p>Order Code: <strong>${orderCode}</strong></p><p>We received your translation request (${from_language} → ${to_language}) for ${pageCountNum} page(s).</p><p>Total: $${(amount_cents/100).toFixed(2)} ${currency}. Complete payment to proceed.</p><p>You can track your translation at: <a href="https://www.pythagoras.com/programs/translation">https://www.pythagoras.com/programs/translation</a></p>`;
      console.log('Sending initial order notifications for order:', order.id, 'Email:', contact_email, 'Phone:', contact_phone);
      if (contact_email) {
        const emailResult = await sendEmail({ to: contact_email, subject, html });
        console.log('Initial order email result:', emailResult);
      }
      // Admin notifications disabled
      // const adminEmail = process.env.NOTIFY_ADMIN_EMAIL;
      // if (adminEmail) {
      //   const adminEmailResult = await sendEmail({ to: adminEmail, subject: `New translation order (${order.id})`, html: `<pre>${JSON.stringify(order, null, 2)}</pre>` });
      //   console.log('Admin notification email result:', adminEmailResult);
      // }
      if (contact_phone) {
        const smsResult = await sendSms({ to: contact_phone, body: `Pythagoras: Order confirmed! Order Code: ${orderCode}. Amount: $${(amount_cents/100).toFixed(2)}. Track at: https://www.pythagoras.com/programs/translation` });
        console.log('Initial order SMS result:', smsResult);
      }
    })().catch((e) => {
      console.error('Failed to send initial order notifications:', e);
    });

    return res.json({ order_id: order.id, order_code: order.order_code, checkout_url: session.url });
  } catch (e) {
    console.error('create translation order error:', e);
    return res.status(500).json({ error: 'Failed to create translation order' });
  }
});

// List current user's orders
router.get('/mine', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { data, error } = await supabase
      .from('translation_orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ orders: data || [] });
  } catch (e) {
    console.error('list my orders error:', e);
    return res.status(500).json({ error: 'Failed to list orders' });
  }
});

// Admin: list all orders
router.get('/', authenticate, async (req, res) => {
  try {
    // Basic admin gate: role must be admin or employee
    const role = req.user?.role;
    if (!(role === 'admin' || role === 'employee')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { status } = req.query;
    let q = supabase.from('translation_orders').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ orders: data || [] });
  } catch (e) {
    console.error('admin list orders error:', e);
    return res.status(500).json({ error: 'Failed to list orders' });
  }
});

// Public: get order status by id or code
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    let q = supabase
      .from('translation_orders')
      .select('id,order_code,status,trello_list_name,trello_list_id,trello_card_id,from_language,to_language,document_name,created_at,updated_at');
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(id);
    if (isUuid) q = q.eq('id', id).maybeSingle();
    else q = q.eq('order_code', id).maybeSingle();
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Order not found' });
    
    // Fallback: Sync with Trello if card exists but we might be out of sync
    if (data.trello_card_id) {
      try {
        const { getCard, getBoardLists } = require('../services/trello');
        const card = await getCard(data.trello_card_id);
        
        // Check if Trello list is different from what we have in DB
        if (card.idList && card.idList !== data.trello_list_id) {
          console.log(`[Sync] Order ${data.order_code}: DB has list ${data.trello_list_id}, Trello has ${card.idList}`);
          
          // Fetch the list name from Trello
          const lists = await getBoardLists();
          const currentList = lists.find(l => l.id === card.idList);
          
          if (currentList) {
            // Use Trello list name directly as status - no mapping
            const newStatus = currentList.name;
            console.log(`[Sync] Updating order ${data.order_code}: ${data.trello_list_name} → ${currentList.name}`);
            
            // Update DB to match Trello
            await supabase
              .from('translation_orders')
              .update({
                status: newStatus,
                trello_list_id: card.idList,
                trello_list_name: currentList.name,
                updated_at: new Date().toISOString()
              })
              .eq('id', data.id);
            
            // Update the response data
            data.status = newStatus;
            data.trello_list_id = card.idList;
            data.trello_list_name = currentList.name;
            
            console.log(`✅ [Sync] Order ${data.order_code} synced with Trello`);
          }
        }
      } catch (trelloError) {
        console.error('[Sync] Failed to sync with Trello:', trelloError.message);
        // Don't fail the request if Trello sync fails, just log it
      }
    }
    
    return res.json({ order: data });
  } catch (e) {
    console.error('get status error:', e);
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

// Admin: update order status/notes
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const role = req.user?.role;
    if (!(role === 'admin' || role === 'employee')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { id } = req.params;
    const { status, notes } = req.body || {};
    const allowed = ['NEW','PAID','PROCESSING','TRANSFORMED','VERIFIED','SENT','CANCELLED'];
    const updatePayload = {};
    if (status) {
      if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updatePayload.status = status;
    }
    if (notes !== undefined) updatePayload.notes = notes;
    if (Object.keys(updatePayload).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const { data, error } = await supabase
      .from('translation_orders')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    // Notify user about status change (non-blocking)
    (async () => {
      try {
        const subject = `Translation order status updated: ${data.status}`;
        const html = `<p>Your translation order status is now <strong>${data.status}</strong>.</p>`;
        if (data.contact_email) await sendEmail({ to: data.contact_email, subject, html });
        const adminEmail = process.env.NOTIFY_ADMIN_EMAIL;
        if (adminEmail) await sendEmail({ to: adminEmail, subject: `Order ${id} -> ${data.status}`, html: `<pre>${JSON.stringify(data, null, 2)}</pre>` });
        if (data.contact_phone) await sendSms({ to: data.contact_phone, body: `Pythagoras: Order ${id} is now ${data.status}.` });
      } catch (_) {}
    })().catch(() => {});
    return res.json({ order: data });
  } catch (e) {
    console.error('update order error:', e);
    return res.status(500).json({ error: 'Failed to update order' });
  }
});

// Analyze uploaded document for page count (public endpoint)
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/analyze', uploadMem.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const mime = req.file.mimetype || '';
    let pageCount = 1;
    if (/pdf$/i.test(mime) || mime === 'application/pdf') {
      try {
        const parsed = await pdfParse(req.file.buffer);
        if (parsed && Number.isFinite(parsed.numpages)) pageCount = Math.max(1, parsed.numpages);
      } catch (e) {
        console.warn('pdf-parse failed:', e?.message || e);
      }
    }
    // Basic heuristic for non-PDF could be added later
    return res.json({ page_count: pageCount });
  } catch (e) {
    console.error('analyze error:', e);
    return res.status(500).json({ error: 'Failed to analyze document' });
  }
});

// Debug endpoint to check email configuration (public for debugging)
router.get('/debug/email-config', async (req, res) => {
  try {
    const config = {
      BREVO_API_KEY: process.env.BREVO_API_KEY ? 'Set (length: ' + process.env.BREVO_API_KEY.length + ')' : 'Not set',
      BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || 'Not set',
      BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || 'Not set',
      EMAIL_FROM: process.env.EMAIL_FROM || 'Not set',
      SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? 'Set (length: ' + process.env.SENDGRID_API_KEY.length + ')' : 'Not set',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'Set (length: ' + process.env.STRIPE_SECRET_KEY.length + ')' : 'Not set',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ? 'Set (length: ' + process.env.STRIPE_WEBHOOK_SECRET.length + ')' : 'Not set',
      allEnvVars: Object.keys(process.env).filter(key => key.includes('BREVO') || key.includes('EMAIL') || key.includes('SENDGRID') || key.includes('STRIPE')),
      timestamp: new Date().toISOString()
    };

    console.log('Email config debug:', config);
    return res.json(config);
  } catch (e) {
    console.error('Debug email config error:', e);
    return res.status(500).json({ error: 'Failed to get config' });
  }
});

// Simple test route to check if the router is working
router.get('/test', (req, res) => {
  res.json({ message: 'Translation orders router is working', timestamp: new Date().toISOString() });
});

// Test SMS endpoint (public for debugging)
router.get('/debug/test-sms', async (req, res) => {
  try {
    console.log('=== TESTING SMS ===');
    const { sendSms } = require('../services/notifications');
    
    const testSms = {
      to: '+212762713063', // Test phone number
      body: 'Test SMS from Pythagoras Backend - ' + new Date().toISOString()
    };
    
    console.log('Testing SMS send to:', testSms.to);
    const result = await sendSms(testSms);
    console.log('SMS test result:', result);
    
    return res.json({
      success: true,
      result: result,
      testSms: testSms,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Test SMS error:', e);
    return res.status(500).json({ 
      error: 'Failed to send test SMS',
      details: e.message,
      stack: e.stack
    });
  }
});

// Test email endpoint (public for debugging) - GET version for easier testing - redeploy test
router.get('/debug/test-email', async (req, res) => {
  try {
    console.log('=== DIRECT ENV CHECK ===');
    console.log('BREVO_API_KEY in route:', process.env.BREVO_API_KEY ? 'Set (length: ' + process.env.BREVO_API_KEY.length + ')' : 'Not set');
    console.log('BREVO_SENDER_EMAIL in route:', process.env.BREVO_SENDER_EMAIL || 'Not set');
    console.log('BREVO_SENDER_NAME in route:', process.env.BREVO_SENDER_NAME || 'Not set');
    
    console.log('Loading notifications service...');
    // Clear the module cache to force fresh load
    delete require.cache[require.resolve('../services/notifications')];
    const { sendEmail } = require('../services/notifications');
    console.log('Notifications service loaded, sendEmail function:', typeof sendEmail);
    
    // Test direct Brevo API usage
    console.log('=== TESTING DIRECT BREVO API ===');
    try {
      const Brevo = require('@getbrevo/brevo');
      console.log('Brevo package loaded successfully');
      
      // Test API key authentication first
      console.log('Testing API key authentication...');
      const brevoEmailApi = new Brevo.TransactionalEmailsApi();
      brevoEmailApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
      console.log('Brevo API initialized successfully');
      
      // Try to get account info to test authentication
      try {
        const accountApi = new Brevo.AccountApi();
        accountApi.setApiKey(Brevo.AccountApiApiKeys.apiKey, process.env.BREVO_API_KEY);
        console.log('Account API initialized, testing authentication...');
        // Note: We won't call the API yet, just test initialization
      } catch (authError) {
        console.error('Authentication test failed:', authError);
      }
      
      const sendSmtpEmail = new Brevo.SendSmtpEmail();
      sendSmtpEmail.subject = 'Direct Brevo Test';
      sendSmtpEmail.htmlContent = '<p>This is a direct Brevo test.</p>';
      sendSmtpEmail.sender = { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME };
      sendSmtpEmail.to = [{ email: 'translation@pythagoras.com' }];
      
      console.log('Attempting direct Brevo send...');
      console.log('Sender email:', process.env.BREVO_SENDER_EMAIL);
      console.log('Sender name:', process.env.BREVO_SENDER_NAME);
      console.log('API Key length:', process.env.BREVO_API_KEY?.length);
      
      const directResult = await brevoEmailApi.sendTransacEmail(sendSmtpEmail);
      console.log('Direct Brevo result:', directResult);
      
      return res.json({
        success: true,
        directBrevoResult: directResult,
        timestamp: new Date().toISOString()
      });
    } catch (directError) {
      console.error('Direct Brevo error:', directError);
      console.error('Direct Brevo error details:', {
        message: directError.message,
        status: directError.status,
        response: directError.response?.data,
        stack: directError.stack
      });
      
      // Try using the notifications service instead
      console.log('=== TRYING NOTIFICATIONS SERVICE ===');
      try {
        const testEmail = {
          to: 'translation@pythagoras.com',
          subject: 'Test Email via Notifications Service',
          html: '<p>This is a test email via the notifications service.</p><p>Timestamp: ' + new Date().toISOString() + '</p>'
        };
        
        console.log('Testing notifications service...');
        const notificationResult = await sendEmail(testEmail);
        console.log('Notifications service result:', notificationResult);
        
        return res.json({
          success: true,
          method: 'notifications_service',
          result: notificationResult,
          timestamp: new Date().toISOString()
        });
      } catch (notificationError) {
        console.error('Notifications service error:', notificationError);
        
        // Try to get more specific error information
        let errorMessage = directError.message;
        if (directError.response?.data) {
          errorMessage += ` | Response: ${JSON.stringify(directError.response.data)}`;
        }
        if (directError.response?.status) {
          errorMessage += ` | Status: ${directError.response.status}`;
        }
        if (directError.response?.statusText) {
          errorMessage += ` | StatusText: ${directError.response.statusText}`;
        }
        
        return res.json({
          success: false,
          directBrevoError: errorMessage,
          notificationServiceError: notificationError.message,
          directBrevoErrorDetails: {
            status: directError.status,
            response: directError.response?.data,
            stack: directError.stack
          },
          troubleshooting: {
            message: "Both direct Brevo API and notifications service failed",
            steps: [
              "1. Check if IP blocking was properly deactivated",
              "2. Verify API key has email sending permissions",
              "3. Check if sender email is verified (already done)",
              "4. Try creating a new API key"
            ]
          },
          timestamp: new Date().toISOString()
        });
      }
    }    } catch (e) {
    console.error('Test email error:', e);
    return res.status(500).json({ 
      error: 'Failed to send test email',
      details: e.message,
      stack: e.stack
    });
  }
});

// Delete translation order (admin only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    console.log('Admin deleting translation order:', id, 'by user:', userId);

    // Delete the order
    const { error } = await supabase
      .from('translation_orders')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete translation order:', error);
      return res.status(400).json({ error: error.message });
    }

    console.log('Translation order deleted successfully:', id);
    return res.json({ success: true, message: 'Order deleted successfully' });
  } catch (e) {
    console.error('Delete translation order error:', e);
    return res.status(500).json({ error: 'Failed to delete order' });
  }
});

module.exports = router;
