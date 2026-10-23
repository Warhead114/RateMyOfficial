-- Additive support for the internal controlled-delivery test email type.
-- Apply to Development for Task #19 validation. Do not apply to Production
-- until a separately authorized controlled-delivery activation task.
ALTER TABLE email_outbox
  DROP CONSTRAINT IF EXISTS email_outbox_type_check;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_type_check CHECK (
    type IN (
      'registration_received',
      'account_approved',
      'account_rejected',
      'evaluation_submitted',
      'password_reset',
      'event_created',
      'event_reminder',
      'controlled_delivery_test'
    )
  );