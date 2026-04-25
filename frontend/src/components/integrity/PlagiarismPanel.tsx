// PlagiarismPanel — displays plagiarism-risk analysis results.

import type { FC } from "react";
import type { PlagiarismRiskResult, RiskLevel } from "../../api/verifyTypes";
import ScoreGauge from "./ScoreGauge";

interface Props {
  result: PlagiarismRiskResult;
}

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  low:      { label: "Low Risk",      color: "text-green-700",  bg: "bg-green-50  border-green-200" },
  moderate: { label: "Moderate Risk", color: "text-amber-700",  bg: "bg-amber-50  border-amber-200" },
  high:     { label: "High Risk",     color: "text-red-700",    bg: "bg-red-50    border-red-200"   },
};

const SEVERITY_DOT: Record<string, string> = {
  low:    "bg-amber-300",
  medium: "bg-orange-400",
  high:   "bg-red-500",
};

const PlagiarismPanel: FC<Props> = ({ result }) => {
  const rcfg = RISK_CONFIG[result.risk_level];
  // Display as "safety" score: 100 - risk_score
  const safetyScore = 100 - result.risk_score;

  return (
    <div className="space-y-4">
      {/* Top row: gauge + verdict + explanation */}
      <div className="flex items-start gap-5">
        <ScoreGauge
          score={safetyScore}
          label="Originality"
          size={88}
        />
        <div className="flex-1 space-y-2">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm
              font-semibold ${rcfg.bg} ${rcfg.color}`}
          >
            {rcfg.label}
          </span>
          <p className="text-sm text-slate-600 leading-relaxed">{result.explanation}</p>
        </div>
      </div>

      {/* Issues */}
      {result.issues.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Issues Found
          </h4>
          <ul className="space-y-1">
            {result.issues.map((issue, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Flagged passages */}
      {result.flagged_passages.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Flagged Passages
          </h4>
          <div className="space-y-2">
            {result.flagged_passages.map((fp, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                  <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT[fp.severity] ?? "bg-slate-400"}`} />
                  {fp.severity.charAt(0).toUpperCase() + fp.severity.slice(1)} severity
                </span>
                <blockquote className="border-l-2 border-amber-300 pl-3 text-sm italic text-slate-700">
                  "{fp.text}"
                </blockquote>
                <p className="mt-1.5 text-xs text-slate-500">{fp.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-500 leading-relaxed">
        ⚠ {result.disclaimer}
      </p>
    </div>
  );
};

export default PlagiarismPanel;
