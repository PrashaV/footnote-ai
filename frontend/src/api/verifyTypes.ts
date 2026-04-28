// TypeScript types mirroring backend/models/verify.py (Pydantic v2).
// Keep in sync with any changes to the Python models.

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface VerifyRequest {
  draft: string;
  title?: string;
  check_citations?: boolean;
  check_claim_matching?: boolean;
  check_ai_writing?: boolean;
}

// ---------------------------------------------------------------------------
// Citation check
// ---------------------------------------------------------------------------

export type CitationStatus = "verified" | "unverified" | "hallucinated" | "mismatch";
export type SourceApi = "semantic_scholar" | "crossref" | "openalex";

export interface ExtractedReference {
  raw_text: string;
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
}

export interface VerifiedCitation {
  reference: ExtractedReference;
  status: CitationStatus;
  found_title: string | null;
  found_doi: string | null;
  found_url: string | null;
  found_abstract: string | null;
  source_api: SourceApi | null;
  mismatch_reason: string | null;
  confidence: "low" | "medium" | "high";
}

export interface CitationCheckResult {
  total_references: number;
  verified_count: number;
  unverified_count: number;
  hallucinated_count: number;
  mismatch_count: number;
  citations: VerifiedCitation[];
  score: number;
}

// ---------------------------------------------------------------------------
// Claim-to-citation matching (unique feature)
// ---------------------------------------------------------------------------

export type ClaimVerdict = "supported" | "overstated" | "contradicted" | "unverifiable";

export interface ClaimMatchVerdict {
  claim_text: string;
  reference_raw: string;
  found_abstract: string | null;
  verdict: ClaimVerdict;
  explanation: string;
  severity: "low" | "medium" | "high";
}

export interface ClaimMatchResult {
  total_checked: number;
  supported_count: number;
  overstated_count: number;
  contradicted_count: number;
  unverifiable_count: number;
  verdicts: ClaimMatchVerdict[];
  score: number;
}

// ---------------------------------------------------------------------------
// AI writing detection (GPTZero)
// ---------------------------------------------------------------------------

export type AIVerdict = "likely_human" | "uncertain" | "likely_ai";

export interface FlaggedPassage {
  text: string;
  reason: string;
  start_char: number | null;
  severity: "low" | "medium" | "high";
}

export interface AIWritingResult {
  score: number;
  verdict: AIVerdict;
  flagged_passages: FlaggedPassage[];
  indicators: string[];
  explanation: string;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Unsupported claims
// ---------------------------------------------------------------------------

export interface UnsupportedClaim {
  text: string;
  reason: string;
  suggestion: string | null;
}

// ---------------------------------------------------------------------------
// Integrity scores & report
// ---------------------------------------------------------------------------

export interface IntegrityScores {
  citation_integrity: number;
  claim_accuracy: number;
  ai_originality: number;
  overall: number;
}

export type FixPriority = "high" | "medium" | "low";
export type FixCategory =
  | "citation"
  | "claim_match"
  | "ai_writing"
  | "unsupported_claim"
  | "general";

export interface RecommendedFix {
  priority: FixPriority;
  category: FixCategory;
  description: string;
  affected_text: string | null;
}

export interface IntegrityReportMetadata {
  model: string;
  generated_at: string;
  latency_ms: number | null;
  checks_performed: string[];
  word_count: number | null;
}

export interface IntegrityReport {
  title: string | null;
  scores: IntegrityScores;
  citation_check: CitationCheckResult | null;
  claim_match: ClaimMatchResult | null;
  ai_writing: AIWritingResult | null;
  unsupported_claims: UnsupportedClaim[];
  warnings: string[];
  recommended_fixes: RecommendedFix[];
  metadata: IntegrityReportMetadata;
}
