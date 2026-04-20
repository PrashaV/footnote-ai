// Supabase client and session persistence helpers for Footnote.
//
// ── Sessions table schema (run in Supabase SQL Editor to create the table) ──
//
//   CREATE TABLE IF NOT EXISTS sessions (
//     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//     topic       text        NOT NULL,
//     created_at  timestamptz NOT NULL DEFAULT now(),
//     response    jsonb       NOT NULL
//   );
//
//   -- Optional: index for listing sessions newest-first
//   CREATE INDEX IF NOT EXISTS sessions_created_at_idx
//     ON sessions (created_at DESC);
//
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import type { ResearchResponse } from "../api/types";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Lazily-initialised Supabase client. Returns `null` (with a console warning)
 * when the env vars are absent so the rest of the app still runs without
 * Supabase configured.
 */
function getClient() {
  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. " +
      "Session persistence is disabled. " +
      "Add both vars to your .env file — see supabase.com/dashboard to get them.",
    );
    return null;
  }
  return createClient(supabaseUrl, supabaseKey);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A row returned from the `sessions` table. */
export interface SessionRow {
  id: string;
  topic: string;
  created_at: string;
  response: ResearchResponse;
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
): Promise<SessionRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("sessions")
    .insert({ topic, response })
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
