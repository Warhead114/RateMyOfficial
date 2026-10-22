
-- Add isPending column to reviews table
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_pending BOOLEAN DEFAULT false;

-- Set existing reviews to not pending
UPDATE reviews SET is_pending = false WHERE is_pending IS NULL;
