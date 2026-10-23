-- Additive transactional email delivery infrastructure.
-- This migration is for Development review/application only. It does not
-- modify existing users, events, reviews, or notification records.
CREATE TABLE IF NOT EXISTS email_outbox (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  recipient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  payload JSONB NOT NULL,
  encrypted_payload TEXT,
  deduplication_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error_code TEXT,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  claim_token TEXT,
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT email_outbox_type_check CHECK (
    type IN (
      'registration_received',
      'account_approved',
      'account_rejected',
      'evaluation_submitted',
      'password_reset',
      'event_created',
      'event_reminder'
    )
  ),
  CONSTRAINT email_outbox_status_check CHECK (
    status IN ('pending', 'processing', 'retry_wait', 'sent', 'failed', 'cancelled')
  ),
  CONSTRAINT email_outbox_attempts_check CHECK (
    attempt_count >= 0 AND max_attempts > 0
  ),
  CONSTRAINT email_outbox_password_reset_payload_check CHECK (
    type <> 'password_reset'
    OR (
      encrypted_payload IS NOT NULL
      AND NOT jsonb_exists(payload, 'resetUrl')
    )
  )
);

ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS encrypted_payload TEXT;

ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS claim_token TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_outbox_password_reset_payload_check'
      AND conrelid = 'email_outbox'::regclass
  ) THEN
    ALTER TABLE email_outbox
      ADD CONSTRAINT email_outbox_password_reset_payload_check CHECK (
        type <> 'password_reset'
        OR (
          encrypted_payload IS NOT NULL
          AND NOT jsonb_exists(payload, 'resetUrl')
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON email_outbox(status, scheduled_for, next_attempt_at);

CREATE INDEX IF NOT EXISTS email_outbox_claim_idx
  ON email_outbox(status, claimed_at);

CREATE INDEX IF NOT EXISTS email_outbox_recipient_idx
  ON email_outbox(recipient_user_id, created_at);