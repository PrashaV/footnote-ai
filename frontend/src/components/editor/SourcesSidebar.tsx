// SourcesSidebar — collapsible 280 px right panel showing live citations.
//
// Phase 3.2: now accepts a `citations` prop and renders the full list of
// sources added via @ autocomplete. Each entry shows title, author + et al.,
// year, and a DOI link if available.
//
// Phase 4.1: now also hosts an "Integrity" tab. When `activeTab === "integrity"`,
// the panel renders whatever `integrityContent` slot is passed in, rather than
// the citations list. Tab switching is controlled by the parent (WorkspacePage).

import { type FC } from "react";
import type { CitationRow } from "../../services/supabase";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SidebarTab = "sources" | "integrity";

interface SourcesSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  citations: CitationRow[];
  isLoading?: boolean;
  /** Which tab is currently active. Defaults to "sources". */
  activeTab?: SidebarTab;
  /** Called when the user clicks a tab button. */
  onTabChange?: (tab: SidebarTab) => void;
  /** Content rendered in the panel when activeTab === "integrity". */
  integrityContent?: React.ReactNode;
  /** Show a dot on the Integrity tab when results are available. */
  integrityHasResults?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAuthors(authors: string[]): string {
  if (!authors || authors.length === 0) return "Unknown";
  const parts = authors[0].split(" ");
  const lastName = parts[parts.length - 1] ?? authors[0];
  return authors.length > 1 ? `${lastName} et al.` : lastName;
}

// ---------------------------------------------------------------------------
// Citation card
// ---------------------------------------------------------------------------

const CitationCard: FC<{ citation: CitationRow; index: number }> = ({ citation, index }) => {
  const authorStr = formatAuthors(citation.authors);
  const doiUrl    = citation.doi ? `https://doi.org/${citation.doi}` : null;

  return (
    <div className="px-4 py-3 border-b border-slate-100 last:border-b-0 group">
      {/* Index badge + inserted text */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 flex h-4 w-4 items-center justify-center
          rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-600">
          {index + 1}
        </span>
        <span className="text-[11px] font-mono text-indigo-600 font-medium">
          {citation.inserted_text}
        </span>
      </div>

      {/* Title */}
      <p className="mt-1.5 text-xs font-medium text-slate-700 leading-snug line-clamp-2">
        {citation.title}
      </p>

      {/* Author · Year */}
      <p className="mt-0.5 text-xs text-slate-400">
        {authorStr}
        {citation.year ? ` · ${citation.year}` : ""}
      </p>

      {/* DOI link */}
      {doiUrl && (
        <a
          href={doiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[11px] text-indigo-400 hover:text-indigo-600
            hover:underline transition-colors"
        >
          View paper ↗
        </a>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SourcesSidebar: FC<SourcesSidebarProps> = ({
  isOpen,
  onToggle,
  citations,
  isLoading = false,
  activeTab = "sources",
  onTabChange,
  integrityContent,
  integrityHasResults = false,
}) => {
  return (
    <div className="relative flex flex-shrink-0" style={{ height: "100%" }}>

      {/* ── Toggle strip ──────────────────────────────────────────────── */}
      <button
        onClick={onToggle}
        aria-label={isOpen ? "Collapse sources panel" : "Expand sources panel"}
        title={isOpen ? "Collapse sources" : "Expand sources"}
        className="
          flex w-5 flex-shrink-0 items-center justify-center
          border-l border-slate-200 bg-white text-slate-400
          transition-colors hover:bg-slate-50 hover:text-slate-600
          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
        "
      >
        <svg
          className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* ── Sliding panel ─────────────────────────────────────────────── */}
      <div
        className="overflow-hidden transition-[width] duration-300 ease-in-out"
        style={{ width: isOpen ? "280px" : "0px" }}
        aria-hidden={!isOpen}
      >
        <div className="flex h-full w-[280px] flex-col border-l border-slate-200 bg-white">

          {/* Tab bar */}
          <div className="flex flex-shrink-0 border-b border-slate-200">
            {/* Sources tab */}
            <button
              onClick={() => onTabChange?.("sources")}
              aria-selected={activeTab === "sources"}
              className={`
                flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold
                border-b-2 transition-colors focus:outline-none focus-visible:ring-2
                focus-visible:ring-inset focus-visible:ring-indigo-500
                ${activeTab === "sources"
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300"
                }
              `}
            >
              Sources
              <span className={`
                rounded-full px-1.5 py-0.5 text-[10px] font-bold
                ${activeTab === "sources" ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400"}
              `}>
                {citations.length}
              </span>
            </button>

            {/* Integrity tab */}
            <button
              onClick={() => onTabChange?.("integrity")}
              aria-selected={activeTab === "integrity"}
              className={`
                relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold
                border-b-2 transition-colors focus:outline-none focus-visible:ring-2
                focus-visible:ring-inset focus-visible:ring-indigo-500
                ${activeTab === "integrity"
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300"
                }
              `}
            >
              Integrity
              {integrityHasResults && activeTab !== "integrity" && (
                <span className="absolute right-3 top-2 h-1.5 w-1.5 rounded-full bg-indigo-500" aria-label="Results available" />
              )}
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "integrity" ? (
              /* Integrity tab content — provided by parent */
              integrityContent ?? null
            ) : isLoading ? (
              /* Loading skeleton */
              <div className="space-y-3 p-4">
                {[1, 2].map((i) => (
                  <div key={i} className="animate-pulse space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-slate-200" />
                    <div className="h-2.5 w-full rounded bg-slate-100" />
                    <div className="h-2.5 w-1/2 rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : citations.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center
                gap-3 px-6 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center
                  rounded-full bg-indigo-50">
                  <svg
                    className="h-5 w-5 text-indigo-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3
                         6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13
                         C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13
                         C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-600">No sources yet</p>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Type <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-500">@</kbd> in the editor to search and add citations.
                  </p>
                </div>
              </div>
            ) : (
              /* Citations list */
              <div>
                {citations.map((citation, index) => (
                  <CitationCard
                    key={citation.id}
                    citation={citation}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer hint when citations exist (sources tab only) */}
          {activeTab === "sources" && citations.length > 0 && (
            <div className="flex-shrink-0 border-t border-slate-100 px-4 py-2">
              <p className="text-[11px] text-slate-400">
                Type <kbd className="rounded bg-slate-100 px-1 font-mono text-slate-400">@</kbd> to add more
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SourcesSidebar;
