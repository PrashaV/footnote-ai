// useIntegrityAnalyze — React hook for POST /api/integrity/analyze.
//
// Manages loading, result, and error state for the four-engine integrity check.
// Designed to be used in WorkspacePage alongside the "Run Integrity Check" button.
//
// Usage:
//   const { results, isLoading, error, run, reset } = useIntegrityAnalyze();
//   await run(docId, editorText, citations);

import { useState, useCallback } from "react";

import { integrityAnalyzeAPI } from "../api/client";
import type {
  CitationRef,
  IntegrityAnalyzeResponse,
} from "../api/integrityAnalyzeTypes";

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface UseIntegrityAnalyzeResult {
  /** Results from the last successful run, or null if not yet run. */
  results: IntegrityAnalyzeResponse | null;
  /** True while the API call is in-flight. */
  isLoading: boolean;
  /** Error message from the last failed run, or null. */
  error: string | null;
  /** Trigger a new integrity check. Clears previous results. */
  run: (
    documentId: string,
    content: string,
    citations: CitationRef[],
  ) => Promise<void>;
  /** Clear results and error (e.g. when the document changes significantly). */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIntegrityAnalyze(): UseIntegrityAnalyzeResult {
  const [results, setResults] = useState<IntegrityAnalyzeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (
    documentId: string,
    content: string,
    citations: CitationRef[],
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);
    // Don't clear previous results yet — keep them visible while loading
    // so the UI doesn't flash blank. They'll be replaced on success.

    try {
      const data = await integrityAnalyzeAPI({ document_id: documentId, content, citations });
      setResults(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Integrity check failed. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResults(null);
    setError(null);
  }, []);

  return { results, isLoading, error, run, reset };
}
