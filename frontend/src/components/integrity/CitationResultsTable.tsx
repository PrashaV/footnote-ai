// CitationResultsTable — shows per-reference verification status.

import type { FC } from "react";
import type { CitationCheckResult, CitationStatus } from "../../api/verifyTypes";

interface Props {
  result: CitationCheckResult;
}

const STATUS_CONFIG: Record<
  CitationStatus,
  { label: string; dot: string; badge: string }
> = {
  verified:     { label: "Verified",     dot: "bg-green-500",  badge: "bg-green-50 text-green-700 border-green-200" },
  unverified:   { label: "Unverified",   dot: "bg-amber-400",  badge: "bg-amber-50 text-amber-700 border-amber-200" },
  hallucinated: { label: "Hallucinated", dot: "bg-red-500",    badge: "bg-red-50 text-red-700 border-red-200" },
  mismatch:     { label: "Mismatch",     dot: "bg-orange-500", badge: "bg-orange-50 text-orange-700 border-orange-200" },
};

const CitationResultsTable: FC<Props> = ({ result }) => {
  if (result.total_references === 0) {
    return (
      <p className="text-sm text-slate-500 italic">
        No references found in the draft.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(
          [
            { key: "verified",     count: result.verified_count },
            { key: "unverified",   count: result.unverified_count },
            { key: "hallucinated", count: result.hallucinated_count },
            { key: "mismatch",     count: result.mismatch_count },
          ] as const
        )
          .filter((s) => s.count > 0)
          .map(({ key, count }) => {
            const cfg = STATUS_CONFIG[key];
            return (
              <span
                key={key}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${cfg.badge}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                {count} {cfg.label}
              </span>
            );
          })}
        <span className="ml-auto text-slate-500">
          {result.total_references} total · Score: {result.score.toFixed(0)}/100
        </span>
      </div>

      {/* Per-reference rows */}
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {result.citations.map((c, i) => {
          const cfg = STATUS_CONFIG[c.status];
          return (
            <div key={i} className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-slate-800 leading-snug line-clamp-2">
                  {c.reference.raw_text}
                </p>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full border
                    px-2 py-0.5 text-xs font-medium ${cfg.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
              </div>

              {/* Found paper info */}
              {c.found_title && (
                <p className="text-xs text-slate-500">
                  <span className="font-medium">Found:</span> {c.found_title}
                  {c.source_api && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-400">
                      {c.source_api.replace("_", " ")}
                    </span>
                  )}
                  {c.found_url && (
                    <a
                      href={c.found_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-indigo-500 hover:underline"
                    >
                      View ↗
                    </a>
                  )}
                </p>
              )}

              {c.mismatch_reason && (
                <p className="text-xs text-orange-600">⚠ {c.mismatch_reason}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CitationResultsTable;
