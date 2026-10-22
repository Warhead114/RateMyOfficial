-- This migration intentionally refuses to continue if duplicate reviews exist.
-- Inspect and resolve duplicates manually before retrying; no historical review
-- is deleted automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM reviews
    GROUP BY user_id, official_id, event_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add reviews_user_official_event_unique: duplicate review tuples exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_official_event_unique
  ON reviews (user_id, official_id, event_id);

CREATE INDEX IF NOT EXISTS reviews_official_pending_idx
  ON reviews (official_id, is_pending);

CREATE INDEX IF NOT EXISTS reviews_user_idx
  ON reviews (user_id);