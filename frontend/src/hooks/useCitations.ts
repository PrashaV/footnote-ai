// useCitations — manages the list of citations for the current document.
//
// Responsibilities:
//   • Fetches all existing citations from Supabase when docId changes.
//   • Exposes `addCitation` which persists a new citation and optimistically
//     updates local state so the Sources sidebar reflects it immediately.

import { useCallback, useEffect, useState } from "react";
import {
  saveCitation,
  getCitationsForDocument,
  type CitationRow,
} from "../services/supabase";
import type { CitationItem } from "../components/editor/CitationList";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseCitationsReturn {
  citations: CitationRow[];
  isLoading: boolean;
  addCitation: (item: CitationItem, insertedText: string) => Promise<void>;
}

export function useCitations(
  docId: string | null,
  userId: string | null,
): UseCitationsReturn {
  const [citations, setCitations] = useState<CitationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // ── Fetch existing citations when document changes ───────────────────────
  useEffect(() => {
    if (!docId || !userId) {
      setCitations([]);
      return;
    }

    setIsLoading(true);
    getCitationsForDocument(docId, userId).then((rows) => {
      setCitations(rows ?? []);
      setIsLoading(false);
    });
  }, [docId, userId]);

  // ── Add a new citation (optimistic + persist) ────────────────────────────
  const addCitation = useCallback(
    async (item: CitationItem, insertedText: string) => {
      // Check for duplicate (same paper already cited in this doc)
      const alreadyExists = citations.some((c) => c.paper_id === item.paperId);
      if (alreadyExists) return;

      // Optimistic update — sidebar reflects citation immediately
      const optimistic: CitationRow = {
        id:            crypto.randomUUID(),
        document_id:   docId,
        user_id:       userId,
        paper_id:      item.paperId,
        title:         item.title,
        authors:       item.authors,
        year:          item.year,
        doi:           item.doi,
        external_ids:  item.externalIds,
        inserted_text: insertedText,
        created_at:    new Date().toISOString(),
      };

      setCitations((prev) => [...prev, optimistic]);

      // Persist to Supabase only if we have a real document + user
      if (docId && userId) {
        await saveCitation({
          document_id:   docId,
          user_id:       userId,
          paper_id:      item.paperId,
          title:         item.title,
          authors:       item.authors,
          year:          item.year,
          doi:           item.doi,
          external_ids:  item.externalIds,
          inserted_text: insertedText,
        });
      }
    },
    [docId, userId, citations],
  );

  return { citations, isLoading, addCitation };
}
