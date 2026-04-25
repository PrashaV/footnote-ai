// Supabase client and persistence helpers for Footnote.
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
 * @returns The newly-inserted row, or `null` if Supabase is not configured
 *          or the insert fails.
 */
export async function saveSession(
  topic: string,
  response: ResearchResponse,
  userId?: string,
): Promise<SessionRow | null> {
  const client = getClient();
  if (!client) return null;

  const payload: Record<string, unknown> = { topic, response };
  if (userId) payload.user_id = userId;

  const { data, error } = await client
    .from("sessions")
    .insert(payload)
    .select()
    .single<SessionRow>();

  if (error) {
    console.error("[supabase] Failed to save session:", error.message);
    return null;
  }

  return data;
}

/**
 * Retrieve all saved sessions, ordered newest-first.
 *
 * @returns An array of SessionRows (may be empty), or `null` if Supabase is
 *          not configured or the query fails.
 */
export async function getSessions(): Promise<SessionRow[] | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("sessions")
    .select("id, topic, created_at, response")
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
 * @param userId  Optional: the authenticated user's ID.
 * @returns The newly-inserted row, or `null` on failure.
 */
export async function saveIntegrityReport(
  report: IntegrityReport,
  userId?: string,
): Promise<IntegrityReportRow | null> {
  const client = getClient();
  if (!client) return null;

  const payload: Record<string, unknown> = { report, title: report.title ?? null };
  if (userId) payload.user_id = userId;

  const { data, error } = await client
    .from("integrity_reports")
    .insert(payload)
    .select()
    .single<IntegrityReportRow>();

  if (error) {
    console.error("[supabase] Failed to save integrity report:", error.message);
    return null;
  }

  return data;
}

/**
 * Retrieve all saved integrity reports for the current user, newest-first.
 *
 * @returns An array of IntegrityReportRows (may be empty), or `null` on failure.
 */
export async function getIntegrityReports(): Promise<IntegrityReportRow[] | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("integrity_reports")
    .select("id, user_id, title, created_at, report")
    .order("created_at", { ascending: false })
    .returns<IntegrityReportRow[]>();

  if (error) {
    console.error("[supabase] Failed to fetch integrity reports:", error.message);
    return null;
  }

  return data ?? [];
}
