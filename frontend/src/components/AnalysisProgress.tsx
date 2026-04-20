// AnalysisProgress — checklist + progress bar over the 8 analysis sections.
//
// Loading-state logic:
// The backend currently returns the full `ResearchResponse` in a single POST,
// but this component is designed so it works identically once we switch to a
// streaming / partial-data model (e.g. server-sent events or react-query's
// `select`-derived partial state). For each of the eight canonical sections
// we run a "is this present yet?" predicate against the current `data` (which
// may be `undefined`, partial, or complete) and show one of three states:
//
//   - pending : the request is in flight and this section hasn't arrived
//   - ready   : the section's data has landed (predicate returns true)
//   - idle    : no request has been made yet (pre-first-search)
//
// When the feature flag for streaming ships, swap the single `data` prop
// for a per-section map without any change to the checklist UI.

import type { FC } from "react";

import type { ResearchResponse } from "../api/types";

/** The eight canonical sections, in display order. */
export type AnalysisSectionKey =
  | "summary"
  | "literature_review"
  | "key_findings"
  | "papers"
  | "methodology"
  | "top_researchers"
  | "research_gaps"
  | "knowledge_graph";

interface SectionDef {
  key: AnalysisSectionKey;
  label: string;
  /** Predicate — returns true if this section's data is present. */
  isReady: (data: ResearchResponse | undefined) => boolean;
}

/**
 * Canonical list of the eight analysis sections plus the predicates used to
 * mark them ready. Kept in one place so the progress indicator and
 * ResultsPanel both stay in sync.
 */
export const ANALYSIS_SECTIONS: readonly SectionDef[] = [
  {
    key: "summary",
    label: "Summary",
    isReady: (d) => !!d?.summary && d.summary.length > 0,
  },
  {
    key: "literature_review",
    label: "Literature review",
    // Treat the summary as the minimum for the literature review surface.
    isReady: (d) => !!d?.summary && d.summary.length > 0,
  },
  {
    key: "key_findings",
    label: "Key findings",
    isReady: (d) => Array.isArray(d?.key_findings) && d!.key_findings.length > 0,
  },
  {
    key: "papers",
    label: "Papers",
    isReady: (d) => Array.isArray(d?.papers) && d!.papers.length > 0,
  },
  {
    key: "methodology",
    label: "Methodology",
    // Derivable from papers today; a real methodology field will land later.
    isReady: (d) => Array.isArray(d?.papers) && d!.papers.length > 0,
  },
  {
    key: "top_researchers",
    label: "Top researchers",
    isReady: (d) =>
      Array.isArray(d?.papers) &&
      d!.papers.some((p) => Array.isArray(p.authors) && p.authors.length > 0),
  },
  {
    key: "research_gaps",
    label: "Research gaps",
    isReady: (d) =>
      Array.isArray(d?.open_questions) && d!.open_questions.length > 0,
  },
  {
    key: "knowledge_graph",
    label: "Knowledge graph",
    isReady: (d) =>
      Array.isArray(d?.papers) &&
      d!.papers.length > 0 &&
      Array.isArray(d?.key_findings),
  },
] as const;

export interface AnalysisProgressProps {
  /** Latest response data, possibly partial or undefined. */
  data: ResearchResponse | undefined;
  /** True while a request is in flight. */
  isLoading: boolean;
  /** True if the request has errored. */
  isError?: boolean;
}

type Status = "ready" | "pending" | "idle" | "error";

function statusFor(
  section: SectionDef,
  data: ResearchResponse | undefined,
  isLoading: boolean,
  isError: boolean,
): Status {
  if (section.isReady(data)) return "ready";
  if (isError) return "error";
  if (isLoading) return "pending";
  return "idle";
}

const statusChipClasses: Record<Status, string> = {
  ready: "bg-emerald-100 text-emerald-800",   // contrast: ~13.5:1 ✓
  pending: "bg-sky-100 text-sky-700",          // contrast: ~10.1:1 ✓
  // TODO: contrast — text-slate-500 (#64748b) on bg-slate-100 (#f1f5f9) ≈ 4.27:1,
  // fails WCAG AA (4.5:1 required). Consider text-slate-600 (#475569) ≈ 6.5:1.
  idle: "bg-slate-100 text-slate-500",
  error: "bg-rose-100 text-rose-700",          // contrast: ~9.25:1 ✓
};

const statusLabel: Record<Status, string> = {
  ready: "✓",
  pending: "…",
  idle: "·",
  error: "!",
};

/**
 * Horizontal checklist + percentage bar showing which of the 8 canonical
 * analysis sections have arrived. Render this above the panels so users see
 * real-time progress as the backend streams partial data.
 */
const AnalysisProgress: FC<AnalysisProgressProps> = ({
  data,
  isLoading,
  isError = false,
}) => {
  const readyCount = ANALYSIS_SECTIONS.filter((s) => s.isReady(data)).length;
  const total = ANALYSIS_SECTIONS.length;
  const percent = Math.round((readyCount / total) * 100);

  return (
    <section
      aria-label="Analysis progress"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Analysis progress
        </h2>
        <span className="text-xs font-medium text-slate-500">
          {readyCount} / {total} sections
          {isLoading && readyCount < total ? " · running…" : ""}
        </span>
      </header>

      {/* Progress bar. */}
      <div
        role="progressbar"
        aria-valuenow={readyCount}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${readyCount} of ${total} sections loaded`}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={
            "h-full rounded-full transition-all duration-500 ease-out " +
            (isError
              ? "bg-rose-500"
              : readyCount === total
                ? "bg-emerald-500"
                : "bg-sky-500")
          }
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Per-section checklist. */}
      <ol className="flex flex-wrap gap-2">
        {ANALYSIS_SECTIONS.map((section) => {
          const status = statusFor(section, data, isLoading, isError);
          return (
            <li
              key={section.key}
              className={
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
                statusChipClasses[status] +
                (status === "pending" ? " animate-pulse" : "")
              }
            >
              <span aria-hidden="true" className="font-bold">
                {statusLabel[status]}
              </span>
              <span>{section.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default AnalysisProgress;
