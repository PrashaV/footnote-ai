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
// Claim match types (Phase 4.5)
// ---------------------------------------------------------------------------

/** A source paper used as evidence for a claim NLI verdict. */
export interface ClaimSourceRef {
  title: string;
  url?: string | null;
  /** First 300 chars of the abstract used as evidence. */
  abstract_excerpt?: string | null;
  year?: number | null;
  authors?: string[];
}

/**
 * A single claim extracted from the document with its NLI verdict.
 *
 * verdict:
 *   "entailed"     — at least one source supports with confidence > 0.7  ✓
 *   "contradicted" — at least one source contradicts                      ✗
 *   "unsupported"  — no supporting evidence found                         ⚠
 */
export interface ClaimMatch {
  /** The specific factual assertion. */
  claim: string;
  /** Full sentence containing the claim. */
  sentence: string;
  /** "statistic" | "causal" | "correlation" | "definition" | "quote" | "general" */
  claim_type: string;
  /** "entailed" | "contradicted" | "unsupported" */
  verdict: "entailed" | "contradicted" | "unsupported";
  /** NLI confidence 0–1. */
  confidence: number;
  /** Plain-English explanation of the verdict. */
  explanation: string;
  /** Papers used as evidence (up to 3). */
  supporting_sources: ClaimSourceRef[];
  /** Start character offset of the claim in the document content. */
  char_start: number;
  /** End character offset (exclusive). */
  char_end: number;
}

// ---------------------------------------------------------------------------
// Citation check types (Phase 4.3)
// ---------------------------------------------------------------------------

/**
 * A single citation issue found by the citation check engine.
 *
 * issue_type:
 *   "format_error"      — malformed DOI, implausible year, etc.
 *   "missing_field"     — no title / author / year
 *   "doi_not_found"     — DOI returned 404 from CrossRef
 *   "title_mismatch"    — CrossRef title differs significantly from cited title
 *   "author_mismatch"   — first author doesn't match CrossRef record
 *   "retracted"         — paper retracted per Semantic Scholar
 *   "quote_mismatch"    — quoted phrase not found in abstract
 *   "predatory_journal" — journal absent from DOAJ
 */
export interface FlaggedCitation {
  /** The citation reference text (truncated to 120 chars). */
  citation_text: string;
  /** Machine-readable issue category. */
  issue_type:
    | "format_error"
    | "missing_field"
    | "doi_not_found"
    | "title_mismatch"
    | "author_mismatch"
    | "retracted"
    | "quote_mismatch"
    | "predatory_journal";
  /** Plain-English explanation shown in the UI. */
  detail: string;
  /** "high" | "medium" | "low" */
  severity: "high" | "medium" | "low";
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
  /** Per-citation issues found by the citation check engine (Phase 4.3+). */
  flagged_citations?: FlaggedCitation[];
  /** Rich per-match data from the plagiarism engine (Phase 4.4+). */
  plagiarism_matches?: PlagiarismMatch[];
  /** Per-claim NLI verdicts from the claim match engine (Phase 4.5+). */
  claim_matches?: ClaimMatch[];
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
