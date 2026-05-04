// Centralized backend API client — all HTTP calls route through this file.
// Every component/hook should import from here; never hardcode URLs or call
// axios directly from a component.

import axios, { AxiosError, AxiosInstance } from "axios";

import type {
  ApiErrorBody,
  ResearchRequest,
  ResearchResponse,
} from "./types";
import type { IntegrityReport, VerifyRequest } from "./verifyTypes";
import type {
  IntegrityAnalyzeRequest,
  IntegrityAnalyzeResponse,
} from "./integrityAnalyzeTypes";
import { getSupabaseClient } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

// `import.meta.env.VITE_API_URL` is injected at build time by Vite.
// Falls back to the Railway production URL so the app works even if the
// env var is missing from a Vercel deployment.
const baseURL =
  import.meta.env.VITE_API_URL ??
  "https://footnote-ai-production.up.railway.app";

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  timeout: 60_000, // deep research calls can take a while
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// ---------------------------------------------------------------------------
// Auth interceptor — attach Supabase JWT as Bearer token on every request
// ---------------------------------------------------------------------------

apiClient.interceptors.request.use(async (config) => {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// ---------------------------------------------------------------------------
// 401 retry interceptor — if the server rejects with 401 (expired token),
// ask Supabase to refresh the session and retry the request exactly once.
// This handles the race where the token expires between the request interceptor
// reading it and the server validating it.
// ---------------------------------------------------------------------------

let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

function _drainQueue(token: string | null) {
  _refreshQueue.forEach((resolve) => resolve(token));
  _refreshQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as typeof error.config & { _retried?: boolean };

    // Only intercept 401 errors that haven't already been retried.
    if (error.response?.status !== 401 || originalRequest?._retried) {
      return Promise.reject(error);
    }

    const supabase = getSupabaseClient();
    if (!supabase) return Promise.reject(error);

    originalRequest._retried = true;

    if (_isRefreshing) {
      // Another request already kicked off a refresh — wait for its result.
      return new Promise((resolve, reject) => {
        _refreshQueue.push((newToken) => {
          if (!newToken || !originalRequest) return reject(error);
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          resolve(apiClient(originalRequest));
        });
      });
    }

    _isRefreshing = true;
    try {
      const { data, error: refreshError } = await supabase.auth.refreshSession();
      const newToken = data.session?.access_token ?? null;

      if (refreshError || !newToken) {
        _drainQueue(null);
        return Promise.reject(error);
      }

      _drainQueue(newToken);
      originalRequest.headers = originalRequest.headers ?? {};
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(originalRequest);
    } finally {
      _isRefreshing = false;
    }
  },
);

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

/**
 * POST /api/verify — run Academic Integrity checks on a research draft.
 *
 * Returns a full IntegrityReport with scores, warnings, flagged passages,
 * and recommended fixes. Throws `ApiError` on failure.
 */
export async function verifyAPI(request: VerifyRequest): Promise<IntegrityReport> {
  try {
    const { data } = await apiClient.post<IntegrityReport>("/api/verify", request, {
      timeout: 120_000, // verification can be slow (multiple concurrent LLM calls)
    });
    return data;
  } catch (err) {
    throw toApiError(err);
  }
}

/**
 * POST /api/integrity/analyze — run four integrity engines in parallel on a
 * workspace document.
 *
 * Returns an IntegrityAnalyzeResponse with per-engine CheckResult objects.
 * Results are also persisted server-side to the integrity_results Supabase table.
 * Throws `ApiError` on failure.
 */
export async function integrityAnalyzeAPI(
  request: IntegrityAnalyzeRequest,
): Promise<IntegrityAnalyzeResponse> {
  try {
    const { data } = await apiClient.post<IntegrityAnalyzeResponse>(
      "/api/integrity/analyze",
      request,
      { timeout: 120_000 },
    );
    return data;
  } catch (err) {
    throw toApiError(err);
  }
}
