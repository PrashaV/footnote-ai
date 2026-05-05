// Types for POST /api/integrity/analyze — Phase 4 Integrity Engine.
//
// These mirror the Pydantic models in backend/models/integrity_analyze.py.
// Keep both in sync when engine implementations land in Phases 4.2–4.5.
//
// Phase 4.4: added MatchedSource + PlagiarismMatch, extended CheckResult.

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

// ---------------------------------------------------------------------------
// Plagiarism-specific types (Phase 4.4)
// ---------------------------------------------------------------------------

/** External source that a plagiarism-flagged chunk was matched against. */
export interface MatchedSource {
  paperId?: string | null;
  title: string;
  authors?: string[];
  year?: number | null;
  url?: string | null;
  doi?: string | null;
  /** True when the source is one of the user's own previous documents. */
  is_self?: boolean;
}

/**
 * A single plagiarism match returned by the plagiarism check engine.
 * match_type: "exact" | "paraphrase" | "mosaic" | "self"
 */
export interface PlagiarismMatch {
  /** Verbatim excerpt from the current document (≤ 300 chars). */
  text_excerpt: string;
  /** Start character offset in the document (inclusive). */
  start_char: number;
  /** End character offset (exclusive). */
  end_char: number;
  /** Source the chunk was matched against. */
  matched_source: MatchedSource;
  /** Cosine similarity between chunk embedding and source abstract (0–1). */
  similarity_score: number;
  /** "exact" ≥0.88 | "paraphrase" ≥0.75 | "mosaic" | "self" */
  match_type: "exact" | "paraphrase" | "mosaic" | "self";
}

// ---------------------------------------------------------------------------
// Per-engine check result
// ---------------------------------------------------------------------------

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
  /** Rich per-match data from the plagiarism engine (Phase 4.4+). */
  plagiarism_matches?: PlagiarismMatch[];
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

/** Human-readable label for a plagiarism match type. */
export const MATCH_TYPE_LABELS: Record<PlagiarismMatch["match_type"], string> = {
  exact:      "Exact match",
  paraphrase: "Paraphrase",
  mosaic:     "Mosaic",
  self:       "Self-plagiarism",
};

/** Tailwind color tokens for each match type. */
export const MATCH_TYPE_COLORS: Record<
  PlagiarismMatch["match_type"],
  { bg: string; text: string; ring: string }
> = {
  exact:      { bg: "bg-red-100",    text: "text-red-700",    ring: "ring-red-200" },
  paraphrase: { bg: "bg-orange-100", text: "text-orange-700", ring: "ring-orange-200" },
  mosaic:     { bg: "bg-amber-100",  text: "text-amber-700",  ring: "ring-amber-200" },
  self:       { bg: "bg-purple-100", text: "text-purple-700", ring: "ring-purple-200" },
};
