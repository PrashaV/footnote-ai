// CitationFlagsPanel — Phase 4.3
//
// Renders the list of flagged citations returned by the citation check engine
// (CrossRef + Semantic Scholar + DOAJ) below the Citations card in the
// IntegritySidebar.
//
// Each row shows:
//   • Severity badge — red for "high", amber for "medium", slate for "low"
//   • Issue-type label — plain English (not the snake_case machine key)
//   • Citation text (truncated)
//   • Detail — one sentence explaining the specific problem
//
// Data flows in from CheckResult.flagged_citations (set in integrityAnalyzeTypes.ts).

import { type FC, useState } from "react";
import type { FlaggedCitation } from "../../api/integrityAnalyzeTypes";

// ---------------------------------------------------------------------------
// Severity configuration
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  FlaggedCitation["severity"],
  { badge: string; dot: string; label: string }
> = {
  high:   { badge: "bg-red-100    text-red-700    ring-1 ring-red-200",   dot: "bg-red-500",    label: "High" },
  medium: { badge: "bg-amber-100  text-amber-700  ring-1 ring-amber-200", dot: "bg-amber-400",  label: "Medium" },
  low:    { badge: "bg-slate-100  text-slate-600  ring-1 ring-slate-200", dot: "bg-slate-400",  label: "Low" },
};

// ---------------------------------------------------------------------------
// Issue-type human labels
// ---------------------------------------------------------------------------

const ISSUE_LABELS: Record<FlaggedCitation["issue_type"], string> = {
  format_error:      "Format error",
  missing_field:     "Missing field",
  doi_not_found:     "DOI not found",
  title_mismatch:    "Title mismatch",
  author_mismatch:   "Author mismatch",
  retracted:         "Retracted paper",
  quote_mismatch:    "Quote mismatch",
  predatory_journal: "Unverified journal",
};

// Icon per issue type — small inline SVG for visual scannability
const ISSUE_ICON: Record<FlaggedCitation["issue_type"], JSX.Element> = {
  format_error: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
    </svg>
  ),
  missing_field: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
  ),
  doi_not_found: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  ),
  title_mismatch: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  ),
  author_mismatch: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0zM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  ),
  retracted: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  ),
  quote_mismatch: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  ),
  predatory_journal: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Single flagged-citation row
// ---------------------------------------------------------------------------

interface FlagRowProps {
  flag: FlaggedCitation;
  index: number;
}

const FlagRow: FC<FlagRowProps> = ({ flag, index }) => {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[flag.severity];
  const issueLabel = ISSUE_LABELS[flag.issue_type];
  const icon = ISSUE_ICON[flag.issue_type];

  const truncatedCitation =
    flag.citation_text.length > 80
      ? flag.citation_text.slice(0, 80) + "…"
      : flag.citation_text;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      {/* Collapsed header — click to expand */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-2.5 flex items-start gap-2 hover:bg-slate-50 transition-colors"
        aria-expanded={expanded}
      >
        {/* Issue number */}
        <span className="flex-shrink-0 text-[10px] font-mono text-slate-400 mt-0.5">
          #{index + 1}
        </span>

        {/* Severity dot */}
        <span
          className={`mt-1.5 flex-shrink-0 h-2 w-2 rounded-full ${sev.dot}`}
          aria-label={`${sev.label} severity`}
        />

        {/* Issue content */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-slate-700 line-clamp-1 leading-snug">
            {truncatedCitation}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-slate-400">{icon}</span>
            <p className="text-[10px] text-slate-400">{issueLabel}</p>
          </div>
        </div>

        {/* Severity badge */}
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sev.badge}`}
        >
          {sev.label}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 bg-slate-50">
          {/* Full citation text */}
          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 mb-2">
            <p className="text-[10px] font-semibold text-slate-400 mb-0.5">Citation</p>
            <p className="text-[11px] text-slate-700 leading-snug italic">
              {flag.citation_text}
            </p>
          </div>

          {/* Plain-English explanation */}
          <div
            className={`rounded-md border px-2.5 py-1.5 ${
              flag.severity === "high"
                ? "border-red-100 bg-red-50"
                : flag.severity === "medium"
                ? "border-amber-100 bg-amber-50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <p
              className={`text-[10px] font-semibold mb-0.5 ${
                flag.severity === "high"
                  ? "text-red-500"
                  : flag.severity === "medium"
                  ? "text-amber-600"
                  : "text-slate-500"
              }`}
            >
              {issueLabel}
            </p>
            <p className="text-[11px] text-slate-700 leading-snug">{flag.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CitationFlagsPanelProps {
  flags: FlaggedCitation[];
}

const CitationFlagsPanel: FC<CitationFlagsPanelProps> = ({ flags }) => {
  if (!flags || flags.length === 0) return null;

  const nHigh   = flags.filter((f) => f.severity === "high").length;
  const nMedium = flags.filter((f) => f.severity === "medium").length;
  const nLow    = flags.filter((f) => f.severity === "low").length;

  const breakdown: string[] = [];
  if (nHigh)   breakdown.push(`${nHigh} high`);
  if (nMedium) breakdown.push(`${nMedium} medium`);
  if (nLow)    breakdown.push(`${nLow} low`);

  return (
    <div className="border-t border-slate-100">
      {/* Section header */}
      <div
        className={`px-4 py-2 border-b ${
          nHigh > 0
            ? "bg-red-50 border-red-100"
            : nMedium > 0
            ? "bg-amber-50 border-amber-100"
            : "bg-slate-50 border-slate-100"
        }`}
      >
        <p
          className={`text-[10px] font-semibold uppercase tracking-wide ${
            nHigh > 0 ? "text-red-600" : nMedium > 0 ? "text-amber-600" : "text-slate-500"
          }`}
        >
          {flags.length} citation issue{flags.length !== 1 ? "s" : ""}
          {breakdown.length > 0 && (
            <span
              className={`ml-1 font-normal ${
                nHigh > 0 ? "text-red-400" : nMedium > 0 ? "text-amber-500" : "text-slate-400"
              }`}
            >
              ({breakdown.join(", ")})
            </span>
          )}
        </p>
      </div>

      {/* Flag rows — click to expand each */}
      {flags.map((flag, i) => (
        <FlagRow key={`${flag.citation_text.slice(0, 20)}-${flag.issue_type}-${i}`} flag={flag} index={i} />
      ))}

      {/* Footer note */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
        <p className="text-[10px] leading-snug text-slate-400">
          Checked via CrossRef, Semantic Scholar, and DOAJ.
          Click each row to see the full explanation.
        </p>
      </div>
    </div>
  );
};

export default CitationFlagsPanel;
