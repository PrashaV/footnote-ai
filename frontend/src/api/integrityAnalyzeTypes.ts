// Types for POST /api/integrity/analyze — Phase 4 Integrity Engine.
//
// These mirror the Pydantic models in backend/models/integrity_analyze.py.
// Keep both in sync when engine implementations land in Phases 4.2–4.5.

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface CitationRef {
  id?: string;
  raw_text?: string;
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  url?: string;
}

export interface IntegrityAnalyzeRequest {
  /** Supabase document UUID. */
  document_id: string;
  /** Full plain-text content of the document. */
  content: string;
  /** Citations attached to this document. */
  citations: CitationRef[];
}

// ---------------------------------------------------------------------------
// Per-check result
// ---------------------------------------------------------------------------

export interface FlaggedSection {
  /** Start character offset in the document content (inclusive). */
  start_char: number;
  /** End character offset (exclusive). */
  end_char: number;
  /** Human-readable reason this section was flagged. */
  reason: string;
}

export interface CheckResult {
  /** 0.0 = worst, 1.0 = best / most trustworthy.
   *  Exception: ai_detection uses 0.0 = human, 1.0 = AI (inverted). */
  score: number;
  /** True if the check found something worth reviewing. */
  flagged: boolean;
  /** Zero or more character ranges in the source document. */
  flagged_sections: FlaggedSection[];
  /** Engine confidence: 0.0 = uncertain, 1.0 = certain. */
  confidence: number;
  /** One or two sentences for display in the UI. */
  summary: string;
  /** Algorithm / data-source identifier (e.g. "perplexity+burstiness"). */
  method?: string;
}

// ---------------------------------------------------------------------------
// Combined response
// ---------------------------------------------------------------------------

export interface IntegrityAnalyzeResponse {
  document_id: string;
  ai_detection: CheckResult;
  citation_check: CheckResult;
  plagiarism_check: CheckResult;
  claim_match: CheckResult;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Map a 0–1 score to a pass / warn / fail badge label. */
export type IntegrityBadge = "pass" | "warn" | "fail";

export function scoreToBadge(score: number, flagged: boolean): IntegrityBadge {
  if (flagged) return score < 0.5 ? "fail" : "warn";
  if (score >= 0.75) return "pass";
  if (score >= 0.5) return "warn";
  return "fail";
}
