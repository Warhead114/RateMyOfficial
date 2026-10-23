-- Development additive schema only. No automatic job, data backfill or sends.
CREATE TABLE IF NOT EXISTS email_validation_fixtures (
  run_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  records JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS email_validation_authorizations (
  authorization_id TEXT PRIMARY KEY,
  fixture_run_id TEXT NOT NULL REFERENCES email_validation_fixtures(run_id),
  manifest_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  attempts_used INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  attempted_row_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
