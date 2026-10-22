-- Forward-only hardening migration. It adds nullable region columns first so
-- existing data is preserved. Administrators must backfill them before
-- Regional Supervisors can manage legacy records.
ALTER TABLE events ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS region TEXT;

-- Refuse to add constraints if historical orphan rows exist. This migration
-- deliberately performs no automatic deletion or reassignment.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM officials o LEFT JOIN users u ON u.id = o.user_id WHERE o.user_id IS NOT NULL AND u.id IS NULL)
    OR EXISTS (SELECT 1 FROM event_officials eo LEFT JOIN events e ON e.id = eo.event_id WHERE e.id IS NULL)
    OR EXISTS (SELECT 1 FROM event_officials eo LEFT JOIN officials o ON o.id = eo.official_id WHERE o.id IS NULL)
    OR EXISTS (SELECT 1 FROM event_teams et LEFT JOIN events e ON e.id = et.event_id WHERE e.id IS NULL)
    OR EXISTS (SELECT 1 FROM event_teams et LEFT JOIN teams t ON t.id = et.team_id WHERE t.id IS NULL)
    OR EXISTS (SELECT 1 FROM reviews r LEFT JOIN users u ON u.id = r.user_id WHERE u.id IS NULL)
    OR EXISTS (SELECT 1 FROM reviews r LEFT JOIN officials o ON o.id = r.official_id WHERE o.id IS NULL)
    OR EXISTS (SELECT 1 FROM reviews r LEFT JOIN events e ON e.id = r.event_id WHERE e.id IS NULL)
  THEN
    RAISE EXCEPTION 'Cannot add relational constraints: orphan relationship rows exist';
  END IF;

  IF EXISTS (SELECT 1 FROM event_officials GROUP BY event_id, official_id HAVING COUNT(*) > 1)
    OR EXISTS (SELECT 1 FROM event_teams GROUP BY event_id, team_id HAVING COUNT(*) > 1)
  THEN
    RAISE EXCEPTION 'Cannot add relationship uniqueness: duplicate join rows exist';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'officials_user_id_users_id_fk') THEN
    ALTER TABLE officials ADD CONSTRAINT officials_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_officials_event_id_events_id_fk') THEN
    ALTER TABLE event_officials ADD CONSTRAINT event_officials_event_id_events_id_fk
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_officials_official_id_officials_id_fk') THEN
    ALTER TABLE event_officials ADD CONSTRAINT event_officials_official_id_officials_id_fk
      FOREIGN KEY (official_id) REFERENCES officials(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_teams_event_id_events_id_fk') THEN
    ALTER TABLE event_teams ADD CONSTRAINT event_teams_event_id_events_id_fk
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_teams_team_id_teams_id_fk') THEN
    ALTER TABLE event_teams ADD CONSTRAINT event_teams_team_id_teams_id_fk
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_user_id_users_id_fk') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_official_id_officials_id_fk') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_official_id_officials_id_fk
      FOREIGN KEY (official_id) REFERENCES officials(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_event_id_events_id_fk') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_event_id_events_id_fk
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS event_officials_event_official_unique ON event_officials(event_id, official_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_teams_event_team_unique ON event_teams(event_id, team_id);
CREATE INDEX IF NOT EXISTS users_user_type_region_idx ON users(user_type, region);
CREATE INDEX IF NOT EXISTS officials_association_idx ON officials(association);
CREATE INDEX IF NOT EXISTS events_region_date_idx ON events(region, date);
CREATE INDEX IF NOT EXISTS teams_region_idx ON teams(region);