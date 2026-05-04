-- =============================================================================
-- Footnote — Full Database Schema
-- =============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- EXISTING TABLES (already created via supabase_rls.sql — do not recreate):
--   • sessions          — research session history (ResearchResponse JSONB)
--   • integrity_reports — full IntegrityReport JSONB blobs
--
-- NEW TABLES ADDED BY THIS FILE:
--   • profiles          — user display names / avatars (extends auth.users)
--   • documents         — user draft text submitted for integrity checking
--   • citations         — normalised citation rows extracted from documents
--   • integrity_results — per-check results linked to a document
-- =============================================================================


-- ---------------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------------
-- One row per auth.users entry. Created automatically on sign-up via the
-- trigger below. Stores display name and avatar — nothing sensitive.

CREATE TABLE IF NOT EXISTS profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Auto-create a profile row whenever a new user signs up.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own profile"   ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

CREATE POLICY "Users can read their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ---------------------------------------------------------------------------
-- DOCUMENTS
-- ---------------------------------------------------------------------------
-- The user's actual draft text submitted for integrity checking.
-- A document is the central entity — citations and integrity_results
-- both hang off document_id.

CREATE TABLE IF NOT EXISTS documents (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text        NOT NULL DEFAULT '',
  content    text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);
CREATE INDEX IF NOT EXISTS documents_created_at_idx ON documents(created_at DESC);

-- Auto-update updated_at on row changes.
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_updated_at ON documents;
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own documents"   ON documents;
DROP POLICY IF EXISTS "Users can insert their own documents" ON documents;
DROP POLICY IF EXISTS "Users can update their own documents" ON documents;
DROP POLICY IF EXISTS "Users can delete their own documents" ON documents;

CREATE POLICY "Users can read their own documents"
  ON documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents"
  ON documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents"
  ON documents FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents"
  ON documents FOR DELETE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- CITATIONS
-- ---------------------------------------------------------------------------
-- Normalised citation rows extracted from a document's reference list.
-- Storing these relationally lets you query across all citations
-- (e.g. find all hallucinated ones, all unverified ones) without unpacking JSONB.

CREATE TABLE IF NOT EXISTS citations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Raw reference string as it appears in the draft
  raw_text     text        NOT NULL,

  -- Parsed fields (nullable — may not always be extractable)
  title        text,
  authors      text[],             -- array of author name strings
  year         int,
  doi          text,
  url          text,

  -- Verification result from external APIs
  status       text        NOT NULL DEFAULT 'unverified'
                           CHECK (status IN ('verified','unverified','hallucinated','mismatch')),
  found_title    text,
  found_doi      text,
  found_url      text,
  found_abstract text,
  source_api     text
                           CHECK (source_api IN ('semantic_scholar','crossref','openalex') OR source_api IS NULL),
  mismatch_reason text,
  confidence     text      NOT NULL DEFAULT 'medium'
                           CHECK (confidence IN ('low','medium','high')),

  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS citations_document_id_idx ON citations(document_id);
CREATE INDEX IF NOT EXISTS citations_user_id_idx     ON citations(user_id);
CREATE INDEX IF NOT EXISTS citations_status_idx      ON citations(status);

ALTER TABLE citations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own citations"   ON citations;
DROP POLICY IF EXISTS "Users can insert their own citations" ON citations;
DROP POLICY IF EXISTS "Users can delete their own citations" ON citations;

CREATE POLICY "Users can read their own citations"
  ON citations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own citations"
  ON citations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own citations"
  ON citations FOR DELETE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- INTEGRITY_RESULTS
-- ---------------------------------------------------------------------------
-- One row per check type per document. Stores the structured result,
-- an overall confidence score, and the specific flagged sections.
-- Replaces the monolithic integrity_reports JSONB blob with queryable rows.

CREATE TABLE IF NOT EXISTS integrity_results (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which of the four integrity checks this row represents
  check_type       text        NOT NULL
                               CHECK (check_type IN (
                                 'ai_detection',
                                 'citation',
                                 'plagiarism',
                                 'claim_match'
                               )),

  -- Full structured result from the backend (CitationCheckResult,
  -- AIWritingResult, ClaimMatchResult, etc.) stored as JSONB so the
  -- frontend can render it without joining other tables.
  result           jsonb       NOT NULL DEFAULT '{}',

  -- 0.0–1.0 scalar representing how confident / severe this result is.
  -- For ai_detection: GPTZero probability (0 = human, 1 = AI).
  -- For citation:     fraction of citations verified (1 = all verified).
  -- For claim_match:  fraction of claims supported (1 = all supported).
  -- For plagiarism:   risk score (0 = clean, 1 = high risk).
  confidence_score float       NOT NULL DEFAULT 0.0
                               CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),

  -- Array of flagged text sections — each object has { text, reason, severity }.
  flagged_sections jsonb       NOT NULL DEFAULT '[]',

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integrity_results_document_id_idx ON integrity_results(document_id);
CREATE INDEX IF NOT EXISTS integrity_results_user_id_idx     ON integrity_results(user_id);
CREATE INDEX IF NOT EXISTS integrity_results_check_type_idx  ON integrity_results(check_type);

ALTER TABLE integrity_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own integrity results"   ON integrity_results;
DROP POLICY IF EXISTS "Users can insert their own integrity results" ON integrity_results;
DROP POLICY IF EXISTS "Users can delete their own integrity results" ON integrity_results;

CREATE POLICY "Users can read their own integrity results"
  ON integrity_results FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own integrity results"
  ON integrity_results FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own integrity results"
  ON integrity_results FOR DELETE
  USING (auth.uid() = user_id);


-- =============================================================================
-- VERIFICATION QUERY
-- Run after executing this script to confirm all 6 tables have RLS enabled.
-- =============================================================================

SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE tablename IN (
  'sessions', 'integrity_reports',
  'profiles', 'documents', 'citations', 'integrity_results'
)
  AND schemaname = 'public'
ORDER BY tablename;
