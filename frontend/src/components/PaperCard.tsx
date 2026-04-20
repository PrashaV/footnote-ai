import type { FC } from "react";

import type { Paper } from "../api/types";

/**
 * Props for {@link PaperCard}.
 */
export interface PaperCardProps {
  /** The paper to render. Matches the `Paper` type returned by the backend. */
  paper: Paper;
  /**
   * Optional callback fired when the card is clicked. Useful for syncing
   * selection state with the KnowledgeGraph visualization.
   */
  onSelect?: (paperId: string) => void;
  /** When true, renders with a highlighted border to indicate selection. */
  isSelected?: boolean;
}

/**
 * Card view for a single paper — title, authors, venue, citation count,
 * abstract, and an outbound link to the DOI / URL when present.
 *
 * Purely presentational: no data fetching, no local state.
 */
const PaperCard: FC<PaperCardProps> = ({ paper, onSelect, isSelected = false }) => {
  const { id, title, authors, year, venue, doi, url, abstract, citation_count } = paper;

  const authorsLabel = formatAuthors(authors);
  const metaLine = [venue, year?.toString()].filter(Boolean).join(" · ");
  const externalHref = url ?? (doi ? `https://doi.org/${doi}` : null);

  const handleClick = (): void => {
    if (onSelect) onSelect(id);
  };

  return (
    <article
      onClick={handleClick}
      className={
        "group flex flex-col gap-2 rounded-2xl border bg-white p-4 shadow-sm transition-shadow " +
        (isSelected
          ? "border-slate-900 ring-2 ring-slate-900/10"
          : "border-slate-200 hover:shadow-md") +
        (onSelect ? " cursor-pointer" : "")
      }
      aria-pressed={onSelect ? isSelected : undefined}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug text-slate-900">
          {externalHref ? (
            <a
              href={externalHref}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {title}
            </a>
          ) : (
            title
          )}
        </h3>
        {typeof citation_count === "number" ? (
          <span
            className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
            title={`${citation_count} citations`}
          >
            {citation_count.toLocaleString()} cites
          </span>
        ) : null}
      </header>

      <p className="text-sm text-slate-600">{authorsLabel}</p>

      {metaLine ? (
        <p className="text-xs uppercase tracking-wide text-slate-400">{metaLine}</p>
      ) : null}

      {abstract ? (
        <p className="line-clamp-3 text-sm leading-relaxed text-slate-700">{abstract}</p>
      ) : null}
    </article>
  );
};

/** Format an author list as "A. Smith, B. Jones, …" with sensible fallbacks. */
function formatAuthors(authors: string[]): string {
  if (!authors || authors.length === 0) return "Unknown author";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} + ${authors.length - 3} more`;
}

export default PaperCard;
