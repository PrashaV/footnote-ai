// useResearch — React Query wrapper around the /api/research endpoint.
//
// Exposes a mutation (research is a user-triggered POST, not a cache-on-mount
// read) along with the standard loading/error/data surface so components can
// render the three states without re-implementing async boilerplate.
//
// Usage:
//   const { research, data, error, isLoading, reset } = useResearch();
//   research({ topic: "...", depth: "quick" });

import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { researchAPI, ApiError } from "../api/client";
import type { ResearchRequest, ResearchResponse } from "../api/types";

export interface UseResearchResult {
  /** Fire the request. Safe to call again to re-run with new inputs. */
  research: (request: ResearchRequest) => void;
  /** Promise-returning variant, useful when you need to await the result. */
  researchAsync: (request: ResearchRequest) => Promise<ResearchResponse>;
  /** The latest successful response, or `undefined` before the first success. */
  data: ResearchResponse | undefined;
  /** Normalized error from the API (or `null` when there is none). */
  error: ApiError | null;
  /** True while a request is in flight. */
  isLoading: boolean;
  /** True once a successful response has been received. */
  isSuccess: boolean;
  /** True once a request has errored. */
  isError: boolean;
  /** Clear the current data/error state. */
  reset: () => void;
  /** Escape hatch to the underlying react-query mutation if needed. */
  mutation: UseMutationResult<ResearchResponse, ApiError, ResearchRequest>;
}

/**
 * React Query hook for the research endpoint.
 *
 * Note: requires a `<QueryClientProvider>` somewhere above the component tree.
 */
export function useResearch(): UseResearchResult {
  const mutation = useMutation<ResearchResponse, ApiError, ResearchRequest>({
    mutationKey: ["research"],
    mutationFn: (request: ResearchRequest) => researchAPI(request),
  });

  return {
    research: mutation.mutate,
    researchAsync: mutation.mutateAsync,
    data: mutation.data,
    error: mutation.error ?? null,
    // react-query v5 exposes `isPending`; older v4 uses `isLoading`.
    // Prefer v5 and fall back so the hook works under either version.
    isLoading:
      (mutation as unknown as { isPending?: boolean }).isPending ??
      (mutation as unknown as { isLoading?: boolean }).isLoading ??
      false,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
    mutation,
  };
}
