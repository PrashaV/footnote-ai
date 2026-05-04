// CitationExtension — TipTap Extension that wires the @ trigger to a
// citation search popover.
//
// Flow:
//   1. User types "@" → Suggestion plugin activates.
//   2. As the user continues typing, `items()` fetches from the backend proxy
//      (POST /api/citations/search) with a 300 ms debounce, falling back to
//      direct Semantic Scholar if the backend is unreachable.
//   3. CitationList renders via ReactRenderer near the cursor.
//   4. On selection: insert "[Author et al., Year]" text, call `onSave` so
//      the parent can persist the full metadata to Supabase.
//
// Positioning: the rendered element is attached to document.body and
// absolutely positioned using the caret's bounding rect.

import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";

import { CitationList, buildCitationText, type CitationItem, type CitationListRef } from "./CitationList";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "http://localhost:8000";
const SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Citation search — tries backend first, falls back to Semantic Scholar
// ---------------------------------------------------------------------------

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingResolve: ((items: CitationItem[]) => void) | null = null;

async function fetchCitations(query: string): Promise<CitationItem[]> {
  if (!query || query.length < 2) return [];

  // ── Try backend proxy first ──────────────────────────────────────────────
  try {
    const token = await getJwtToken();
    const res = await fetch(`${API_BASE}/api/citations/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(6_000),
    });

    if (res.ok) {
      return (await res.json()) as CitationItem[];
    }
  } catch {
    // Backend unavailable — fall through to direct API
  }

  // ── Fallback: Semantic Scholar directly (CORS allowed on public API) ─────
  try {
    const params = new URLSearchParams({
      query,
      fields: "title,authors,year,externalIds",
      limit:  "5",
    });
    const res = await fetch(`${SCHOLAR_URL}?${params}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: CitationItem[] };
    return (json.data ?? []).map((raw: any) => ({
      paperId:     raw.paperId     ?? "",
      title:       raw.title       ?? "Untitled",
      authors:     (raw.authors ?? []).map((a: any) => a.name ?? ""),
      year:        raw.year        ?? null,
      doi:         raw.externalIds?.DOI ?? null,
      externalIds: raw.externalIds ?? {},
    }));
  } catch {
    return [];
  }
}

/** Debounced wrapper — prevents a request per keystroke. */
function debouncedFetch(query: string): Promise<CitationItem[]> {
  return new Promise((resolve) => {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    if (_pendingResolve) _pendingResolve([]);
    _pendingResolve = resolve;
    _debounceTimer = setTimeout(async () => {
      const results = await fetchCitations(query);
      resolve(results);
      _pendingResolve = null;
    }, DEBOUNCE_MS);
  });
}

// ---------------------------------------------------------------------------
// JWT helper — reads from the Supabase client session
// ---------------------------------------------------------------------------

async function getJwtToken(): Promise<string | null> {
  try {
    // Dynamically import to avoid circular deps
    const { getSupabaseClient } = await import("../../contexts/AuthContext");
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extension options
// ---------------------------------------------------------------------------

export interface CitationExtensionOptions {
  /**
   * Called after the user selects a citation. Use this to persist the full
   * metadata to Supabase.
   */
  onSave: (item: CitationItem, insertedText: string) => void;
}

// ---------------------------------------------------------------------------
// Suggestion render — mounts CitationList via ReactRenderer
// ---------------------------------------------------------------------------

function buildSuggestionRender() {
  return (): ReturnType<NonNullable<SuggestionOptions["render"]>> => {
    let renderer: ReactRenderer<CitationListRef> | null = null;
    let container: HTMLDivElement | null = null;

    const cleanup = () => {
      renderer?.destroy();
      container?.remove();
      renderer = null;
      container = null;
    };

    const position = (clientRect: (() => DOMRect | null) | null | undefined) => {
      if (!container || !clientRect) return;
      const rect = clientRect();
      if (!rect) return;
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      container.style.top  = `${rect.bottom + scrollY + 6}px`;
      container.style.left = `${rect.left   + scrollX}px`;
    };

    return {
      onStart(props) {
        container = document.createElement("div");
        container.style.cssText = "position:absolute;z-index:9999;";
        document.body.appendChild(container);

        renderer = new ReactRenderer(CitationList, {
          props,
          editor: props.editor,
        });

        container.appendChild(renderer.element);
        position(props.clientRect);
      },

      onUpdate(props) {
        renderer?.updateProps(props);
        position(props.clientRect);
      },

      onKeyDown(props) {
        if (props.event.key === "Escape") {
          cleanup();
          return true;
        }
        return renderer?.ref?.onKeyDown(props) ?? false;
      },

      onExit() {
        cleanup();
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const CitationExtension = (options: CitationExtensionOptions) =>
  Extension.create<CitationExtensionOptions>({
    name: "citation",

    addOptions() {
      return options;
    },

    addProseMirrorPlugins() {
      const ext = this;

      return [
        Suggestion({
          editor: this.editor,

          // Trigger character
          char: "@",

          // Allow typing partial author/title queries after @
          allowSpaces: true,

          // Fetch results (debounced)
          items: async ({ query }) => debouncedFetch(query),

          // Render the popover
          render: buildSuggestionRender(),

          // Insert citation text + call onSave
          command: ({ editor, range, props }) => {
            const item = props as CitationItem;
            const label = buildCitationText(item);

            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent(`${label} `)
              .run();

            // Notify parent to persist to Supabase
            ext.options.onSave(item, label);
          },
        }),
      ];
    },
  });
