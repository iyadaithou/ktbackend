# 🚀 Quick Testing Steps

## Run Automated Tests (5 minutes)

```bash
cd backend-pythagoras
node test-trello-integration.js
```

This will check:
- ✅ Trello API configuration
- ✅ Webhook status
- ✅ Backend routes
- ✅ Environment variables

---

## Manual Testing (10 minutes)

### ✅ Test 1: Create Order & Check Trello Card
1. Go to: https://www.pythagoras.com/programs/translation
2. Upload a document, fill out form, and complete payment
3. Check your Trello board - card should appear in first list
4. **Verify card name:** Should be `{CODE} - {FROM_LANG} → {TO_LANG}`
5. **Verify card contains:** Email, phone, page count, document attachment

**Expected:** ✅ Card appears within 30 seconds of payment

---

### ✅ Test 2: Move Card & Check Notifications
1. In Trello, move the card to the next list (e.g., "Sent to Verifier")
2. Wait 10-15 seconds
3. Check your email - should receive update with stage name
4. Check your phone - should receive SMS with stage name

**Expected SMS format:**
```
Pythagoras: Order {CODE} - {STAGE_NAME}. {message} Track: https://www.pythagoras.com/programs/translation
```

**Expected Email:**
- Subject: `Order {CODE} - Now at {STAGE_NAME}`
- Body shows current stage and description

---

### ✅ Test 3: Track Order (Sync Fallback)
1. Note your order code from step 1
2. Go to: https://www.pythagoras.com/programs/translation
3. Enter order code and click "Check Status"
4. **Verify:** Timeline shows current stage highlighted
5. **Verify:** Stage matches Trello card position

**Expected:** Even if webhook was missed, tracking syncs with Trello automatically

---

### ✅ Test 4: Move to Final Stages
Test specific stage messages:

**Move to "Sent Docs to Student":**
- Should receive: "The documents have been sent to your email"

**Move to "Closed":**
- Should receive: "Your order is closed"

---

### ✅ Test 5: Admin Panel
1. Go to: https://www.pythagoras.com/admin/translation-orders
2. Check the "Trello Stage" filter dropdown
3. **Verify:** Shows actual Trello list names (no hardcoded statuses)
4. Filter by a stage
5. **Verify:** Shows only orders in that stage

---

## 🔍 Check Backend Logs

Go to: https://vercel.com/your-project/deployments

Look for these log messages:

### ✅ When Card Created (Payment):
```
Created Trello card for order {CODE}: {CARD_ID}
```

### ✅ When Card Moved (Webhook):
```
=== Trello Webhook Received ===
Card moved from "{OLD_STAGE}" to "{NEW_STAGE}"
Extracted order code: {CODE}
✅ Order {CODE} status updated to {NEW_STAGE}
✅ Logged event: {OLD_STAGE} → {NEW_STAGE}
Sent email notification to: {EMAIL}
Sent SMS notification to: {PHONE}
```

### ✅ When Order Tracked (Sync):
```
[Sync] Order {CODE}: DB has list {OLD_ID}, Trello has {NEW_ID}
[Sync] Updating order {CODE}: {OLD_STAGE} → {NEW_STAGE}
✅ [Sync] Order {CODE} synced with Trello
```

---

## ⚠️ Edge Cases to Test

### Test with US Phone Number
Create order with +1 phone number and verify SMS delivery.

**If SMS fails:**
1. Check backend logs for "Brevo SMS" or "Twilio SMS"
2. If only Brevo available, may need Twilio for US numbers
3. Add Twilio env vars to Vercel (see TESTING_GUIDE.md)

### Test Rapid Moves
Move card quickly through 3-4 stages. Should receive multiple notifications.

### Test Invalid Card Name
Create a test card in Trello without proper format (e.g., "Test Card").
Move it - should be ignored (check logs for "Could not extract order code").

---

## 📊 Verify Database

### Check Events Table
Run in Supabase SQL Editor:

```sql
SELECT 
  order_code,
  from_list_name,
  to_list_name,
  created_at
FROM translation_order_events
ORDER BY created_at DESC
LIMIT 20;
```

**Expected:** See all recent card movements logged

### Check Orders Table
```sql
SELECT 
  order_code,
  status,
  trello_card_id,
  trello_list_name
FROM translation_orders
WHERE created_at > now() - interval '1 day'
ORDER BY created_at DESC;
```

**Expected:** 
- `status` = Trello list name (exact match)
- `trello_list_name` populated
- `trello_card_id` populated

---

## ✅ Success Criteria

You can consider the integration working if:

- [x] Payment creates Trello card
- [x] Moving card updates order status
- [x] SMS includes stage name
- [x] Email includes stage name  
- [x] Order tracking shows correct stage
- [x] Special stages ("Closed", "Sent Docs") show correct messages
- [x] Sync fallback works when tracking order
- [x] Admin filter shows Trello stages
- [x] Events logged in database

---

## 🐛 If Something Fails

1. **No Trello card created:**
   - Check Stripe webhook at Vercel logs
   - Verify `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_ID`

2. **Card moves but status not updated:**
   - Check webhook exists: visit `/api/trello-setup/test`
   - Verify card name starts with order code
   - Check backend logs for webhook events

3. **No SMS received:**
   - Check backend logs for SMS send attempts
   - Verify phone number has country code
   - Consider adding Twilio for US numbers

4. **Order tracking shows wrong stage:**
   - Try tracking again (should auto-sync)
   - Check backend logs for `[Sync]` messages
   - Verify `trello_card_id` in database

---

## 📞 Support

If tests fail, check:
1. TESTING_GUIDE.md (detailed troubleshooting)
2. Backend logs at Vercel
3. Trello webhook status at `/api/trello-setup/test`
4. Database tables via Supabase dashboard

