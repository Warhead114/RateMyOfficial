-- Additive Development migration; no startup-time or deployment-hook DDL.
ALTER TABLE events ADD COLUMN IF NOT EXISTS notification_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS password_reset_rate_limits (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_rate_limits_expiry_idx
  ON password_reset_rate_limits(expires_at);
