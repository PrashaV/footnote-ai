import type { FC } from "react";

// ---------------------------------------------------------------------------
// Placeholder types
// ---------------------------------------------------------------------------
// TODO: Move to `src/api/types.ts` once the backend returns a structured
// `top_researchers` array on `ResearchResponse`.

/** A single researcher entry — typically derived from paper authorship. */
export interface Researcher {
  id: string;
  name: string;
  /** Current / most-recent affiliation, when known. */
  affiliation: string | null;
  /** How many papers in this response they are credited on. */
  paper_count: number;
  /** Sum of citation_count across the papers they appear on, when available. */
  citation_count: number | null;
  /** Optional ORCID or profile URL for linking out. */
  profile_url: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Loading-state logic:
// `isLoading` swaps the populated <ol> for a fixed-height pulsing list of
// faux rows so the panel keeps its size during a useResearch mutation. The
// skeleton mirrors the real row layout (rank badge + name/affiliation + two
// metric chips) so the visual transition is smooth.

/**
 * Props for {@link TopResearchers}.
 */
export interface TopResearchersProps {
  /** Researchers to list, already ordered by the caller (usually by citations). */
  researchers: Researcher[];
  /** Optional cap on how many to show. Defaults to all. */
  limit?: number;
  /** When true, render a skeleton variant. Wire to `useResearch().isLoading`. */
  isLoading?: boolean;
  /** How many skeleton rows to show. Defaults to 5. */
  skeletonCount?: number;
}

/**
 * Leaderboard of the most-cited / most-prolific researchers in the current
 * response. Pure presentation — ordering and scoring happen upstream.
 */
const TopResearchers: FC<TopResearchersProps> = ({
  researchers,
  limit,
  isLoading = false,
  skeletonCount = 5,
}) => {
  const visible =
    typeof limit === "number" ? researchers.slice(0, limit) : researchers;

  return (
    <section
      aria-label="Top researchers"
      aria-busy={isLoading || undefined}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Top researchers
        </h2>
      </header>

      {/* Announce loading state to screen readers via a live region. */}
      {isLoading && (
        <span role="status" aria-live="polite" className="sr-only">
          Loading researchers…
        </span>
      )}

      {isLoading ? (
        <TopResearchersSkeleton count={skeletonCount} />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No researcher data available yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {visible.map((researcher, idx) => (
            <li
              key={researcher.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {researcher.profile_url ? (
                      <a
                        href={researcher.profile_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:underline"
                      >
                        {researcher.name}
                      </a>
                    ) : (
                      researcher.name
                    )}
                  </p>
                  {researcher.affiliation ? (
                    <p className="truncate text-xs text-slate-500">
                      {researcher.affiliation}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-white px-2 py-0.5">
                  {researcher.paper_count}{" "}
                  {researcher.paper_count === 1 ? "paper" : "papers"}
                </span>
                {typeof researcher.citation_count === "number" ? (
                  <span className="rounded-full bg-white px-2 py-0.5">
                    {researcher.citation_count.toLocaleString()} cites
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

/**
 * Skeleton rows for the in-flight state. The `animate-pulse` wrapper on each
 * `<li>` animates the grey placeholder blocks, matching the shape of the
 * real row (rank badge, name, affiliation, two metric chips).
 */
const TopResearchersSkeleton: FC<{ count: number }> = ({ count }) => (
  <ol className="flex flex-col gap-2" aria-hidden="true">
    {Array.from({ length: count }).map((_, idx) => (
      <li
        key={idx}
        className="flex animate-pulse items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-7 w-7 shrink-0 rounded-full bg-slate-200" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="h-3 w-40 rounded bg-slate-200" />
            <div className="h-2.5 w-28 rounded bg-slate-100" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="h-5 w-16 rounded-full bg-white" />
          <div className="h-5 w-20 rounded-full bg-white" />
        </div>
      </li>
    ))}
  </ol>
);

export default TopResearchers;
