/**
 * KnowledgeGraphSidebar.tsx
 *
 * Slide-in panel rendered when a knowledge-graph node is clicked.
 * Shows: type badge, title, abstract, DOI link, and node ID.
 *
 * The slide-in animation is driven by the parent (KnowledgeGraph) wrapping
 * this component in a div with `translate-x-0 / translate-x-full` and
 * `transition-transform duration-300`.  The sidebar itself is always
 * rendered at full opacity so the animation is purely positional.
 */

import type { FC, ReactNode } from "react";
import type { GraphNode } from "./KnowledgeGraph";

// ── Constants ──────────────────────────────────────────────────────────────

const TYPE_META: Record<
  GraphNode["type"],
  { label: string; bg: string; text: string; dot: string }
> = {
  paper: {
    label: "Paper",
    bg:    "bg-indigo-50",
    text:  "text-indigo-700",
    dot:   "bg-indigo-500",
  },
  author: {
    label: "Author",
    bg:    "bg-amber-50",
    text:  "text-amber-700",
    dot:   "bg-amber-500",
  },
  concept: {
    label: "Concept",
    bg:    "bg-emerald-50",
    text:  "text-emerald-700",
    dot:   "bg-emerald-500",
  },
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface KnowledgeGraphSidebarProps {
  node: GraphNode;
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

const KnowledgeGraphSidebar: FC<KnowledgeGraphSidebarProps> = ({
  node,
  onClose,
}) => {
  const meta         = TYPE_META[node.type];
  const displayTitle = node.title ?? node.label;
  const doiUrl       = node.doi
    ? node.doi.startsWith("http")
      ? node.doi
      : `https://doi.org/${node.doi}`
    : null;

  return (
    <aside
      aria-label="Node details"
      className="flex h-full w-full flex-col overflow-hidden rounded-r-2xl border-l border-slate-200 bg-white shadow-xl"
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {/* Type badge */}
          <span
            className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.bg} ${meta.text}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
              aria-hidden="true"
            />
            {meta.label}
          </span>

          {/* Title */}
          <h2 className="text-sm font-semibold leading-snug text-slate-800">
            {displayTitle}
          </h2>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* ── Body (scrollable) ── */}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">

        {/* Abstract */}
        <Section title="Abstract">
          {node.abstract ? (
            <p className="text-sm leading-relaxed text-slate-600">
              {node.abstract}
            </p>
          ) : (
            <p className="text-sm italic text-slate-400">
              No abstract available for this node.
            </p>
          )}
        </Section>

        {/* DOI / external link */}
        {doiUrl && (
          <Section title="DOI">
            <a
              href={doiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 break-all text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              <ExternalLinkIcon />
              {node.doi}
            </a>
          </Section>
        )}

        {/* Node ID */}
        <Section title="Node ID">
          <code className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {node.id}
          </code>
        </Section>
      </div>

      {/* ── Footer: open in new tab shortcut ── */}
      {doiUrl && (
        <div className="border-t border-slate-100 px-4 py-3">
          <a
            href={doiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 active:bg-indigo-800"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            Open paper
          </a>
        </div>
      )}
    </aside>
  );
};

// ── Helper sub-components ──────────────────────────────────────────────────

const Section: FC<{ title: string; children: ReactNode }> = ({
  title,
  children,
}) => (
  <section>
    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
      {title}
    </h3>
    {children}
  </section>
);

const ExternalLinkIcon: FC<{ className?: string }> = ({
  className = "h-3.5 w-3.5 flex-shrink-0",
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z"
      clipRule="evenodd"
    />
    <path
      fillRule="evenodd"
      d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z"
      clipRule="evenodd"
    />
  </svg>
);

export default KnowledgeGraphSidebar;
