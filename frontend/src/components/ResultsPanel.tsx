// ResultsPanel — orchestrates the 8 analysis sections plus their loading,
// error, and empty states.
//
// Loading-state logic:
//   - Before first search: render a quiet "no research yet" placeholder.
//   - `isLoading`: forward the flag into every panel so they render their
//     `animate-pulse` skeleton variants. We also render the
//     <AnalysisProgress /> indicator which counts completed sections.
//   - `isError`: render a single error card with the API error message and
//     a Retry button. Retry calls `onRetry()` which re-triggers the last
//     query via `useResearch().research(...)` upstream.
//   - Success: render the real panels; AnalysisProgress stays mounted so
//     users can see all 8 sections are complete (100%).
//
// The `lastRequest` prop is what the retry button re-submits — the parent
// owns it so we don't lose the query if the component unmounts.

import type { FC } from "react";

import type {
  Paper,
  ResearchRequest,
  ResearchResponse,
} from "../api/types";
import type { ApiError } from "../api/client";

import AnalysisProgress from "./AnalysisProgress";
import ExportBar from "./ExportBar";
import LiteratureReview from "./LiteratureReview";
import PapersPanel from "./PapersPanel";
import TopResearchers from "./TopResearchers";
import MethodologyTable, {
  type MethodologyRow,
} from "./MethodologyTable";
import ResearchGapsPanel from "./ResearchGapsPanel";
import type { Researcher } from "./TopResearchers";

export interface ResultsPanelProps {
  /** Latest successful response (or partial data once streaming lands). */
  data: ResearchResponse | undefined;
  /** True while the research mutation is in flight. */
  isLoading: boolean;
  /** True when the mutation has errored. */
  isError: boolean;
  /** Normalized error from the API client, if any. */
  error: ApiError | null;
  /** The last request that was submitted — used by the Retry button. */
  lastRequest: ResearchRequest | null;
  /** Re-triggers the research mutation with `lastRequest`. */
  onRetry: (request: ResearchRequest) => void;
  /** Optional paper selection callback (synced with KnowledgeGraph). */
  onSelectPaper?: (paperId: string) => void;
  /** Currently selected paper id. */
  selectedPaperId?: string | null;
}

/**
 * Derive a lightweight `Researcher[]` from the papers in the response.
 * Aggregates by author name and sums citation counts. Good enough for the
 * leaderboard until the backend returns a dedicated `top_researchers` field.
 */
function deriveTopResearchers(papers: Paper[] | undefined): Researcher[] {
  if (!papers || papers.length === 0) return [];
  const byAuthor = new Map<
    string,
    { paper_count: number; citation_count: number }
  >();
  for (const paper of papers) {
    const cites = paper.citation_count ?? 0;
    for (const name of paper.authors ?? []) {
      const prev = byAuthor.get(name) ?? { paper_count: 0, citation_count: 0 };
      prev.paper_count += 1;
      prev.citation_count += cites;
      byAuthor.set(name, prev);
    }
  }
  return Array.from(byAuthor.entries())
    .map(([name, stats]) => ({
      id: name,
      name,
      affiliation: null,
      paper_count: stats.paper_count,
      citation_count: stats.citation_count || null,
      profile_url: null,
    }))
    .sort((a, b) => (b.citation_count ?? 0) - (a.citation_count ?? 0));
}

/** Derive methodology rows from the papers (heuristic placeholder). */
function deriveMethodologyRows(papers: Paper[] | undefined): MethodologyRow[] {
  if (!papers || papers.length === 0) return [];
  return papers.slice(0, 8).map((paper) => {
    const firstAuthor = paper.authors?.[0];
    const lastName = firstAuthor
      ? firstAuthor.split(" ").slice(-1)[0] ?? firstAuthor
      : null;
    const paper_label =
      lastName && paper.year
        ? `${lastName}, ${paper.year}`
        : paper.title.slice(0, 48);
    return {
      paper_id: paper.id,
      paper_label,
      study_type: paper.venue ?? "—",
      sample: null,
      approach: paper.abstract
        ? `${paper.abstract.slice(0, 80)}…`
        : "Methodology not extracted",
      outcome: paper.title,
    };
  });
}

const ResultsPanel: FC<ResultsPanelProps> = ({
  data,
  isLoading,
  isError,
  error,
  lastRequest,
  onRetry,
  onSelectPaper,
  selectedPaperId = null,
}) => {
  // Pre-first-search idle state.
  if (!isLoading && !isError && !data && !lastRequest) {
    return (
      <section
        aria-label="Results"
        className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Results
        </h2>
        <p className="max-w-sm text-sm text-slate-500">
          Enter a topic above and hit Research to see a synthesized literature
          review, key findings, and more.
        </p>
      </section>
    );
  }

  // Hard error state — render in place of the panels with a retry button.
  if (isError) {
    return (
      <section
        aria-label="Results"
        aria-live="polite"
        className="flex flex-col gap-3"
      >
        <AnalysisProgress data={data} isLoading={false} isError />
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-700">
                Research failed
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-rose-800">
                {error?.message ?? "Something went wrong. Please try again."}
              </p>
              {error?.status ? (
                <p className="mt-1 text-xs text-rose-600">
                  HTTP {error.status}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => lastRequest && onRetry(lastRequest)}
              disabled={!lastRequest}
              className="shrink-0 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Loading or success: render the 8 analysis sections, forwarding isLoading
  // so each panel renders its animate-pulse skeleton variant.
  const papers = data?.papers ?? [];
  const summary = data?.summary ?? "";
  const keyFindings = data?.key_findings ?? [];
  const openQuestions = data?.open_questions ?? [];
  const researchers = deriveTopResearchers(data?.papers);
  const methodologyRows = deriveMethodologyRows(data?.papers);

  return (
    <section
      aria-label="Results"
      aria-busy={isLoading || undefined}
      className="flex flex-col gap-4"
    >
      <AnalysisProgress data={data} isLoading={isLoading} />

      {data && (
        <ExportBar
          researchResponse={data}
          disabled={isLoading}
          onExport={() => {
            // Client-side formats (json / markdown / bibtex / pdf) are not yet
            // implemented — placeholder for future work.
          }}
        />
      )}

      <LiteratureReview
        isLoading={isLoading}
        summary={summary}
        keyFindings={keyFindings}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PapersPanel
          isLoading={isLoading}
          papers={papers}
          selectedPaperId={selectedPaperId}
          onSelect={onSelectPaper}
        />
        <TopResearchers isLoading={isLoading} researchers={researchers} limit={8} />
      </div>

      <MethodologyTable
        isLoading={isLoading}
        rows={methodologyRows}
        onSelectPaper={onSelectPaper}
      />

      <ResearchGapsPanel
        isLoading={isLoading}
        fallbackQuestions={openQuestions}
      />
    </section>
  );
};

export default ResultsPanel;
