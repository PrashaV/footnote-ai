// TypeScript types that mirror the Pydantic v2 models in
// `backend/models/research.py`. Keep these in sync with that file —
// any field change on the Python side must be reflected here so the
// frontend stays type-safe end-to-end.

/** Research depth. Matches the Literal["quick", "deep"] on the backend. */
export type ResearchDepth = "quick" | "deep";

/** Confidence label attached to each synthesized finding. */
export type Confidence = "low" | "medium" | "high";

/** Request payload for POST /api/research. */
export interface ResearchRequest {
  topic: string;
  depth?: ResearchDepth;
}

/** A single academic paper referenced in the research response. */
export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  citation_count: number | null;
}

/** A synthesized claim with evidence and source pointers. */
export interface KeyFinding {
  claim: string;
  evidence: string;
  source_ids: string[];
  confidence: Confidence;
}

/** Bookkeeping metadata attached to every response. */
export interface ResearchMetadata {
  /** Anthropic model used to generate the answer (e.g. "claude-sonnet-4-6"). */
  model: string;
  depth: ResearchDepth;
  /** ISO 8601 UTC timestamp the response was produced. */
  generated_at: string;
  latency_ms: number | null;
  /** Token usage breakdown, typically { input_tokens, output_tokens }. */
  token_usage: Record<string, number> | null;
}

/** Response payload returned by POST /api/research. */
export interface ResearchResponse {
  topic: string;
  summary: string;
  key_findings: KeyFinding[];
  papers: Paper[];
  open_questions: string[];
  suggested_queries: string[];
  metadata: ResearchMetadata;
}

/** Shape of a FastAPI error body (both HTTPException and validation errors). */
export interface ApiErrorBody {
  detail: string | Array<{ loc: (string | number)[]; msg: string; type: string }>;
}
