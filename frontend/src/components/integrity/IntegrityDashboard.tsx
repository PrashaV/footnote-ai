// IntegrityDashboard — the top-level integrity report UI.
// Shows the overall score, per-dimension gauges, warnings, and tabbed sections
// for citations, AI writing, plagiarism risk, and recommended fixes.

import { type FC, useState } from "react";
import type { IntegrityReport } from "../../api/verifyTypes";
import ScoreGauge from "./ScoreGauge";
import CitationResultsTable from "./CitationResultsTable";
import AIDetectionPanel from "./AIDetectionPanel";
import PlagiarismPanel from "./PlagiarismPanel";
import RecommendedFixesPanel from "./RecommendedFixesPanel";

interface Props {
  report: IntegrityReport;
  isLoading?: boolean;
}

type Tab = "overview" | "citations" | "ai_writing" | "plagiarism" | "fixes";

const TAB_LABELS: Record<Tab, string> = {
  overview:   "Overview",
  citations:  "Citations",
  ai_writing: "AI Writing",
  plagiarism: "Plagiarism Risk",
  fixes:      "Fixes",
};

// Skeleton shown while loading
const LoadingSkeleton: FC = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-6 w-48 rounded bg-slate-200" />
    <div className="flex gap-6">
      {[1, 2, 3, 4].map((i) => (
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

  const { scores, warnings, recommended_fixes, citation_check, ai_writing, plagiarism_risk, unsupported_claims, metadata } = report;

  // Overall score color
  const overallColor =
    scores.overall >= 80 ? "text-green-600" :
    scores.overall >= 55 ? "text-amber-500" :
    "text-red-500";

  // Available tabs based on what checks ran
  const availableTabs: Tab[] = ["overview", "fixes"];
  if (citation_check) availableTabs.splice(1, 0, "citations");
  if (ai_writing) availableTabs.splice(-1, 0, "ai_writing");
  if (plagiarism_risk) availableTabs.splice(-1, 0, "plagiarism");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-slate-50 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              Integrity Report
            </h2>
            {report.title && (
              <p className="mt-0.5 text-sm text-slate-500 italic">"{report.title}"</p>
            )}
            {metadata && (
              <p className="mt-1 text-xs text-slate-400">
                {metadata.word_count != null ? `${metadata.word_count.toLocaleString()} words · ` : ""}
                {metadata.checks_performed.join(", ")} ·{" "}
                {metadata.latency_ms != null ? `${(metadata.latency_ms / 1000).toFixed(1)}s` : ""}
              </p>
            )}
          </div>
          {/* Overall score */}
          <div className="flex flex-col items-center">
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
          {ai_writing && (
            <ScoreGauge score={scores.ai_originality} label="Originality" size={80} />
          )}
          {plagiarism_risk && (
            <ScoreGauge score={scores.plagiarism_risk} label="Low Risk" size={80} />
          )}
        </div>
      </div>

      {/* Warnings banner */}
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

      {/* Tabs */}
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

      {/* Tab content */}
      <div className="px-6 py-5">
        {activeTab === "overview" && (
          <div className="space-y-4">
            {/* Unsupported claims */}
            {unsupported_claims.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Unsupported Claims ({unsupported_claims.length})
                </h3>
                <div className="space-y-2">
                  {unsupported_claims.map((c, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
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

            {unsupported_claims.length === 0 && warnings.length === 0 && (
              <p className="text-sm text-green-600 font-medium">
                ✓ No critical issues detected in the overview. Check the other tabs for details.
              </p>
            )}

            {/* Quick summary of scores */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Score Breakdown</h3>
              <div className="space-y-2">
                {[
                  { label: "Citation Integrity", value: scores.citation_integrity },
                  { label: "AI Originality",     value: scores.ai_originality },
                  { label: "Plagiarism Safety",   value: scores.plagiarism_risk },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="w-36 text-xs text-slate-600">{label}</span>
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
                    <span className="w-8 text-right text-xs font-semibold text-slate-700">
                      {Math.round(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "citations" && citation_check && (
          <CitationResultsTable result={citation_check} />
        )}

        {activeTab === "ai_writing" && ai_writing && (
          <AIDetectionPanel result={ai_writing} />
        )}

        {activeTab === "plagiarism" && plagiarism_risk && (
          <PlagiarismPanel result={plagiarism_risk} />
        )}

        {activeTab === "fixes" && (
          <RecommendedFixesPanel fixes={recommended_fixes} />
        )}
      </div>
    </div>
  );
};

export default IntegrityDashboard;
