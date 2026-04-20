import type { FC } from "react";

// ---------------------------------------------------------------------------
// Placeholder types
// ---------------------------------------------------------------------------
// TODO: Promote these to `src/api/types.ts` once the backend `ResearchResponse`
// starts returning a structured `research_gaps` field. For now this stays
// component-local so nothing downstream has to change when the API catches up.

/** Perceived importance of a gap — drives the accent color. */
export type GapImportance = "low" | "medium" | "high";

/** A single identified gap in the literature. */
export interface ResearchGap {
  id: string;
  /** One-line description of the gap, e.g. "No large-scale human study on X". */
  description: string;
  /** Optional longer rationale / evidence. */
  rationale?: string;
  /** Paper ids from the same response that informed this gap. */
  source_ids?: string[];
  importance?: GapImportance;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Loading-state logic:
// When `isLoading` is true the panel replaces both the structured-gaps list
// and the fallback-questions list with a fixed number of pulsing placeholder
// rows. The chrome (rounded card + heading) stays identical so the panel's
// size doesn't jitter between states.

/**
 * Props for {@link ResearchGapsPanel}.
 */
export interface ResearchGapsPanelProps {
  /**
   * Structured gaps once the backend exposes them. Until then, pass the
   * response's `open_questions` via {@link fallbackQuestions} instead.
   */
  gaps?: ResearchGap[];
  /**
   * Stringly-typed fallback: the current backend returns `open_questions:
   * string[]`. When `gaps` is empty/undefined, this list is rendered instead.
   */
  fallbackQuestions?: string[];
  /** When true, render skeleton rows. Wire to `useResearch().isLoading`. */
  isLoading?: boolean;
  /** How many skeleton rows to render. Defaults to 4. */
  skeletonCount?: number;
}

const importanceChip: Record<GapImportance, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-rose-100 text-rose-800",
};

/**
 * Renders the set of open questions / research gaps identified in a response.
 *
 * Accepts either the structured `gaps` array (preferred, once the backend
 * returns it) or a simple `fallbackQuestions: string[]` sourced from the
 * existing `open_questions` field.
 */
const ResearchGapsPanel: FC<ResearchGapsPanelProps> = ({
  gaps,
  fallbackQuestions = [],
  isLoading = false,
  skeletonCount = 4,
}) => {
  const hasStructured = Array.isArray(gaps) && gaps.length > 0;
  const hasFallback = fallbackQuestions.length > 0;
  const isEmpty = !hasStructured && !hasFallback;

  return (
    <section
      aria-label="Research gaps"
      aria-busy={isLoading || undefined}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Research gaps
        </h2>
      </header>

      {/* Announce loading state to screen readers via a live region. */}
      {isLoading && (
        <span role="status" aria-live="polite" className="sr-only">
          Loading research gaps…
        </span>
      )}

      {isLoading ? (
        <ResearchGapsPanelSkeleton count={skeletonCount} />
      ) : isEmpty ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No gaps identified for this topic yet.
        </p>
      ) : hasStructured ? (
        <ul className="flex flex-col gap-3">
          {gaps!.map((gap) => (
            <li
              key={gap.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">{gap.description}</p>
                {gap.importance ? (
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize " +
                      importanceChip[gap.importance]
                    }
                  >
                    {gap.importance}
                  </span>
                ) : null}
              </div>
              {gap.rationale ? (
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  {gap.rationale}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-slate-700">
          {fallbackQuestions.map((question, idx) => (
            <li key={`${idx}-${question.slice(0, 24)}`}>{question}</li>
          ))}
        </ul>
      )}
    </section>
  );
};

/**
 * Skeleton rows for the in-flight state. Each row mimics a structured gap
 * entry (description line + importance chip + rationale line) so that when
 * real data lands, the swap is visually stable.
 */
const ResearchGapsPanelSkeleton: FC<{ count: number }> = ({ count }) => (
  <ul className="flex flex-col gap-3" aria-hidden="true">
    {Array.from({ length: count }).map((_, idx) => (
      <li
        key={idx}
        className="animate-pulse rounded-xl border border-slate-200 bg-slate-50 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="h-4 w-3/5 rounded bg-slate-200" />
          <div className="h-4 w-14 shrink-0 rounded-full bg-slate-200" />
        </div>
        <div className="mt-2 h-3 w-11/12 rounded bg-slate-100" />
        <div className="mt-1 h-3 w-4/5 rounded bg-slate-100" />
      </li>
    ))}
  </ul>
);

export default ResearchGapsPanel;
