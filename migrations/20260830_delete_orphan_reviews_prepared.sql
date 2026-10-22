-- DESTRUCTIVE PREPARED SCRIPT: do not run without explicit administrator
-- approval. It defaults to aborting inside the transaction.
BEGIN;

DO $$
DECLARE
  operator_approved BOOLEAN := false; -- Change only after documented approval.
  matching_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO matching_rows
  FROM reviews r
  JOIN review_orphan_audit_archive a
    ON a.review_id = r.id AND a.review_row = to_jsonb(r)
  WHERE r.id IN (9, 10);

  IF matching_rows <> 2 THEN
    RAISE EXCEPTION 'Delete refused: archived JSON does not exactly match both live reviews';
  END IF;
  IF NOT operator_approved THEN
    RAISE EXCEPTION 'Default safety abort: set operator_approved = true only after explicit administrator approval';
  END IF;
END $$;

DELETE FROM reviews WHERE id IN (9, 10);
COMMIT;