const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const Brevo = require('@getbrevo/brevo');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@pythagoras.com';
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || EMAIL_FROM;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Pythagoras';
const BREVO_SENDER_ID = process.env.BREVO_SENDER_ID; // optional numerical id

// Log configuration status
console.log('Email/SMS Configuration Status:');
console.log('- SendGrid API Key:', SENDGRID_API_KEY ? 'Configured' : 'Missing');
console.log('- Twilio SID:', TWILIO_SID ? 'Configured' : 'Missing');
console.log('- Twilio Token:', TWILIO_TOKEN ? 'Configured' : 'Missing');
console.log('- Twilio From:', TWILIO_FROM ? 'Configured' : 'Missing');
console.log('- Brevo API Key:', BREVO_API_KEY ? 'Configured' : 'Missing');
console.log('- Brevo API Key (first 10 chars):', BREVO_API_KEY ? BREVO_API_KEY.substring(0, 10) + '...' : 'Not set');
console.log('- Brevo Sender Email:', BREVO_SENDER_EMAIL);
console.log('- Brevo Sender Name:', BREVO_SENDER_NAME);
console.log('- Brevo Sender ID (numeric):', BREVO_SENDER_ID || 'Not set (will use sender name)');
if (!BREVO_SENDER_ID) {
  console.log('⚠️  WARNING: BREVO_SENDER_ID not set. Sender name must be registered in Brevo dashboard');
  console.log('⚠️  Otherwise, SMS will show as "NXSMS". Register at: https://app.brevo.com/settings/sms/senders');
}
console.log('- All env vars with BREVO:', Object.keys(process.env).filter(key => key.includes('BREVO')));

if (SENDGRID_API_KEY) {
  try { sgMail.setApiKey(SENDGRID_API_KEY); } catch (e) { console.error('SendGrid init error:', e?.message || e); }
}

let smsClient = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  try { smsClient = twilio(TWILIO_SID, TWILIO_TOKEN); } catch (e) { console.error('Twilio init error:', e?.message || e); }
}

let brevoEmailApi = null;
let brevoSmsApi = null;
if (BREVO_API_KEY) {
  try {
    console.log('Initializing Brevo API with key length:', BREVO_API_KEY.length);
    brevoEmailApi = new Brevo.TransactionalEmailsApi();
    brevoEmailApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, BREVO_API_KEY);
    brevoSmsApi = new Brevo.TransactionalSMSApi();
    brevoSmsApi.setApiKey(Brevo.TransactionalSMSApiApiKeys.apiKey, BREVO_API_KEY);
    console.log('Brevo API initialized successfully');
  } catch (e) {
    console.error('Brevo init error:', e?.message || e);
    console.error('Brevo init error stack:', e?.stack);
    brevoEmailApi = null;
    brevoSmsApi = null;
  }
} else {
  console.log('No BREVO_API_KEY found, skipping Brevo initialization');
}

async function sendEmail({ to, subject, html }) {
  console.log(`Attempting to send email to: ${to}, subject: ${subject}`);
  console.log('brevoEmailApi status:', brevoEmailApi ? 'Initialized' : 'Not initialized');
  console.log('SENDGRID_API_KEY status:', SENDGRID_API_KEY ? 'Set' : 'Not set');
  
  // Prefer Brevo if configured
  if (brevoEmailApi) {
    try {
      console.log('Using Brevo for email...');
      const sendSmtpEmail = new Brevo.SendSmtpEmail();
      sendSmtpEmail.subject = subject;
      sendSmtpEmail.htmlContent = html;
      sendSmtpEmail.sender = { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME, id: BREVO_SENDER_ID ? Number(BREVO_SENDER_ID) : undefined };
      sendSmtpEmail.to = [{ email: to }];
      await brevoEmailApi.sendTransacEmail(sendSmtpEmail);
      console.log('Brevo email sent successfully');
      return { ok: true };
    } catch (e) {
      console.error('Brevo email error, falling back:', e?.message || e);
    }
  }
  
  // Fallback to SendGrid
  if (SENDGRID_API_KEY) {
    try {
      console.log('Using SendGrid for email...');
      const msg = { to, from: EMAIL_FROM, subject, html };
      await sgMail.send(msg);
      console.log('SendGrid email sent successfully');
      return { ok: true };
    } catch (e) {
      console.error('SendGrid email error:', e);
      return { ok: false, error: e?.message || String(e) };
    }
  }
  
  console.error('No email provider configured. Please set up BREVO_API_KEY or SENDGRID_API_KEY');
  return { ok: false, error: 'No email provider configured. Please set up BREVO_API_KEY or SENDGRID_API_KEY environment variables.' };
}

async function sendSms({ to, body }) {
  console.log(`📱 SMS Service: Attempting to send SMS to: ${to}`);
  console.log(`📱 SMS Service: Message body length: ${body.length} chars`);
  console.log(`📱 SMS Service: Message preview: ${body.substring(0, 50)}...`);
  
  // Prefer Brevo SMS if configured (Brevo uses sender name/number setup in account)
  if (brevoSmsApi) {
    try {
      console.log('📱 SMS Service: Using Brevo for SMS...');
      
      // IMPORTANT: Brevo SMS sender name must be registered/approved in Brevo dashboard
      // If not registered, Brevo will use default "NXSMS" sender ID
      // For USA/Canada: Alphanumeric sender IDs require registration and approval
      // Option 1: Use numeric sender ID if available (more reliable)
      // Option 2: Register sender name in Brevo dashboard: https://app.brevo.com/settings/sms/senders
      let sender;
      if (BREVO_SENDER_ID) {
        // Use numeric sender ID (more reliable, doesn't require registration)
        sender = String(BREVO_SENDER_ID);
        console.log(`📱 SMS Service: Using numeric sender ID: "${sender}"`);
      } else {
        // Use alphanumeric sender name (requires registration in Brevo dashboard)
        sender = BREVO_SENDER_NAME.slice(0, 11);
        console.log(`📱 SMS Service: Using sender name: "${sender}" (max 11 chars)`);
        console.log(`⚠️  WARNING: If sender name "${sender}" is not registered in Brevo dashboard,`);
        console.log(`⚠️  Brevo will use default "NXSMS" sender ID.`);
        console.log(`⚠️  Register sender at: https://app.brevo.com/settings/sms/senders`);
      }
      
      const smsPayload = { 
        sender: sender, 
        recipient: to, 
        content: body 
      };
      console.log('📱 SMS Service: Brevo payload:', JSON.stringify(smsPayload, null, 2));
      
      const result = await brevoSmsApi.sendTransacSms(smsPayload);
      console.log('✅ SMS Service: Brevo SMS sent successfully');
      console.log('📱 SMS Service: Brevo response:', JSON.stringify(result, null, 2));
      
      // Check if response indicates sender was used or defaulted
      if (result?.data?.sender && result.data.sender !== sender) {
        console.warn(`⚠️  WARNING: Brevo used sender "${result.data.sender}" instead of requested "${sender}"`);
        console.warn(`⚠️  This usually means the sender name is not registered. Register at: https://app.brevo.com/settings/sms/senders`);
      }
      
      return { ok: true, provider: 'brevo' };
    } catch (e) {
      console.error('❌ SMS Service: Brevo SMS error:', e?.message || e);
      console.error('❌ SMS Service: Brevo error details:', JSON.stringify(e, null, 2));
      console.error('❌ SMS Service: Brevo error response:', e?.response?.body || 'No response body');
      console.log('⚠️  SMS Service: Attempting fallback to Twilio...');
    }
  } else {
    console.log('⚠️  SMS Service: Brevo SMS API not initialized');
  }
  
  // Fallback to Twilio
  if (smsClient && TWILIO_FROM) {
    try {
      console.log('📱 SMS Service: Using Twilio for SMS...');
      console.log('📱 SMS Service: Twilio from:', TWILIO_FROM);
      console.log('📱 SMS Service: Twilio to:', to);
      
      const twilioResult = await smsClient.messages.create({ 
        from: TWILIO_FROM, 
        to, 
        body 
      });
      
      console.log('✅ SMS Service: Twilio SMS sent successfully');
      console.log('📱 SMS Service: Twilio SID:', twilioResult.sid);
      return { ok: true, provider: 'twilio' };
    } catch (e) {
      console.error('❌ SMS Service: Twilio SMS error:', e?.message || e);
      console.error('❌ SMS Service: Twilio error code:', e?.code);
      console.error('❌ SMS Service: Twilio error details:', JSON.stringify(e, null, 2));
      return { ok: false, error: e?.message || String(e), provider: 'twilio' };
    }
  } else {
    console.log('⚠️  SMS Service: Twilio not configured');
    console.log('⚠️  SMS Service: smsClient:', smsClient ? 'initialized' : 'not initialized');
    console.log('⚠️  SMS Service: TWILIO_FROM:', TWILIO_FROM ? 'set' : 'not set');
  }
  
  console.error('❌ SMS Service: No SMS provider available or all failed');
  return { ok: false, error: 'No SMS provider configured or all providers failed. Please set up BREVO_API_KEY or TWILIO credentials.' };
}

module.exports = { sendEmail, sendSms };


