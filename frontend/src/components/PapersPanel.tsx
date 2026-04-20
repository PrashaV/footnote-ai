import type { FC } from "react";

import type { Paper } from "../api/types";
import PaperCard from "./PaperCard";

// Loading-state logic:
// When `isLoading` is true (typically wired to `useResearch().isLoading`) the
// panel renders a fixed number of Tailwind `animate-pulse` placeholder cards
// in place of the real list. This keeps the layout from collapsing between
// the empty-state and the populated state, preventing layout shift while
// react-query is in flight. The skeleton is an internal subcomponent so the
// public prop surface stays minimal: callers only need to pass `isLoading`.

/**
 * Props for {@link PapersPanel}.
 */
export interface PapersPanelProps {
  /** Papers to list. Can be empty — renders an empty-state placeholder. */
  papers: Paper[];
  /** The id of the currently selected paper, if any. */
  selectedPaperId?: string | null;
  /** Fired when the user picks a paper (clicks a card). */
  onSelect?: (paperId: string) => void;
  /**
   * Optional heading override. Defaults to "Papers". Useful when embedding
   * this panel inside another section that owns the heading hierarchy.
   */
  heading?: string;
  /**
   * When true, render a skeleton-loader variant in place of the list.
   * Wire this to `useResearch().isLoading` from the parent.
   */
  isLoading?: boolean;
  /** How many skeleton cards to render while loading. Defaults to 4. */
  skeletonCount?: number;
}

/**
 * Scrollable list of papers returned by the research response. Renders an
 * empty-state when `papers` is empty so the surrounding layout does not
 * collapse. When `isLoading` is true, renders a skeleton variant instead.
 */
const PapersPanel: FC<PapersPanelProps> = ({
  papers,
  selectedPaperId = null,
  onSelect,
  heading = "Papers",
  isLoading = false,
  skeletonCount = 4,
}) => {
  return (
    <section
      aria-label={heading}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {heading}
        </h2>
        <span className="text-xs text-slate-400">
          {isLoading
            ? "Loading…"
            : `${papers.length} ${papers.length === 1 ? "result" : "results"}`}
        </span>
      </header>

      {/* Announce loading state to screen readers via a live region. */}
      {isLoading && (
        <span role="status" aria-live="polite" className="sr-only">
          Loading papers…
        </span>
      )}

      {isLoading ? (
        <PapersPanelSkeleton count={skeletonCount} />
      ) : papers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No papers to show yet. Run a search to populate this panel.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {papers.map((paper) => (
            <li key={paper.id}>
              <PaperCard
                paper={paper}
                onSelect={onSelect}
                isSelected={selectedPaperId === paper.id}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/**
 * Skeleton variant rendered while `useResearch` is loading. Uses Tailwind's
 * `animate-pulse` utility to signal in-flight state without any extra CSS.
 * The shapes mirror a {@link PaperCard} (title line, author line, meta line,
 * abstract lines) so the handoff from skeleton → real content is visually
 * stable and doesn't cause layout shift.
 */
const PapersPanelSkeleton: FC<{ count: number }> = ({ count }) => (
  <ul className="flex flex-col gap-3" aria-hidden="true">
    {Array.from({ length: count }).map((_, idx) => (
      <li
        key={idx}
        className="flex animate-pulse flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="h-4 w-3/5 rounded bg-slate-200" />
          <div className="h-4 w-14 rounded-full bg-slate-200" />
        </div>
        <div className="h-3 w-2/5 rounded bg-slate-200" />
        <div className="h-3 w-1/3 rounded bg-slate-100" />
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="h-3 w-full rounded bg-slate-100" />
          <div className="h-3 w-11/12 rounded bg-slate-100" />
          <div className="h-3 w-4/5 rounded bg-slate-100" />
        </div>
      </li>
    ))}
  </ul>
);

export default PapersPanel;
