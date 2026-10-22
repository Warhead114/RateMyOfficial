-- Additive Development-only application; no automatic trust backfill.
CREATE TABLE IF NOT EXISTS coach_notification_identities (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  identity_key TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Idempotent upgrade for Development installations created before identity keys.
ALTER TABLE coach_notification_identities ADD COLUMN IF NOT EXISTS
  identity_key TEXT NOT NULL DEFAULT gen_random_uuid()::text;
