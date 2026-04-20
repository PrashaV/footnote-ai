// Centralized backend API client — all HTTP calls route through this file.
// Every component/hook should import from here; never hardcode URLs or call
// axios directly from a component.

import axios, { AxiosError, AxiosInstance } from "axios";

import type {
  ApiErrorBody,
  ResearchRequest,
  ResearchResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

// `import.meta.env.VITE_API_URL` is injected at build time by Vite. When it is
// missing (e.g. in a test environment), fall back to the local dev server so
// nothing crashes on import — the request itself will still fail loudly.
const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  timeout: 60_000, // deep research calls can take a while
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/** Normalized error thrown by every API function in this module. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly body: ApiErrorBody | null;

  constructor(message: string, status: number | null, body: ApiErrorBody | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function toApiError(err: unknown): ApiError {
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? null;
    const body = (err.response?.data ?? null) as ApiErrorBody | null;
    const detail =
      body && typeof body.detail === "string"
        ? body.detail
        : err.message || "Request failed";
    return new ApiError(detail, status, body);
  }
  if (err instanceof Error) {
    return new ApiError(err.message, null, null);
  }
  return new ApiError("Unknown error", null, null);
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/research — generate a source-backed research briefing.
 *
 * Throws `ApiError` on non-2xx responses or network failures so callers
 * (typically React Query) can branch on `err.status`.
 */
export async function researchAPI(
  request: ResearchRequest,
): Promise<ResearchResponse> {
  try {
    const { data } = await apiClient.post<ResearchResponse>(
      "/api/research",
      request,
    );
    return data;
  } catch (err) {
    throw toApiError(err);
  }
}

/**
 * POST /api/export — export a ResearchResponse as a Word document.
 *
 * Returns a Blob containing the .docx binary. Throws `ApiError` on failure.
 */
export async function exportDocxAPI(response: ResearchResponse): Promise<Blob> {
  try {
    const { data } = await apiClient.post<Blob>("/api/export", response, {
      responseType: "blob",
    });
    return data;
  } catch (err) {
    throw toApiError(err);
  }
}
