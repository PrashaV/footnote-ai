// ClaimMatchPanel — shows claim-to-citation matching results.
// This is Footnote's unique feature: checking whether draft claims
// accurately reflect what the cited papers actually say.

import type { FC } from "react";
import type { ClaimMatchResult, ClaimVerdict } from "../../api/verifyTypes";
import ScoreGauge from "./ScoreGauge";

interface Props {
  result: ClaimMatchResult;
}

const VERDICT_CONFIG: Record<ClaimVerdict, {
  label: string;
  dot: string;
  badge: string;
  icon: string;
}> = {
  supported:     { label: "Supported",     dot: "bg-green-500",  badge: "bg-green-50  text-green-700  border-green-200",  icon: "✓" },
  overstated:    { label: "Overstated",    dot: "bg-amber-400",  badge: "bg-amber-50  text-amber-700  border-amber-200",  icon: "⚠" },
  contradicted:  { label: "Contradicted",  dot: "bg-red-500",    badge: "bg-red-50    text-red-700    border-red-200",    icon: "✗" },
  unverifiable:  { label: "Unverifiable",  dot: "bg-slate-400",  badge: "bg-slate-50  text-slate-600  border-slate-200",  icon: "?" },
};

const ClaimMatchPanel: FC<Props> = ({ result }) => {
  if (result.total_checked === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500 italic">
          No claim-citation pairs could be checked. This happens when no
          references were verified or no paper abstracts were available.
        </p>
        <p className="text-xs text-slate-400">
          Tip: make sure your draft includes full references with author names
          and years so we can match them to real papers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-start gap-5">
        <ScoreGauge score={result.score} label="Claim accuracy" size={88} />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-slate-600 leading-relaxed">
            Checked <strong>{result.total_checked}</strong> claim-citation pair(s)
            by comparing what the draft says against each paper's actual abstract.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {(
              [
                { key: "supported",    count: result.supported_count },
                { key: "overstated",   count: result.overstated_count },
                { key: "contradicted", count: result.contradicted_count },
                { key: "unverifiable", count: result.unverifiable_count },
              ] as const
            )
              .filter((s) => s.count > 0)
              .map(({ key, count }) => {
                const cfg = VERDICT_CONFIG[key];
                return (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1.5 rounded-full border
                      px-2.5 py-1 font-medium ${cfg.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {count} {cfg.label}
                  </span>
                );
              })}
          </div>
        </div>
      </div>

      {/* Per-verdict rows */}
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {result.verdicts.map((v, i) => {
          const cfg = VERDICT_CONFIG[v.verdict];
          return (
            <div key={i} className="px-4 py-4 hover:bg-slate-50 space-y-2">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-slate-500 font-medium leading-snug line-clamp-1">
                  Citing: <span className="text-slate-700">{v.reference_raw}</span>
                </p>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full border
                    px-2 py-0.5 text-xs font-semibold ${cfg.badge}`}
                >
                  {cfg.icon} {cfg.label}
                </span>
              </div>

              {/* The claim from the draft */}
              <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2">
                <p className="text-xs font-medium text-indigo-600 mb-0.5">Claim in draft:</p>
                <p className="text-sm text-slate-700 italic">"{v.claim_text}"</p>
              </div>

              {/* Explanation */}
              <p className="text-xs text-slate-600 leading-relaxed">{v.explanation}</p>

              {/* Abstract snippet if available */}
              {v.found_abstract && v.verdict !== "supported" && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <p className="text-xs font-medium text-slate-500 mb-0.5">Paper abstract (excerpt):</p>
                  <p className="text-xs text-slate-500 italic line-clamp-3">"{v.found_abstract}"</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* What this feature is */}
      <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-500 leading-relaxed">
        ℹ This check compares your draft's claims against each cited paper's actual abstract
        from Semantic Scholar. It catches misrepresentation — citing real papers but overstating
        or contradicting what they found.
      </p>
    </div>
  );
};

export default ClaimMatchPanel;
