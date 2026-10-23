-- Align the historical database with the current application contract.
-- Dropping NOT NULL is non-destructive: existing values are preserved while
-- events that legitimately omit these optional fields can be created.
ALTER TABLE events ALTER COLUMN host DROP NOT NULL;
ALTER TABLE events ALTER COLUMN event_type DROP NOT NULL;