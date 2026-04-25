// RecommendedFixesPanel — prioritised list of corrective actions.

import type { FC } from "react";
import type { RecommendedFix, FixPriority } from "../../api/verifyTypes";

interface Props {
  fixes: RecommendedFix[];
}

const PRIORITY_CONFIG: Record<FixPriority, { label: string; dot: string; border: string; text: string }> = {
  high:   { label: "High",   dot: "bg-red-500",    border: "border-l-red-400",    text: "text-red-700"   },
  medium: { label: "Medium", dot: "bg-amber-400",  border: "border-l-amber-400",  text: "text-amber-700" },
  low:    { label: "Low",    dot: "bg-blue-400",   border: "border-l-blue-400",   text: "text-blue-700"  },
};

const CATEGORY_LABEL: Record<string, string> = {
  citation:         "Citation",
  ai_writing:       "AI Writing",
  plagiarism:       "Plagiarism Risk",
  unsupported_claim:"Unsupported Claim",
  general:          "General",
};

const RecommendedFixesPanel: FC<Props> = ({ fixes }) => {
  if (fixes.length === 0) {
    return (
      <p className="text-sm text-green-600 font-medium">
        ✓ No significant issues found. Your draft looks good!
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {fixes.map((fix, i) => {
        const pcfg = PRIORITY_CONFIG[fix.priority];
        return (
          <div
            key={i}
            className={`rounded-lg border-l-4 border border-slate-200 bg-white px-4 py-3 ${pcfg.border}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`h-2 w-2 rounded-full shrink-0 ${pcfg.dot}`} />
              <span className={`text-xs font-semibold ${pcfg.text}`}>
                {pcfg.label} Priority
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                {CATEGORY_LABEL[fix.category] ?? fix.category}
              </span>
            </div>
            <p className="text-sm text-slate-700">{fix.description}</p>
            {fix.affected_text && (
              <p className="mt-1.5 rounded bg-slate-50 border border-slate-200 px-2.5 py-1.5
                text-xs text-slate-500 italic line-clamp-2">
                "{fix.affected_text}"
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default RecommendedFixesPanel;
