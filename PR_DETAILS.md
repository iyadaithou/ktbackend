# Backend PR: Application Management System

**Branch:** `feat/app-mgmt-backend` → `main`

## Summary
Implements backend for the application management system per `application-management.md`.

## Changes

### Payments (Stripe Integration)
- POST `/api/schools/applications/:applicationId/payment/session` - Creates Stripe Checkout Session, redirects with applicationId
- GET `/api/schools/applications/:applicationId/payment/status` - Returns latest payment status
- POST `/api/schools/applications/:applicationId/payment/waive` - Manager/admin can waive fees
- Webhook mapping in `/api/webhooks/stripe` - Handles `checkout.session.completed` and `checkout.session.expired`, marks `fee_paid`
- Submit gating: Backend requires `succeeded` payment if school has `application_fee > 0`

### Recommenders (Secure Token System)
- POST `/api/schools/applications/:applicationId/recommenders` - Invite recommender, generates secure token (SHA-256 hashed), returns invite URL
- GET `/api/schools/applications/:applicationId/recommenders` - List recommenders and statuses
- Public routes (no auth):
  - GET `/api/recommenders/public/:token` - Fetch recommender session by token
  - POST `/api/recommenders/public/:token/submit` - Submit rating + letter, marks status as `submitted`

### Documents
- GET `/api/schools/applications/:applicationId/documents` - List application documents
- POST `/api/schools/applications/:applicationId/documents` - Add document
- DELETE `/api/schools/applications/documents/:documentId` - Remove document

### Draft Autosave
- PATCH `/api/schools/applications/:applicationId` - Owner can update `application_data` while status is `draft`

### Exports
- GET `/api/exports/schools/:schoolId/applications.csv` - Download CSV of applications (manager/admin)

### Additional Routes
- GET `/api/schools/:id/forms/active` - Alias for latest form config
- GET `/api/schools/me/applications` - List current user's applications across schools

## Database Migrations
- `application_payments`: id, application_id, amount_cents, currency, status, stripe_checkout_session_id, stripe_payment_intent_id, receipt_url, metadata, created_at, updated_at
- `recommenders`: id, application_id, email, name, relationship, status, token_hash, token_expires_at, submitted_at, created_at
- `recommender_artifacts`: id, recommender_id, rating, letter_url, letter_type, metadata, created_at
- `application_documents`: id, application_id, category, name, url, type, size, metadata, created_at

## RLS Policies
- `application_payments`: Students see own; admins/managers see their schools
- `recommenders`: Students manage own; admins/managers view their schools
- `recommender_artifacts`: Only admins/managers view (students only see status)
- `application_documents`: Students manage own; admins/managers view their schools

## Environment Variables (Required)
```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_APP_URL=https://www.pythagoras.com
```

See `ENV_WEBHOOKS_SETUP.md` for complete setup guide.

## Testing Checklist
- [ ] Payment flow: Create session, redirect to Stripe, webhook receives event, fee_paid marked
- [ ] Recommender: Invite generates token, public route validates token, submission creates artifact
- [ ] Documents: List/add/remove via API
- [ ] CSV export: Download from school manager view
- [ ] RLS: Students cannot see other students' data; managers only see their schools
- [ ] Submit gating: Submission rejected if fee required and not paid

## Deployment Steps
1. Merge PR to main
2. Deploy backend
3. Set env vars in production
4. Create Stripe webhook endpoint pointing to production URL
5. Test end-to-end with production credentials

