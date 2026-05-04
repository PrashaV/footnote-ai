// CitationList — keyboard-navigable dropdown rendered by the @ citation
// autocomplete suggestion plugin.
//
// Rendered via TipTap's ReactRenderer so it lives in a detached DOM node
// that the CitationExtension positions near the caret.
//
// Ref-forwarded so the extension can call onKeyDown for arrow-key / Enter
// navigation without needing to pierce React state.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type FC,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CitationItem {
  paperId: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  externalIds: Record<string, string>;
}

export interface CitationListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface CitationListProps {
  items: CitationItem[];
  command: (item: CitationItem) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown";
  const parts = authors[0].split(" ");
  const first = parts[parts.length - 1] ?? authors[0]; // last name
  return authors.length > 1 ? `${first} et al.` : first;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CitationList = forwardRef<CitationListRef, CitationListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when results change
    useEffect(() => setSelectedIndex(0), [items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="
          rounded-lg border border-slate-200 bg-white shadow-lg
          px-3 py-2 text-xs text-slate-500
        ">
          No papers found
        </div>
      );
    }

    return (
      <div className="
        rounded-lg border border-slate-200 bg-white shadow-lg
        overflow-hidden w-80
      ">
        {items.map((item, index) => (
          <button
            key={item.paperId || index}
            onClick={() => selectItem(index)}
            className={`
              w-full px-3 py-2.5 text-left transition-colors
              border-b border-slate-100 last:border-b-0
              ${index === selectedIndex
                ? "bg-indigo-50"
                : "hover:bg-slate-50"
              }
            `}
          >
            <p className={`
              text-xs font-medium leading-tight line-clamp-2
              ${index === selectedIndex ? "text-indigo-900" : "text-slate-800"}
            `}>
              {item.title}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {formatAuthors(item.authors)}
              {item.year ? ` · ${item.year}` : ""}
            </p>
          </button>
        ))}
      </div>
    );
  },
);

CitationList.displayName = "CitationList";

// ---------------------------------------------------------------------------
// Author formatting for inserted citation text (exported for reuse)
// ---------------------------------------------------------------------------

export function buildCitationText(item: CitationItem): string {
  const authorPart = formatAuthors(item.authors);
  const yearPart = item.year ? `, ${item.year}` : "";
  return `[${authorPart}${yearPart}]`;
}
