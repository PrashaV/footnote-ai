// IntegritySidebar — right-panel view of the four integrity check results.
//
// Rendered inside the SourcesSidebar panel when the "Integrity" tab is active.
// Shows a card per engine with a pass/warn/fail badge, score bar, confidence,
// and summary text.
//
// Phase 4.2: AI Detection card — green/yellow/red based on AI-likelihood.
// Phase 4.4: Plagiarism card — expands to show PlagiarismPanel match list.

import { type FC } from "react";
import type { CheckResult, IntegrityAnalyzeResponse } from "../../api/integrityAnalyzeTypes";
import { scoreToBadge, type IntegrityBadge } from "../../api/integrityAnalyzeTypes";
import PlagiarismPanel from "./PlagiarismPanel";

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

const BADGE_STYLES: Record<IntegrityBadge, string> = {
  pass: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  warn: "bg-amber-100  text-amber-700  ring-1 ring-amber-200",
  fail: "bg-red-100    text-red-700    ring-1 ring-red-200",
};

const BADGE_LABELS: Record<IntegrityBadge, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
};

// AI detection uses different thresholds: high score = BAD (more AI)
function aiScoreToBadge(score: number): IntegrityBadge {
  if (score < 0.30) return "pass"; // green — likely human
  if (score < 0.60) return "warn"; // yellow — uncertain
  return "fail";                   // red — likely AI
}

// Score bar fill colours
const BAR_COLORS: Record<IntegrityBadge, string> = {
  pass: "bg-emerald-400",
  warn: "bg-amber-400",
  fail: "bg-red-400",
};

// ---------------------------------------------------------------------------
// Engine metadata
// ---------------------------------------------------------------------------

interface EngineConfig {
  key: keyof Omit<IntegrityAnalyzeResponse, "document_id">;
  label: string;
  /** When true: high score = bad (AI detection). Badge + colour logic inverted. */
  invertedScore?: boolean;
  /** Label shown next to the numeric score */
  scoreLabel: (pct: number) => string;
  icon: React.ReactNode;
}

const ENGINE_CONFIGS: EngineConfig[] = [
  {
    key: "ai_detection",
    label: "AI Detection",
    invertedScore: true,
    scoreLabel: (pct) => `${pct}% AI likelihood`,
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.699-1.388 2.42l-1.918-.382m-14.49.382l-1.918.382c-1.419.279-2.388-1.42-1.388-2.42L5 14.5" />
      </svg>
    ),
  },
  {
    key: "citation_check",
    label: "Citations",
    scoreLabel: (pct) => `${pct}% verified`,
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    key: "plagiarism_check",
    label: "Plagiarism",
    scoreLabel: (pct) => `${pct}% original`,
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
      </svg>
    ),
  },
  {
    key: "claim_match",
    label: "Claim Match",
    scoreLabel: (pct) => `${pct}% supported`,
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Engine card
// ---------------------------------------------------------------------------

interface EngineCardProps {
  config: EngineConfig;
  result: CheckResult;
  /** When true, renders PlagiarismPanel below the standard card summary. */
  showPlagiarismMatches?: boolean;
}

const EngineCard: FC<EngineCardProps> = ({ config, result, showPlagiarismMatches }) => {
  const badge = config.invertedScore
    ? aiScoreToBadge(result.score)
    : scoreToBadge(result.score, result.flagged);

  const pct = Math.round(result.score * 100);
  const confPct = Math.round(result.confidence * 100);

  // For AI detection: bar fills proportionally to AI-likelihood (high = alarming)
  // For others: bar fills proportionally to quality score (high = good)
  const barFillPct = pct;

  return (
    <div className="px-4 py-3.5 border-b border-slate-100 last:border-b-0">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0 text-slate-400">{config.icon}</span>
          <span className="text-xs font-semibold text-slate-700 truncate">{config.label}</span>
        </div>
        <span
          className={`
            flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold
            uppercase tracking-wide ${BADGE_STYLES[badge]}
          `}
        >
          {BADGE_LABELS[badge]}
        </span>
      </div>

      {/* Score bar + confidence */}
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-slate-400">Score</span>
            <span className="text-[10px] font-medium text-slate-600">
              {config.scoreLabel(pct)}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${BAR_COLORS[badge]}`}
              style={{ width: `${barFillPct}%` }}
            />
          </div>
        </div>

        <div className="flex-shrink-0 text-right">
          <span className="text-[10px] text-slate-400">Confidence</span>
          <p className="text-[11px] font-medium text-slate-500">{confPct}%</p>
        </div>
      </div>

      {/* Summary */}
      <p className="mt-2 text-xs leading-snug text-slate-500">{result.summary}</p>

      {/* Method tag (Phase 4.2+) */}
      {result.method && result.method !== "none" && (
        <p className="mt-1 text-[10px] font-mono text-slate-400">
          method: {result.method}
        </p>
      )}

      {/* Flagged section count */}
      {result.flagged_sections.length > 0 && (
        <p className="mt-1.5 text-[11px] font-medium text-amber-600">
          {result.flagged_sections.length} section
          {result.flagged_sections.length !== 1 ? "s" : ""} highlighted in editor
        </p>
      )}

      {/* Plagiarism matches (Phase 4.4) — rendered inline below the card */}
      {showPlagiarismMatches && result.plagiarism_matches && result.plagiarism_matches.length > 0 && (
        <div className="-mx-4 mt-2">
          <PlagiarismPanel matches={result.plagiarism_matches} />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const LoadingSkeleton: FC = () => (
  <div>
    {ENGINE_CONFIGS.map((c) => (
      <div key={c.key} className="px-4 py-3.5 border-b border-slate-100 last:border-b-0">
        <div className="flex items-center justify-between gap-2 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-slate-200" />
            <div className="h-3 w-20 rounded bg-slate-200" />
          </div>
          <div className="h-5 w-12 rounded-full bg-slate-200" />
        </div>
        <div className="mt-2 space-y-1.5 animate-pulse">
          <div className="h-1.5 w-full rounded-full bg-slate-100" />
          <div className="h-2.5 w-3/4 rounded bg-slate-100" />
          <div className="h-2.5 w-full rounded bg-slate-100" />
        </div>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Empty / error state
// ---------------------------------------------------------------------------

const EmptyState: FC<{ error?: string | null }> = ({ error }) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-full ${
        error ? "bg-red-50" : "bg-indigo-50"
      }`}
    >
      {error ? (
        <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      ) : (
        <svg className="h-5 w-5 text-indigo-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
    </div>
    <div className="space-y-1">
      {error ? (
        <>
          <p className="text-xs font-medium text-red-600">Check failed</p>
          <p className="text-xs leading-relaxed text-slate-400">{error}</p>
        </>
      ) : (
        <>
          <p className="text-xs font-medium text-slate-600">No results yet</p>
          <p className="text-xs leading-relaxed text-slate-400">
            Click{" "}
            <span className="font-semibold text-indigo-500">Run Integrity Check</span>{" "}
            in the toolbar to analyse this document.
          </p>
        </>
      )}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface IntegritySidebarProps {
  results: IntegrityAnalyzeResponse | null;
  isLoading?: boolean;
  error?: string | null;
}

const IntegritySidebar: FC<IntegritySidebarProps> = ({
  results,
  isLoading = false,
  error = null,
}) => {
  if (isLoading) {
    return (
      <div>
        <div className="px-4 py-2.5 border-b border-slate-100">
          <p className="text-[11px] text-slate-400 font-medium animate-pulse">
            Running 4 checks in parallel…
          </p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (!results) {
    return <EmptyState error={error} />;
  }

  const allResults = [
    results.ai_detection,
    results.citation_check,
    results.plagiarism_check,
    results.claim_match,
  ];
  const flaggedCount = allResults.filter((r) => r.flagged).length;

  return (
    <div>
      {/* Overall status row */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
        <p className="text-[11px] text-slate-500">
          {flaggedCount === 0
            ? "No issues flagged across all four checks."
            : `${flaggedCount} check${flaggedCount !== 1 ? "s" : ""} flagged — review below.`}
        </p>
      </div>

      {/* Per-engine cards */}
      {ENGINE_CONFIGS.map((config) => (
        <EngineCard
          key={config.key}
          config={config}
          result={results[config.key]}
          showPlagiarismMatches={config.key === "plagiarism_check"}
        />
      ))}
    </div>
  );
};

export default IntegritySidebar;
