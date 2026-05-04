// Supabase client and persistence helpers for Footnote.
//
// ── Documents table schema (run in Supabase SQL Editor) ───────────────────
//
//   CREATE TABLE IF NOT EXISTS documents (
//     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id     uuid        NOT NULL REFERENCES auth.users(id),
//     title       text        NOT NULL DEFAULT 'Untitled Document',
//     content     jsonb       NOT NULL DEFAULT '{}',
//     created_at  timestamptz NOT NULL DEFAULT now(),
//     updated_at  timestamptz NOT NULL DEFAULT now()
//   );
//   CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);
//
//   ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users can read their own documents"
//     ON documents FOR SELECT USING (auth.uid() = user_id);
//   CREATE POLICY "Users can insert their own documents"
//     ON documents FOR INSERT WITH CHECK (auth.uid() = user_id);
//   CREATE POLICY "Users can update their own documents"
//     ON documents FOR UPDATE USING (auth.uid() = user_id);
//   CREATE POLICY "Users can delete their own documents"
//     ON documents FOR DELETE USING (auth.uid() = user_id);
//
//   -- Auto-update updated_at on every row change:
//   CREATE OR REPLACE FUNCTION update_updated_at_column()
//   RETURNS TRIGGER AS $$
//   BEGIN NEW.updated_at = now(); RETURN NEW; END;
//   $$ LANGUAGE plpgsql;
//
//   CREATE TRIGGER documents_updated_at
//     BEFORE UPDATE ON documents
//     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
//
// ── Sessions table schema ──────────────────────────────────────────────────
//
//   CREATE TABLE IF NOT EXISTS sessions (
//     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id     uuid        REFERENCES auth.users(id),
//     topic       text        NOT NULL,
//     created_at  timestamptz NOT NULL DEFAULT now(),
//     response    jsonb       NOT NULL
//   );
//   CREATE INDEX IF NOT EXISTS sessions_created_at_idx
//     ON sessions (created_at DESC);
//
// ── Integrity reports table schema ──────────────────────────────────────────
//
//   CREATE TABLE IF NOT EXISTS integrity_reports (
//     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id     uuid        REFERENCES auth.users(id),
//     title       text,
//     created_at  timestamptz NOT NULL DEFAULT now(),
//     report      jsonb       NOT NULL
//   );
//   CREATE INDEX IF NOT EXISTS integrity_reports_user_id_idx
//     ON integrity_reports(user_id);
//
// ─────────────────────────────────────────────────────────────────────────────

import type { ResearchResponse } from "../api/types";
import type { IntegrityReport } from "../api/verifyTypes";
import { getSupabaseClient } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// Client helper — re-uses the singleton from AuthContext
// ---------------------------------------------------------------------------

function getClient() {
  const client = getSupabaseClient();
  if (!client) {
    console.warn(
      "[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. " +
      "Persistence is disabled. " +
      "Add both vars to your .env file — see supabase.com/dashboard to get them.",
    );
  }
  return client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A row returned from the `sessions` table. */
export interface SessionRow {
  id: string;
  user_id?: string;
  topic: string;
  created_at: string;
  response: ResearchResponse;
}

/** A row returned from the `integrity_reports` table. */
export interface IntegrityReportRow {
  id: string;
  user_id?: string;
  title: string | null;
  created_at: string;
  report: IntegrityReport;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a completed research session to Supabase.
 *
 * @param topic    The search topic that was researched.
 * @param response The full ResearchResponse to store as JSONB.
 * @param userId   The authenticated user's UUID (required — skips insert if absent).
 * @returns The newly-inserted row, or `null` if Supabase is not configured,
 *          userId is missing, or the insert fails.
 */
export async function saveSession(
  topic: string,
  response: ResearchResponse,
  userId: string,
): Promise<SessionRow | null> {
  const client = getClient();
  if (!client) return null;

  if (!userId) {
    console.warn("[supabase] saveSession called without userId — skipping insert to prevent anonymous data.");
    return null;
  }

  const { data, error } = await client
    .from("sessions")
    .insert({ topic, response, user_id: userId })
    .select()
    .single<SessionRow>();

  if (error) {
    console.error("[supabase] Failed to save session:", error.message);
    return null;
  }

  return data;
}

/**
 * Retrieve all saved sessions for the given user, ordered newest-first.
 *
 * Applies an explicit `.eq("user_id", userId)` filter as defense-in-depth
 * on top of RLS, so only the calling user's rows are ever returned.
 *
 * @param userId  The authenticated user's UUID.
 * @returns An array of SessionRows (may be empty), or `null` on failure.
 */
export async function getSessions(userId: string): Promise<SessionRow[] | null> {
  const client = getClient();
  if (!client) return null;

  if (!userId) {
    console.warn("[supabase] getSessions called without userId — returning empty.");
    return [];
  }

  const { data, error } = await client
    .from("sessions")
    .select("id, user_id, topic, created_at, response")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<SessionRow[]>();

  if (error) {
    console.error("[supabase] Failed to fetch sessions:", error.message);
    return null;
  }

  return data ?? [];
}

/**
 * Persist a completed integrity report to Supabase.
 *
 * @param report  The full IntegrityReport to store as JSONB.
 * @param userId  The authenticated user's UUID (required — skips insert if absent).
 * @returns The newly-inserted row, or `null` on failure.
 */
export async function saveIntegrityReport(
  report: IntegrityReport,
  userId: string,
): Promise<IntegrityReportRow | null> {
  const client = getClient();
  if (!client) return null;

  if (!userId) {
    console.warn("[supabase] saveIntegrityReport called without userId — skipping insert to prevent anonymous data.");
    return null;
  }

  const { data, error } = await client
    .from("integrity_reports")
    .insert({ report, title: report.title ?? null, user_id: userId })
    .select()
    .single<IntegrityReportRow>();

  if (error) {
    console.error("[supabase] Failed to save integrity report:", error.message);
    return null;
  }

  return data;
}

/**
 * Retrieve all saved integrity reports for the given user, newest-first.
 *
 * Applies an explicit `.eq("user_id", userId)` filter as defense-in-depth
 * on top of RLS.
 *
 * @param userId  The authenticated user's UUID.
 * @returns An array of IntegrityReportRows (may be empty), or `null` on failure.
 */
export async function getIntegrityReports(userId: string): Promise<IntegrityReportRow[] | null> {
  const client = getClient();
  if (!client) return null;

  if (!userId) {
    console.warn("[supabase] getIntegrityReports called without userId — returning empty.");
    return [];
  }

  const { data, error } = await client
    .from("integrity_reports")
    .select("id, user_id, title, created_at, report")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<IntegrityReportRow[]>();

  if (error) {
    console.error("[supabase] Failed to fetch integrity reports:", error.message);
    return null;
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Documents — research workspace documents
// ---------------------------------------------------------------------------

/** A row from the `documents` table. */
export interface DocumentRow {
  id: string;
  user_id: string;
  title: string;
  /** TipTap JSON content stored as JSONB. */
  content: object;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new blank document for the given user.
 *
 * @param userId  The authenticated user's UUID.
 * @param title   Optional initial title (defaults to "Untitled Document").
 * @returns The newly-inserted DocumentRow, or `null` on failure.
 */
export async function createDocument(
  userId: string,
  title = "Untitled Document",
): Promise<DocumentRow | null> {
  const client = getClient();
  if (!client || !userId) return null;

  const { data, error } = await client
    .from("documents")
    .insert({ user_id: userId, title, content: {} })
    .select()
    .single<DocumentRow>();

  if (error) {
    console.error("[supabase] Failed to create document:", error.message);
    return null;
  }
  return data;
}

/**
 * Patch an existing document's title and/or content.
 *
 * @param docId   The document UUID to update.
 * @param userId  The authenticated user's UUID (used as a second-layer filter).
 * @param patch   Fields to update — at least one of `title` or `content`.
 * @returns The updated DocumentRow, or `null` on failure.
 */
export async function updateDocument(
  docId: string,
  userId: string,
  patch: { title?: string; content?: object },
): Promise<DocumentRow | null> {
  const client = getClient();
  if (!client || !userId || !docId) return null;
  if (!patch.title && !patch.content) return null;

  const { data, error } = await client
    .from("documents")
    .update(patch)
    .eq("id", docId)
    .eq("user_id", userId)
    .select()
    .single<DocumentRow>();

  if (error) {
    console.error("[supabase] Failed to update document:", error.message);
    return null;
  }
  return data;
}

/**
 * Fetch a single document by ID for the given user.
 *
 * @param docId   The document UUID.
 * @param userId  The authenticated user's UUID.
 * @returns The DocumentRow, or `null` if not found or on failure.
 */
export async function getDocument(
  docId: string,
  userId: string,
): Promise<DocumentRow | null> {
  const client = getClient();
  if (!client || !userId || !docId) return null;

  const { data, error } = await client
    .from("documents")
    .select("*")
    .eq("id", docId)
    .eq("user_id", userId)
    .single<DocumentRow>();

  if (error) {
    console.error("[supabase] Failed to fetch document:", error.message);
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Citations — inline citations added via @ autocomplete in the editor
// ---------------------------------------------------------------------------
//
// SQL to run in Supabase SQL Editor:
//
//   CREATE TABLE IF NOT EXISTS citations (
//     id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//     document_id   uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
//     user_id       uuid        NOT NULL REFERENCES auth.users(id),
//     paper_id      text        NOT NULL,
//     title         text        NOT NULL,
//     authors       jsonb       NOT NULL DEFAULT '[]',
//     year          integer,
//     doi           text,
//     external_ids  jsonb       NOT NULL DEFAULT '{}',
//     inserted_text text        NOT NULL,
//     created_at    timestamptz NOT NULL DEFAULT now(),
//     UNIQUE (document_id, paper_id)
//   );
//   CREATE INDEX IF NOT EXISTS citations_document_id_idx ON citations(document_id);
//   ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users can read their own citations"
//     ON citations FOR SELECT USING (auth.uid() = user_id);
//   CREATE POLICY "Users can insert their own citations"
//     ON citations FOR INSERT WITH CHECK (auth.uid() = user_id);
//   CREATE POLICY "Users can delete their own citations"
//     ON citations FOR DELETE USING (auth.uid() = user_id);

/** A row from the `citations` table. */
export interface CitationRow {
  id: string;
  document_id: string;
  user_id: string;
  paper_id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  external_ids: Record<string, string>;
  inserted_text: string;
  created_at: string;
}

/**
 * Save a citation to the `citations` table.
 * Uses UPSERT (ON CONFLICT DO NOTHING) so re-inserting the same paper into
 * the same document is silently ignored.
 *
 * @returns The saved CitationRow, or `null` on failure.
 */
export async function saveCitation(
  citation: Omit<CitationRow, "id" | "created_at">,
): Promise<CitationRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("citations")
    .upsert(citation, { onConflict: "document_id,paper_id", ignoreDuplicates: true })
    .select()
    .single<CitationRow>();

  if (error) {
    console.error("[supabase] Failed to save citation:", error.message);
    return null;
  }
  return data;
}

/**
 * Fetch all citations for a given document, ordered by insertion time.
 *
 * @returns An array of CitationRows (may be empty), or `null` on failure.
 */
export async function getCitationsForDocument(
  documentId: string,
  userId: string,
): Promise<CitationRow[] | null> {
  const client = getClient();
  if (!client || !documentId || !userId) return null;

  const { data, error } = await client
    .from("citations")
    .select("*")
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .returns<CitationRow[]>();

  if (error) {
    console.error("[supabase] Failed to fetch citations:", error.message);
    return null;
  }
  return data ?? [];
}
