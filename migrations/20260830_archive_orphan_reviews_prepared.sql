-- NON-DESTRUCTIVE PREPARED ARCHIVE: this script may be run independently. It
-- commits an auditable JSON snapshot but never deletes a review.
BEGIN;

CREATE TABLE IF NOT EXISTS review_orphan_audit_archive (
  archive_id BIGSERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL UNIQUE,
  review_row JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by TEXT NOT NULL,
  archive_reason TEXT NOT NULL
);

INSERT INTO review_orphan_audit_archive (
  review_id, review_row, archived_by, archive_reason
)
SELECT
  r.id,
  to_jsonb(r),
  current_user,
  'Historical orphan review: missing referenced user/event; archive then delete only after administrator approval'
FROM reviews r
WHERE r.id IN (9, 10)
ON CONFLICT (review_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM review_orphan_audit_archive WHERE review_id IN (9, 10)) <> 2 THEN
    RAISE EXCEPTION 'Archive verification failed: expected reviews 9 and 10';
  END IF;
END $$;
COMMIT;