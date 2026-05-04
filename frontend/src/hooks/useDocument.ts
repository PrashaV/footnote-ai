// useDocument — manages a single Footnote workspace document.
//
// Responsibilities:
//   • Creates a new blank document in Supabase the first time a user lands on
//     the workspace (if userId is present).
//   • Accepts title and content updates from the editor, batches them into
//     a pending patch, and flushes to Supabase after 2 s of inactivity
//     (debounced).
//   • Exposes a `saveStatus` so the top bar can show "Saving…" / "Saved".

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDocument,
  updateDocument,
} from "../services/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseDocumentReturn {
  /** UUID of the current document, null while it is being created. */
  docId: string | null;
  /** Current save status — drives the top-bar indicator. */
  saveStatus: SaveStatus;
  /** Controlled title value — kept in sync with both UI state and pending patch. */
  currentTitle: string;
  /** Call when the title input changes. Schedules a debounced save. */
  updateTitle: (title: string) => void;
  /** Call on every TipTap `onUpdate`. Schedules a debounced save. */
  updateContent: (content: object) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 2_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocument(userId: string | null): UseDocumentReturn {
  const [docId, setDocId]         = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [currentTitle, setCurrentTitle] = useState("Untitled Document");

  // Accumulate changes between debounce flushes so we always send the
  // most-recent title+content in a single Supabase PATCH.
  const pendingPatch = useRef<{ title?: string; content?: object }>({});
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against double-creation in React StrictMode (double-invoke).
  const isCreating = useRef(false);

  // ── Create document on mount (once userId is available) ─────────────────
  useEffect(() => {
    if (!userId || docId || isCreating.current) return;
    isCreating.current = true;

    createDocument(userId).then((row) => {
      if (row) {
        setDocId(row.id);
        setCurrentTitle(row.title);
        setSaveStatus("saved");
      } else {
        // Supabase not configured or insert failed — editor still works,
        // just without persistence.
        setSaveStatus("error");
      }
      isCreating.current = false;
    });
  }, [userId, docId]);

  // ── Flush pending patch to Supabase ─────────────────────────────────────
  const flushSave = useCallback(async () => {
    if (!docId || !userId) return;

    const patch = pendingPatch.current;
    if (Object.keys(patch).length === 0) return;

    // Clear pending before the await so rapid edits that arrive while we
    // are awaiting start a new batch rather than being lost.
    pendingPatch.current = {};
    setSaveStatus("saving");

    const result = await updateDocument(docId, userId, patch);
    setSaveStatus(result ? "saved" : "error");
  }, [docId, userId]);

  // ── Schedule the debounced flush ─────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    setSaveStatus("idle"); // reset to idle while typing
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(flushSave, DEBOUNCE_MS);
  }, [flushSave]);

  // ── Public update functions ───────────────────────────────────────────────
  const updateTitle = useCallback((title: string) => {
    setCurrentTitle(title);
    pendingPatch.current = { ...pendingPatch.current, title };
    scheduleSave();
  }, [scheduleSave]);

  const updateContent = useCallback((content: object) => {
    pendingPatch.current = { ...pendingPatch.current, content };
    scheduleSave();
  }, [scheduleSave]);

  // ── Cleanup: flush on unmount, clear timer ────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      // Best-effort flush on unmount (fire-and-forget).
      flushSave();
    };
    // flushSave is stable between renders (docId/userId deps are captured by
    // the closure inside flushSave itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { docId, saveStatus, currentTitle, updateTitle, updateContent };
}
