import type { FC } from "react";

// ---------------------------------------------------------------------------
// Placeholder types
// ---------------------------------------------------------------------------
// TODO: Move to `src/api/types.ts` once the backend returns a structured
// `methodology` array on `ResearchResponse`.

/** A single row in the methodology comparison table. */
export interface MethodologyRow {
  /** Paper id from the same response — used to link rows to cards. */
  paper_id: string;
  /** Short paper label (e.g. "Smith et al., 2023"). */
  paper_label: string;
  /** Study type, e.g. "RCT", "meta-analysis", "case study". */
  study_type: string;
  /** Sample size description, e.g. "n=412 adults". */
  sample: string | null;
  /** One-line summary of the intervention / approach. */
  approach: string;
  /** One-line summary of the headline finding. */
  outcome: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Loading-state logic:
// While `isLoading` is true the component renders a fixed-height skeleton
// table whose rows pulse with Tailwind's `animate-pulse`. This is rendered
// instead of either the empty-state or the real `<table>`, so the panel
// never collapses or shifts the surrounding layout while useResearch is in
// flight.

/**
 * Props for {@link MethodologyTable}.
 */
export interface MethodologyTableProps {
  /** Rows to render. May be empty. */
  rows: MethodologyRow[];
  /** Optional callback when the user clicks the paper cell. */
  onSelectPaper?: (paperId: string) => void;
  /** When true, render skeleton rows. Wire to `useResearch().isLoading`. */
  isLoading?: boolean;
  /** How many skeleton rows to render. Defaults to 4. */
  skeletonCount?: number;
}

/**
 * Comparison table of methodology across the papers in a research response.
 *
 * Stays presentational: no sorting/filtering state is tracked here yet; the
 * caller is expected to hand in rows in the order they should be displayed.
 */
const MethodologyTable: FC<MethodologyTableProps> = ({
  rows,
  onSelectPaper,
  isLoading = false,
  skeletonCount = 4,
}) => {
  if (isLoading) {
    return <MethodologyTableSkeleton count={skeletonCount} />;
  }

  if (rows.length === 0) {
    return (
      <section
        aria-label="Methodology comparison"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Methodology
        </h2>
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No methodology rows available for this topic.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Methodology comparison"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Methodology
        </h2>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th scope="col" className="py-2 pr-4 font-medium">Paper</th>
              <th scope="col" className="py-2 pr-4 font-medium">Study type</th>
              <th scope="col" className="py-2 pr-4 font-medium">Sample</th>
              <th scope="col" className="py-2 pr-4 font-medium">Approach</th>
              <th scope="col" className="py-2 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.paper_id}
                className="border-b border-slate-100 align-top last:border-0"
              >
                <td className="py-3 pr-4 font-medium text-slate-900">
                  {onSelectPaper ? (
                    <button
                      type="button"
                      onClick={() => onSelectPaper(row.paper_id)}
                      className="text-left text-slate-900 hover:underline"
                    >
                      {row.paper_label}
                    </button>
                  ) : (
                    row.paper_label
                  )}
                </td>
                <td className="py-3 pr-4 text-slate-700">{row.study_type}</td>
                <td className="py-3 pr-4 text-slate-700">{row.sample ?? "—"}</td>
                <td className="py-3 pr-4 text-slate-700">{row.approach}</td>
                <td className="py-3 text-slate-700">{row.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

/**
 * Skeleton variant shown while the research request is pending. Renders the
 * same card chrome plus a tabular grid of pulsing placeholder cells.
 */
const MethodologyTableSkeleton: FC<{ count: number }> = ({ count }) => (
  <section
    aria-label="Methodology comparison loading"
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4"
  >
    <header>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Methodology
      </h2>
    </header>

    <div className="overflow-x-auto">
      <div className="w-full min-w-[640px] animate-pulse">
        {/* Header row */}
        <div className="grid grid-cols-5 gap-4 border-b border-slate-200 pb-2">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="h-3 w-20 rounded bg-slate-200" />
          ))}
        </div>
        {/* Body rows */}
        {Array.from({ length: count }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="grid grid-cols-5 gap-4 border-b border-slate-100 py-3 last:border-0"
          >
            <div className="h-4 w-3/4 rounded bg-slate-200" />
            <div className="h-4 w-2/3 rounded bg-slate-100" />
            <div className="h-4 w-1/2 rounded bg-slate-100" />
            <div className="h-4 w-4/5 rounded bg-slate-100" />
            <div className="h-4 w-3/5 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default MethodologyTable;
