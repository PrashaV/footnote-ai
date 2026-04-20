import type { FC } from "react";

import type { KeyFinding } from "../api/types";

// ---------------------------------------------------------------------------
// Placeholder types
// ---------------------------------------------------------------------------
// TODO: Move to `src/api/types.ts` once the backend returns a richer
// `literature_review` object (sectioned prose, themes, etc.).

/** A themed section of the synthesized review. */
export interface LiteratureReviewSection {
  id: string;
  heading: string;
  /** Markdown-free prose; rendered with whitespace preserved. */
  body: string;
  /** Paper ids referenced in this section. */
  source_ids?: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Loading-state logic:
// When `isLoading` is true, this component substitutes an `animate-pulse`
// placeholder for the summary / sections / key findings. That way the parent
// layout doesn't need separate fallback JSX — it can render <LiteratureReview
// isLoading /> the same way it renders the loaded variant, keeping spacing
// and card chrome stable across the transition from loading → data.

/**
 * Props for {@link LiteratureReview}.
 */
export interface LiteratureReviewProps {
  /** Top-level summary of the literature. Typically `ResearchResponse.summary`. */
  summary: string;
  /**
   * Optional themed sections. When omitted, the component falls back to
   * rendering `keyFindings` as an evidence list under the summary.
   */
  sections?: LiteratureReviewSection[];
  /**
   * Synthesized claims from the response. Used as the fallback view when
   * structured `sections` have not been computed yet.
   */
  keyFindings?: KeyFinding[];
  /**
   * When true, renders a pulsing skeleton in place of the real content. Wire
   * to `useResearch().isLoading` from the parent.
   */
  isLoading?: boolean;
}

const confidenceChip: Record<KeyFinding["confidence"], string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-sky-100 text-sky-800",
  high: "bg-emerald-100 text-emerald-800",
};

/**
 * Synthesized literature review: a prose summary plus either themed sections
 * or the list of key findings from the response. Read-only — no editing or
 * highlighting interactions live here yet.
 */
const LiteratureReview: FC<LiteratureReviewProps> = ({
  summary,
  sections,
  keyFindings = [],
  isLoading = false,
}) => {
  const hasSections = Array.isArray(sections) && sections.length > 0;

  if (isLoading) {
    return <LiteratureReviewSkeleton />;
  }

  return (
    <section
      aria-label="Literature review"
      className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5"
    >
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Literature review
        </h2>
      </header>

      <p className="whitespace-pre-line text-base leading-relaxed text-slate-800">
        {summary || "No summary available."}
      </p>

      {hasSections ? (
        <div className="flex flex-col gap-4">
          {sections!.map((section) => (
            <article key={section.id} className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-900">
                {section.heading}
              </h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {section.body}
              </p>
            </article>
          ))}
        </div>
      ) : keyFindings.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Key findings</h3>
          <ul className="flex flex-col gap-2">
            {keyFindings.map((finding, idx) => (
              <li
                key={`${idx}-${finding.claim.slice(0, 24)}`}
                className="rounded-xl border border-slate-100 bg-slate-50 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-900">
                    {finding.claim}
                  </p>
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize " +
                      confidenceChip[finding.confidence]
                    }
                  >
                    {finding.confidence}
                  </span>
                </div>
                {finding.evidence ? (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {finding.evidence}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

/**
 * Skeleton variant for in-flight requests. Renders the same chrome (rounded
 * card, header) so the swap-in is visually stable, with `animate-pulse`
 * placeholders for the summary paragraph and a couple of finding rows.
 */
const LiteratureReviewSkeleton: FC = () => (
  <section
    aria-label="Literature review loading"
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5"
  >
    <header>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Literature review
      </h2>
    </header>

    <div className="flex animate-pulse flex-col gap-2">
      <div className="h-4 w-full rounded bg-slate-200" />
      <div className="h-4 w-11/12 rounded bg-slate-200" />
      <div className="h-4 w-10/12 rounded bg-slate-200" />
      <div className="h-4 w-3/4 rounded bg-slate-200" />
    </div>

    <div className="flex flex-col gap-2">
      <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
      <div className="flex animate-pulse flex-col gap-2">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div
            key={idx}
            className="rounded-xl border border-slate-100 bg-slate-50 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="h-4 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="mt-2 h-3 w-11/12 rounded bg-slate-100" />
            <div className="mt-1 h-3 w-3/4 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default LiteratureReview;
