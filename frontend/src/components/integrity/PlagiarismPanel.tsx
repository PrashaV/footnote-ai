// PlagiarismPanel — Phase 4.4
//
// Renders a list of plagiarism matches below the plagiarism engine card in the
// IntegritySidebar. Each match shows:
//   • Match type badge (exact / paraphrase / mosaic / self)
//   • Similarity score (%)
//   • Text excerpt from the document (truncated)
//   • Source title + link to Semantic Scholar (or "your document" for self)
//
// Used by IntegritySidebar; receives matches from CheckResult.plagiarism_matches.

import { type FC } from "react";
import type { PlagiarismMatch } from "../../api/integrityAnalyzeTypes";
import { MATCH_TYPE_LABELS, MATCH_TYPE_COLORS } from "../../api/integrityAnalyzeTypes";

// ---------------------------------------------------------------------------
// Single match card
// ---------------------------------------------------------------------------

interface MatchCardProps {
  match: PlagiarismMatch;
  index: number;
}

const MatchCard: FC<MatchCardProps> = ({ match, index }) => {
  const colors = MATCH_TYPE_COLORS[match.match_type];
  const label  = MATCH_TYPE_LABELS[match.match_type];
  const simPct = Math.round(match.similarity_score * 100);

  const source = match.matched_source;
  const authorStr =
    source.authors && source.authors.length > 0
      ? source.authors.slice(0, 2).join(", ") +
        (source.authors.length > 2 ? " et al." : "")
      : null;

  const yearStr = source.year ? ` (${source.year})` : "";
  const titleLine = `${source.title}${yearStr}`;

  const isSelf = source.is_self === true;

  return (
    <div className="px-4 py-2.5 border-b border-slate-100 last:border-b-0">
      {/* Header row: match number, type badge, similarity */}
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 text-[10px] font-mono text-slate-400">
          #{index + 1}
        </span>
        <span
          className={`
            flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold
            uppercase tracking-wide ring-1 ${colors.bg} ${colors.text} ${colors.ring}
          `}
        >
          {label}
        </span>
        <span className="ml-auto flex-shrink-0 text-[11px] font-medium text-slate-500">
          {simPct}% similar
        </span>
      </div>

      {/* Text excerpt */}
      <p
        className="mt-1.5 text-[11px] leading-snug text-slate-500 italic line-clamp-2"
        title={match.text_excerpt}
      >
        &ldquo;{match.text_excerpt}&rdquo;
      </p>

      {/* Source info */}
      <div className="mt-1.5">
        {isSelf ? (
          <p className="text-[11px] text-slate-600">
            <span className="font-medium text-purple-700">Your document:</span>{" "}
            {source.title}
          </p>
        ) : source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-start gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 transition-colors"
            title={titleLine}
          >
            <svg
              className="mt-0.5 h-3 w-3 flex-shrink-0 text-indigo-400 group-hover:text-indigo-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
            <span className="line-clamp-2 leading-snug underline-offset-2 group-hover:underline">
              {titleLine}
              {authorStr && (
                <span className="ml-1 text-slate-400 no-underline">
                  — {authorStr}
                </span>
              )}
            </span>
          </a>
        ) : (
          <p className="text-[11px] text-slate-600 line-clamp-2" title={titleLine}>
            {titleLine}
            {authorStr && (
              <span className="ml-1 text-slate-400">— {authorStr}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PlagiarismPanelProps {
  matches: PlagiarismMatch[];
}

const PlagiarismPanel: FC<PlagiarismPanelProps> = ({ matches }) => {
  if (!matches || matches.length === 0) return null;

  const nExact  = matches.filter((m) => m.match_type === "exact").length;
  const nPara   = matches.filter((m) => m.match_type === "paraphrase").length;
  const nMosaic = matches.filter((m) => m.match_type === "mosaic").length;
  const nSelf   = matches.filter((m) => m.match_type === "self").length;

  const breakdown: string[] = [];
  if (nExact)   breakdown.push(`${nExact} exact`);
  if (nPara)    breakdown.push(`${nPara} paraphrase`);
  if (nMosaic)  breakdown.push(`${nMosaic} mosaic`);
  if (nSelf)    breakdown.push(`${nSelf} self`);

  return (
    <div className="border-t border-slate-100">
      {/* Section header */}
      <div className="px-4 py-2 bg-red-50 border-b border-red-100">
        <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">
          {matches.length} match{matches.length !== 1 ? "es" : ""}
          {breakdown.length > 0 && (
            <span className="ml-1 font-normal text-red-400">
              ({breakdown.join(", ")})
            </span>
          )}
        </p>
      </div>

      {/* Match cards */}
      {matches.map((match, i) => (
        <MatchCard
          key={`${match.start_char}-${match.match_type}-${i}`}
          match={match}
          index={i}
        />
      ))}

      {/* Disclaimer */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
        <p className="text-[10px] leading-snug text-slate-400">
          Similarity computed via OpenAI embeddings vs. Semantic Scholar abstracts.
          This is a risk indicator — verify each match manually before acting.
        </p>
      </div>
    </div>
  );
};

export default PlagiarismPanel;
