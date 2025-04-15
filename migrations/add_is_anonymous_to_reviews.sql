-- Add is_anonymous column to reviews table
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;