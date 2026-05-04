-- =============================================================================
-- Footnote — Supabase Row Level Security (RLS) Setup
-- =============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- What this does:
--   1. Ensures the sessions and integrity_reports tables exist with the right schema
--   2. Enables RLS on both tables
--   3. Creates policies so users can only read/write their own rows
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SESSIONS TABLE
-- ---------------------------------------------------------------------------

-- Add user_id column if upgrading from an anonymous schema
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read only their own sessions.
-- NOTE: "OR user_id IS NULL" was intentionally removed — anonymous rows
-- would be visible to every authenticated user, which is a data leak.
-- Sessions are now always saved with a user_id (enforced in supabase.ts).
DROP POLICY IF EXISTS "Users can read their own sessions" ON sessions;
CREATE POLICY "Users can read their own sessions"
  ON sessions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow authenticated users to insert only rows they own.
-- Inserts without a matching user_id are rejected by RLS.
DROP POLICY IF EXISTS "Users can insert their own sessions" ON sessions;
CREATE POLICY "Users can insert their own sessions"
  ON sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to delete their own sessions.
DROP POLICY IF EXISTS "Users can delete their own sessions" ON sessions;
CREATE POLICY "Users can delete their own sessions"
  ON sessions
  FOR DELETE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- INTEGRITY_REPORTS TABLE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS integrity_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id),
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  report      jsonb       NOT NULL
);

CREATE INDEX IF NOT EXISTS integrity_reports_user_id_idx
  ON integrity_reports(user_id);

-- Enable Row Level Security
ALTER TABLE integrity_reports ENABLE ROW LEVEL SECURITY;

-- Only the owning user can read their own reports (no anonymous rows here)
DROP POLICY IF EXISTS "Users can read their own reports" ON integrity_reports;
CREATE POLICY "Users can read their own reports"
  ON integrity_reports
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only the owning user can insert their own reports
DROP POLICY IF EXISTS "Users can insert their own reports" ON integrity_reports;
CREATE POLICY "Users can insert their own reports"
  ON integrity_reports
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only the owning user can delete their own reports
DROP POLICY IF EXISTS "Users can delete their own reports" ON integrity_reports;
CREATE POLICY "Users can delete their own reports"
  ON integrity_reports
  FOR DELETE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- Verify RLS is active (should return rows for both tables)
-- ---------------------------------------------------------------------------

SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE tablename IN ('sessions', 'integrity_reports')
  AND schemaname = 'public';
