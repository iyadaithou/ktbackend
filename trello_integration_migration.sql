-- Add Trello integration fields to translation_orders table
-- Run this SQL in your Supabase SQL editor

ALTER TABLE translation_orders 
ADD COLUMN IF NOT EXISTS trello_card_id TEXT,
ADD COLUMN IF NOT EXISTS trello_list_id TEXT,
ADD COLUMN IF NOT EXISTS trello_list_name TEXT;

-- Add index for faster lookups by Trello card ID
CREATE INDEX IF NOT EXISTS idx_translation_orders_trello_card 
ON translation_orders(trello_card_id) 
WHERE trello_card_id IS NOT NULL;

-- Add comment to document the integration
COMMENT ON COLUMN translation_orders.trello_card_id IS 'Trello card ID for this translation order';
COMMENT ON COLUMN translation_orders.trello_list_id IS 'Current Trello list ID where the card is located';
COMMENT ON COLUMN translation_orders.trello_list_name IS 'Current Trello list name (for display/caching)';

