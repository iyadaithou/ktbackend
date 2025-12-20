# Trello Integration Setup Guide

## Overview
The translation orders system is now integrated with Trello for seamless order management. Orders automatically create Trello cards when paid, and status updates sync bidirectionally between Trello and your platform.

---

## ✅ What's Been Implemented

### 1. **Backend Services** (`src/services/trello.js`)
- Full Trello API integration
- Functions to create cards, move cards, fetch board lists
- Automatic card creation with document attachments
- Smart list name to status mapping

### 2. **Webhook Integration** (`src/routes/trello_webhook.js`)
- Receives Trello card movement events
- Automatically updates order status in database when cards move between lists
- Sends email/SMS notifications to customers on status changes
- Extracts order code from card names

### 3. **Admin API Routes** (`src/routes/trello_admin.js`)
- `/api/trello/lists` - Fetch all Trello board lists
- `/api/trello/board` - Get board information
- `/api/trello/config` - Check Trello configuration status
- `/api/trello/webhook/setup` - Create/update webhook
- `/api/trello/webhooks` - List all webhooks

### 4. **Automatic Card Creation** (`src/routes/webhooks.js`)
- When Stripe payment completes, automatically creates a Trello card
- Card includes:
  - Order code and language pair in title
  - Customer contact info in description
  - Document attached to card
  - Order details (pages, amount, etc.)

### 5. **Frontend Updates**
- **Admin Dashboard**: Shows Trello card links, removed manual status editing
- **Order Timeline**: Displays Trello list names alongside statuses
- **Trello Integration Status**: Shows if Trello is active in admin panel

---

## 🔧 Environment Variables Required

Add these to your **Vercel Backend** environment variables:

```bash
TRELLO_API_KEY=your_api_key_here
TRELLO_TOKEN=your_token_here
TRELLO_BOARD_ID=your_board_id_here
```

---

## 📝 How to Get Trello Credentials

### 1. **Get API Key**
1. Go to https://trello.com/power-ups/admin
2. Click "New" to create a new Power-Up
3. Copy your API Key

### 2. **Generate Token**
1. On the same page, click "Token" link
2. Authorize the token (select "Never Expires" for permanent access)
3. Copy the token

### 3. **Get Board ID**
1. Open your Trello board in browser
2. Add `.json` to the URL (e.g., `https://trello.com/b/XXXXX.json`)
3. Look for the `"id"` field in the JSON response
4. Copy that ID

---

## 🎯 Setting Up Your Trello Board

### Recommended List Names
Create lists in your Trello board with these names (in order):

1. **Payment Received** or **New Orders** - Where new paid orders appear
2. **In Progress** or **Processing** - Orders being worked on
3. **Quality Check** or **Review** - Orders under review
4. **Completed** or **Delivered** - Finished orders
5. **Cancelled** (optional) - Cancelled orders

> **Note**: The system automatically maps list names to statuses. You can use any names you want!

---

## 🔗 Setting Up the Webhook

### Option 1: Automatic Setup (via Admin Panel)
1. Go to your admin panel
2. Navigate to Translation Orders
3. Click "Setup Trello Webhook" (if you add this button)
4. Webhook will be created automatically

### Option 2: Manual Setup (via API)
```bash
curl -X POST https://backend-pythagoras.vercel.app/api/trello/webhook/setup \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

### Option 3: Via Trello API Directly
The webhook URL is: `https://backend-pythagoras.vercel.app/api/webhooks/trello`

---

## 🔄 How It Works

### When a Customer Pays:
1. ✅ Stripe payment completes
2. 📧 Customer receives confirmation email/SMS
3. 📋 **Trello card is automatically created** in first list
4. 💾 Order is saved with `trello_card_id` reference

### When You Move a Card in Trello:
1. 👉 You drag a card to a different list
2. 🔔 Trello sends webhook to your backend
3. 🔄 Order status is automatically updated in database
4. 📧 Customer receives status update notification (for important stages)

### When Customer Checks Status:
1. 🔍 Customer enters order code on website
2. 📊 Timeline shows current status with Trello list name
3. ✨ Real-time sync with Trello board

---

## 🗄️ Database Changes

The following columns were added to `translation_orders` table:

```sql
- trello_card_id (TEXT) - Trello card ID
- trello_list_id (TEXT) - Current list ID
- trello_list_name (TEXT) - Current list name (for display)
```

---

## 🎨 Status Mapping

The system automatically maps Trello list names to internal statuses:

| Trello List Pattern | Internal Status |
|-------------------|----------------|
| Contains "payment", "paid", "new" | PAID |
| Contains "progress", "working", "translat" | PROCESSING |
| Contains "review", "quality", "check" | VERIFIED |
| Contains "complete", "done", "deliver", "sent" | SENT |
| Contains "cancel" | CANCELLED |

---

## 🧪 Testing the Integration

### Test 1: Check Configuration
```bash
curl https://backend-pythagoras.vercel.app/api/trello/config \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

Expected response:
```json
{
  "success": true,
  "config": {
    "apiKeyConfigured": true,
    "tokenConfigured": true,
    "boardIdConfigured": true,
    "boardId": "your_board_id"
  }
}
```

### Test 2: Fetch Board Lists
```bash
curl https://backend-pythagoras.vercel.app/api/trello/lists \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

### Test 3: Create a Test Order
1. Make a test payment through your translation form
2. Check your Trello board - a new card should appear
3. Move the card to another list
4. Check the order status on your website - it should update

---

## 🐛 Troubleshooting

### Cards Not Creating
- ✅ Check environment variables are set in Vercel
- ✅ Verify API key and token are valid
- ✅ Check backend logs for errors
- ✅ Ensure board ID is correct

### Status Not Updating
- ✅ Verify webhook is created (check `/api/trello/webhooks`)
- ✅ Check webhook callback URL is correct
- ✅ Look at backend logs when moving cards
- ✅ Ensure Trello can reach your webhook URL

### "No Trello card" in Admin
- ✅ This is normal for orders created before Trello integration
- ✅ Only new paid orders will have Trello cards

---

## 🎉 Benefits

1. **No Manual Status Updates**: Status changes happen automatically in Trello
2. **Visual Board**: See all orders at a glance on your Trello board
3. **Team Collaboration**: Multiple team members can work on translation orders
4. **Customer Transparency**: Customers see real-time status updates
5. **Document Attachments**: All documents are attached to Trello cards
6. **Email/SMS Notifications**: Automatic customer notifications on progress

---

## 📞 Support

If you encounter any issues:
1. Check Vercel backend logs
2. Check Trello webhook delivery logs (in Trello settings)
3. Verify all environment variables are set correctly
4. Test the `/api/trello/config` endpoint

---

**🚀 Your Trello integration is ready to use!**

