// SessionHistory — sidebar that lists previously saved Supabase sessions.
//
// Clicking a row calls `onRestore(session.response)` so the parent can
// reinstate the full ResearchResponse without re-querying the API.
//
// The component is self-loading: it fetches sessions on mount and exposes a
// refresh() trigger so the parent can ask it to reload after a new save.

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  type FC,
} from "react";
import { getSessions, type SessionRow } from "../services/supabase";
import type { ResearchResponse } from "../api/types";

// ---------------------------------------------------------------------------
// Public handle type (so App.tsx can call ref.current?.refresh())
// ---------------------------------------------------------------------------

export interface SessionHistoryHandle {
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionHistoryProps {
  /** Called when the user clicks a session row to restore it. */
  onRestore: (response: ResearchResponse, topic: string) => void;
  /** The topic of the currently-displayed result, used to highlight the active row. */
  activeTopic?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SessionHistory = forwardRef<SessionHistoryHandle, SessionHistoryProps>(
  ({ onRestore, activeTopic }, ref) => {
    const [sessions, setSessions]   = useState<SessionRow[] | null>(null);
    const [loading,  setLoading]    = useState(true);
    const [error,    setError]      = useState<string | null>(null);
    const mountedRef                = useRef(true);

    const load = async () => {
      setLoading(true);
      setError(null);
      const rows = await getSessions();
      if (!mountedRef.current) return;
      if (rows === null) {
        setError("Session history unavailable — Supabase is not configured.");
      } else {
        setSessions(rows);
      }
      setLoading(false);
    };

    useEffect(() => {
      mountedRef.current = true;
      load();
      return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Expose refresh() to parent via ref
    useImperativeHandle(ref, () => ({ refresh: load }), []);

    // ── Render states ────────────────────────────────────────────────────

    const renderContent = () => {
      if (loading) {
        return (
          <ul className="space-y-2">
            {[1, 2, 3].map((i) => (
              <li key={i} className="animate-pulse rounded-lg bg-slate-100 p-3">
                <div className="mb-1.5 h-3.5 w-3/4 rounded bg-slate-200" />
                <div className="h-3 w-1/3 rounded bg-slate-200" />
              </li>
            ))}
          </ul>
        );
      }

      if (error) {
        return (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {error}
          </p>
        );
      }

      if (!sessions || sessions.length === 0) {
        return (
          <p className="text-xs text-slate-400">
            No sessions yet. Run a search to save one.
          </p>
        );
      }

      return (
        <ul className="space-y-1.5">
          {sessions.map((s) => {
            const isActive = activeTopic?.toLowerCase() === s.topic.toLowerCase();
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onRestore(s.response, s.topic)}
                  className={[
                    "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                    isActive
                      ? "bg-indigo-50 ring-1 ring-indigo-200"
                      : "bg-slate-50 hover:bg-slate-100",
                  ].join(" ")}
                >
                  <p
                    className={[
                      "truncate text-sm font-medium leading-snug",
                      isActive ? "text-indigo-700" : "text-slate-800",
                    ].join(" ")}
                  >
                    {s.topic}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatDate(s.created_at)} · {formatTime(s.created_at)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      );
    };

    return (
      <aside className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">History</h2>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-label="Refresh session history"
            className={[
              "rounded p-1 text-slate-400 transition-colors hover:text-slate-600",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              loading ? "animate-spin cursor-not-allowed" : "",
            ].join(" ")}
          >
            {/* Refresh icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M15.312 3.855a8 8 0 1 0 1.635 9.284.75.75 0 0 1 1.337.682 9.5 9.5 0 1 1-1.942-11.03l.536-.537A.75.75 0 0 1 18 2.75v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.53-1.281l.55-.55a8.01 8.01 0 0 0-1.048-.664.75.75 0 0 1 .59-1.37c.38.163.75.358 1.1.577l.9-.897Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {renderContent()}
        </div>
      </aside>
    );
  },
);

SessionHistory.displayName = "SessionHistory";

export default SessionHistory;
