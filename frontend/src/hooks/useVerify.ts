// React Query mutation hook for POST /api/verify.
// Mirrors the pattern used by useResearch.ts.

import { useMutation } from "@tanstack/react-query";
import { verifyAPI } from "../api/client";
import type { IntegrityReport, VerifyRequest } from "../api/verifyTypes";
import type { ApiError } from "../api/client";

export function useVerify() {
  const mutation = useMutation<IntegrityReport, ApiError, VerifyRequest>({
    mutationFn: (request: VerifyRequest) => verifyAPI(request),
  });

  return {
    verify: mutation.mutate,
    verifyAsync: mutation.mutateAsync,
    data: mutation.data,
    error: mutation.error,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
}
