# Environment Variables & Webhooks Setup

## Required Environment Variables

### Backend (.env)
```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Clerk Auth
CLERK_SECRET_KEY=your-clerk-secret-key

# Stripe (for application payments)
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# Public URLs (for redirects and invite links)
PUBLIC_APP_URL=https://www.pythagoras.com

# Optional
NODE_ENV=production
PORT=3001
```

### Frontend (.env)
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_your-clerk-publishable-key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=https://api.pythagoras.com
```

## Stripe Webhook Setup

### 1. Create Webhook Endpoint
- Go to https://dashboard.stripe.com/webhooks
- Click "Add endpoint"
- Set URL: `https://api.pythagoras.com/api/webhooks/stripe`
- Select events:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`

### 2. Copy Webhook Secret
- After creating, reveal the signing secret (starts with `whsec_`)
- Add to backend `.env` as `STRIPE_WEBHOOK_SECRET`

### 3. Test Webhook
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward events to local server
stripe listen --forward-to localhost:3001/api/webhooks/stripe

# Trigger test payment
stripe trigger checkout.session.completed
```

## Application Payment Flow

1. **Student initiates payment** → frontend calls `/api/schools/applications/:id/payment/session`
2. **Backend creates Stripe Checkout Session** with metadata: `{ application_id, student_id, school_id }`
3. **Student completes payment** → Stripe redirects to `/submissions?paid=1&applicationId=...`
4. **Webhook receives event** → backend updates `application_payments` status to `succeeded` and marks `fee_paid=true` on tracking row
5. **Frontend polls** `/api/schools/applications/:id/payment/status` to confirm

## Recommender Token Flow

1. **Student invites recommender** → backend generates secure token (SHA-256 hashed) and returns invite URL
2. **Recommender opens link** → `/recommend/:token` → public route validates token and renders submission form
3. **Recommender submits** → POST `/api/recommenders/public/:token/submit` → creates artifact and marks status as `submitted`
4. **Student/school views status** → recommenders list shows "submitted" badge

## RLS Policies

Supabase RLS is enabled on:
- `application_payments`: Students see own; admins/managers see their schools
- `recommenders`: Students manage own; admins/managers view their schools
- `recommender_artifacts`: Only admins/managers see (students only see status)
- `application_documents`: Students manage own; admins/managers view their schools

Headers used for RLS:
- `x-my-user-id`: User UUID from Clerk
- `x-my-user-role`: User role (admin, student, etc.)

## Deployment Checklist

- [ ] Set all required env vars in production
- [ ] Configure Stripe webhook endpoint with production URL
- [ ] Verify `PUBLIC_APP_URL` matches production domain
- [ ] Test payment flow end-to-end
- [ ] Test recommender invite flow
- [ ] Verify RLS policies enforce correct access
- [ ] Check email/SMS notifications (when implemented)
- [ ] Monitor webhook events in Stripe dashboard

