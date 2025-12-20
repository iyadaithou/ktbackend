# Trello Integration Testing Guide

## 🧪 Test Scenarios

### 1. Basic Webhook Flow (Happy Path)
**Steps:**
1. Create a new paid translation order
2. Check that Trello card is created in the first list
3. Move card to next list in Trello
4. Verify:
   - Order status updated in database
   - Email received with stage name
   - SMS received with stage name
   - `translation_order_events` table has new entry

**Expected Result:**
- Status = exact Trello list name
- SMS includes: "Order {CODE} - {LIST_NAME}. {message}"
- Event logged with from/to list info

---

### 2. Webhook Failure Recovery (Sync Fallback)
**Steps:**
1. Create an order with Trello card
2. Manually move card in Trello (or temporarily disable webhook)
3. Wait 10 seconds (webhook might fail or be delayed)
4. User tracks order by code at: https://www.pythagoras.com/programs/translation
5. Check backend logs for "[Sync]" messages

**Expected Result:**
- Order automatically syncs with current Trello position
- User sees correct stage in timeline
- Database updated to match Trello

---

### 3. Multiple Rapid Moves
**Steps:**
1. Create order with Trello card
2. Quickly move card through 3-4 lists in succession
3. Check that all moves are logged
4. Verify final status is correct

**Expected Result:**
- All stage changes logged in `translation_order_events`
- Final status matches current Trello list
- Multiple SMS/emails sent (one per stage)

---

### 4. Special Stage Names
Test with Trello lists that have special characters or names:

**Test Lists:**
- "Sent to Verifier" → Should trigger verification message
- "Sent Docs to Student" → Should say "documents have been sent to your email"
- "Closed" → Should say "Your order is closed"
- "Quality Check" → Should trigger quality verification message
- "Custom Stage 🎯" → Should work with generic message

**Expected Result:**
- All special characters preserved in status
- Appropriate message for each known stage
- Generic fallback for unknown stages

---

### 5. Card Name Format Validation
**Test Card Names:**
- ✅ "ABCD-1234 - English → Arabic" (correct)
- ❌ "Translation for John" (no order code)
- ❌ "abcd-1234 - English → Arabic" (lowercase)
- ✅ "XY12-9999 - French → Spanish - URGENT" (extra text ok)

**Expected Result:**
- Only cards with valid format trigger updates
- Invalid cards ignored (logged but no error)

---

### 6. US Phone Number SMS
**Steps:**
1. Create order with US phone (+1234567890)
2. Move card in Trello
3. Check if SMS received

**Note:** If SMS fails, check:
- Brevo SMS configuration for US numbers
- Consider adding Twilio credentials (see TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM env vars)

---

### 7. Order Without Trello Card
**Steps:**
1. Create an old order (before Trello integration)
2. Track order status
3. Verify it doesn't crash

**Expected Result:**
- Returns order status from database
- No Trello sync attempted (no card ID)
- No errors in logs

---

### 8. Duplicate Webhook Events
**Steps:**
1. Trello sometimes sends duplicate events
2. Move a card once
3. Check if webhook receives event twice

**Expected Result:**
- Second event ignored (status unchanged)
- No duplicate SMS/emails
- Logged: "Status unchanged, no update needed"

---

### 9. Analytics Data Collection
**Steps:**
1. Create order and move through several stages
2. Query `translation_order_events` table
3. Check all transitions are logged with timestamps

**SQL to check:**
```sql
SELECT 
  order_code,
  from_list_name,
  to_list_name,
  created_at
FROM translation_order_events
WHERE order_code = 'YOUR-CODE'
ORDER BY created_at DESC;
```

**Expected Result:**
- Each stage change has an event
- Timestamps show progression
- All list names stored correctly

---

### 10. Admin UI Filtering
**Steps:**
1. Go to admin translation orders page
2. Use Trello stage filter dropdown
3. Filter by different stages
4. Verify correct orders shown

**Expected Result:**
- Dropdown shows all actual Trello list names
- Filtering works correctly
- No hardcoded statuses in dropdown

---

## 🔧 Manual Testing Scripts

### Test 1: Check Current Trello Configuration
```bash
curl https://backend-pythagoras.vercel.app/api/trello-setup/test
```

### Test 2: Verify Webhook Exists
```bash
# Visit: https://backend-pythagoras.vercel.app/api/trello-setup/test
# Look for "webhook" section in response
```

### Test 3: Check Order Status (with auto-sync)
```bash
# Replace ORDER-CODE with actual code
curl https://backend-pythagoras.vercel.app/api/translation-orders/ORDER-CODE/status
```

### Test 4: View Backend Logs (Vercel)
1. Go to: https://vercel.com/your-project/deployments
2. Click latest deployment
3. Click "Functions" tab
4. Look for:
   - `=== Trello Webhook Received ===`
   - `[Sync] Order XYZ...`
   - SMS/Email send confirmations

---

## ✅ Quick Smoke Test Checklist

Before considering the integration complete, test:

- [ ] New order creates Trello card
- [ ] Moving card updates order status
- [ ] Email received with correct stage name
- [ ] SMS received with correct stage name
- [ ] Order tracking shows correct timeline
- [ ] Moving to "Closed" shows "Your order is closed"
- [ ] Moving to "Sent Docs to Student" shows correct message
- [ ] Stuck order auto-syncs when tracked
- [ ] Admin filter dropdown shows Trello stages
- [ ] Events logged in database

---

## 🐛 Common Issues & Solutions

### Issue: SMS not received
**Check:**
1. Backend logs: "Brevo SMS sent successfully" or "Twilio SMS sent successfully"
2. Phone number format: Must include country code (+1 for US)
3. Brevo SMS might not support US numbers reliably
4. **Solution:** Add Twilio credentials to Vercel env vars

### Issue: Order stuck at old stage
**Check:**
1. Verify webhook is active: `/api/trello-setup/test`
2. Check card name starts with order code: "ABCD-1234 - ..."
3. Have user track order - should auto-sync
4. Check backend logs for webhook events

### Issue: No Trello card created
**Check:**
1. Verify order was paid (not just created)
2. Check backend logs for "Created Trello card for order"
3. Verify Stripe webhook fired: check logs for "checkout.session.completed"
4. Check Trello API credentials in Vercel env vars

### Issue: Webhook returns 404
**Check:**
1. Webhook URL should be: `https://backend-pythagoras.vercel.app/api/webhooks/trello`
2. Re-create webhook: visit `/api/trello-setup/webhook`
3. Check route is registered in `src/index.js`

---

## 📊 Advanced: Test Event Analytics

To verify events are being logged correctly for analytics:

```javascript
// Query to check event logging
const { data } = await supabase
  .from('translation_order_events')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(20);

console.log('Recent events:', data);
```

Expected fields in each event:
- `order_id`: UUID
- `order_code`: "ABCD-1234"
- `trello_card_id`: Trello card ID
- `from_list_id`: Previous list ID
- `from_list_name`: Previous list name
- `to_list_id`: New list ID
- `to_list_name`: New list name
- `created_at`: Timestamp

---

## 🎯 Edge Cases to Test

1. **Empty phone number**: Order with email only
2. **Empty email**: Order with phone only
3. **Both empty**: No notifications sent (but status updated)
4. **International phone**: +44, +33, +971, etc.
5. **Card deleted in Trello**: Should handle gracefully
6. **Trello API down**: Sync fallback should log error but not crash
7. **Very long Trello list name**: >255 chars (unlikely but possible)
8. **Special characters in list name**: Emojis, quotes, etc.

---

## 📝 Testing Checklist for Each Release

Before deploying to production:

- [ ] Run smoke test checklist above
- [ ] Test with real phone number
- [ ] Test with real email
- [ ] Create test order and move through all stages
- [ ] Verify events logged in database
- [ ] Check admin UI filters work
- [ ] Test order tracking on mobile
- [ ] Verify SMS includes stage name
- [ ] Test sync fallback by tracking order
- [ ] Check backend logs for errors

---

## 🚨 Emergency Rollback

If integration causes issues:

1. **Disable webhook temporarily:**
   - Go to Trello → Your Board → Settings → Webhooks
   - Delete the webhook
   
2. **Orders will still work:**
   - Manual status updates still possible
   - No automatic sync until webhook re-enabled

3. **Re-enable:**
   - Visit: `https://backend-pythagoras.vercel.app/api/trello-setup/webhook`
   - This will recreate the webhook

