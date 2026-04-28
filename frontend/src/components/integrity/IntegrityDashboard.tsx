// IntegrityDashboard — top-level integrity report UI.
// Tabs: Overview | Citations | Claim Accuracy | AI Writing | Fixes

import { type FC, useState } from "react";
import type { IntegrityReport } from "../../api/verifyTypes";
import ScoreGauge from "./ScoreGauge";
import CitationResultsTable from "./CitationResultsTable";
import ClaimMatchPanel from "./ClaimMatchPanel";
import AIDetectionPanel from "./AIDetectionPanel";
import RecommendedFixesPanel from "./RecommendedFixesPanel";

interface Props {
  report: IntegrityReport;
  isLoading?: boolean;
}

type Tab = "overview" | "citations" | "claim_match" | "ai_writing" | "fixes";

const TAB_LABELS: Record<Tab, string> = {
  overview:    "Overview",
  citations:   "Citations",
  claim_match: "Claim Accuracy ✦",
  ai_writing:  "AI Writing",
  fixes:       "Fixes",
};

const LoadingSkeleton: FC = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-6 w-48 rounded bg-slate-200" />
    <div className="flex gap-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 w-24 rounded-full bg-slate-200" />
      ))}
    </div>
    <div className="h-40 rounded-xl bg-slate-200" />
    <div className="h-40 rounded-xl bg-slate-200" />
  </div>
);

const IntegrityDashboard: FC<Props> = ({ report, isLoading = false }) => {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <LoadingSkeleton />
      </div>
    );
  }

  const {
    scores,
    warnings,
    recommended_fixes,
    citation_check,
    claim_match,
    ai_writing,
    unsupported_claims,
    metadata,
  } = report;

  const overallColor =
    scores.overall >= 80 ? "text-green-600" :
    scores.overall >= 55 ? "text-amber-500" :
    "text-red-500";

  // Build available tabs based on what ran
  const availableTabs: Tab[] = ["overview"];
  if (citation_check) availableTabs.push("citations");
  if (claim_match) availableTabs.push("claim_match");
  if (ai_writing) availableTabs.push("ai_writing");
  availableTabs.push("fixes");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-slate-50 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Integrity Report</h2>
            {report.title && (
              <p className="mt-0.5 text-sm text-slate-500 italic">"{report.title}"</p>
            )}
            {metadata && (
              <p className="mt-1 text-xs text-slate-400">
                {metadata.word_count != null
                  ? `${metadata.word_count.toLocaleString()} words · `
                  : ""}
                {metadata.checks_performed.join(", ")}
                {metadata.latency_ms != null
                  ? ` · ${(metadata.latency_ms / 1000).toFixed(1)}s`
                  : ""}
              </p>
            )}
          </div>
          {/* Overall score */}
          <div className="flex flex-col items-center shrink-0">
            <span className={`text-4xl font-black ${overallColor}`}>
              {Math.round(scores.overall)}
            </span>
            <span className="text-xs font-medium text-slate-500">Overall</span>
          </div>
        </div>

        {/* Per-dimension gauges */}
        <div className="mt-4 flex flex-wrap gap-5">
          {citation_check && (
            <ScoreGauge score={scores.citation_integrity} label="Citations" size={80} />
          )}
          {claim_match && (
            <ScoreGauge score={scores.claim_accuracy} label="Claim accuracy" size={80} />
          )}
          {ai_writing && (
            <ScoreGauge score={scores.ai_originality} label="Human-written" size={80} />
          )}
        </div>
      </div>

      {/* ── Warnings banner ─────────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-6 py-3">
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                <span className="mt-0.5 shrink-0">⚠</span>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200">
        <nav className="flex overflow-x-auto">
          {availableTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 px-5 py-3 text-sm font-medium transition border-b-2 ${
                activeTab === tab
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {TAB_LABELS[tab]}
              {tab === "fixes" && recommended_fixes.length > 0 && (
                <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-600">
                  {recommended_fixes.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div className="px-6 py-5">

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-5">
            {/* Score breakdown bars */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Score Breakdown</h3>
              <div className="space-y-3">
                {[
                  { label: "Citation Integrity",  value: scores.citation_integrity,
                    note: "Real API lookups — Semantic Scholar, CrossRef, OpenAlex" },
                  { label: "Claim Accuracy",      value: scores.claim_accuracy,
                    note: "Draft claims vs. actual paper abstracts (unique to Footnote)" },
                  { label: "AI Originality",      value: scores.ai_originality,
                    note: "GPTZero trained classifier — perplexity + burstiness" },
                ].map(({ label, value, note }) => (
                  <div key={label}>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="w-36 text-xs font-medium text-slate-600">{label}</span>
                      <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            value >= 80 ? "bg-green-500" :
                            value >= 55 ? "bg-amber-400" :
                            "bg-red-500"
                          }`}
                          style={{ width: `${value}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs font-bold text-slate-700">
                        {Math.round(value)}
                      </span>
                    </div>
                    <p className="ml-36 text-xs text-slate-400">{note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Unsupported claims — labelled as editorial assist */}
            {unsupported_claims.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-slate-700">
                    Claims Needing Citations ({unsupported_claims.length})
                  </h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    AI editorial assist — review in context
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  These are factual claims Claude identified as likely needing a citation.
                  This is an editorial suggestion, not a definitive verdict.
                </p>
                <div className="space-y-2">
                  {unsupported_claims.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <p className="text-sm text-slate-700 italic">"{c.text}"</p>
                      <p className="mt-1 text-xs text-slate-500">{c.reason}</p>
                      {c.suggestion && (
                        <p className="mt-0.5 text-xs text-indigo-600">→ {c.suggestion}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No issues state */}
            {unsupported_claims.length === 0 && warnings.length === 0 && (
              <p className="text-sm text-green-600 font-medium">
                ✓ No major issues detected. Check the other tabs for detailed results.
              </p>
            )}

            {/* Honest note about what we don't do */}
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
              <p className="text-xs font-semibold text-blue-700 mb-1">
                What this tool checks (and what it doesn't)
              </p>
              <ul className="space-y-0.5 text-xs text-blue-600">
                <li>✓ Citation existence — verified against real scholarly databases</li>
                <li>✓ Claim accuracy — whether your claims match the papers you cite</li>
                <li>✓ AI writing likelihood — via GPTZero's trained classifier</li>
                <li>✗ Plagiarism string-matching — we don't have a document database.
                  Use <a href="https://www.turnitin.com" target="_blank" rel="noopener noreferrer"
                    className="underline">Turnitin</a> or{" "}
                  <a href="https://copyleaks.com" target="_blank" rel="noopener noreferrer"
                    className="underline">Copyleaks</a> for that.
                </li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === "citations" && citation_check && (
          <CitationResultsTable result={citation_check} />
        )}

        {activeTab === "claim_match" && claim_match && (
          <ClaimMatchPanel result={claim_match} />
        )}

        {activeTab === "ai_writing" && ai_writing && (
          <AIDetectionPanel result={ai_writing} />
        )}

        {activeTab === "fixes" && (
          <RecommendedFixesPanel fixes={recommended_fixes} />
        )}
      </div>
    </div>
  );
};

export default IntegrityDashboard;
