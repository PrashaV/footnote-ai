// TypeScript types that mirror backend/models/verify.py (Pydantic v2 schemas).
// Keep in sync with any changes to the Python models.

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface VerifyRequest {
  draft: string;
  title?: string;
  check_citations?: boolean;
  check_ai_writing?: boolean;
  check_plagiarism_risk?: boolean;
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
// AI writing detection
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
// Plagiarism risk
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "moderate" | "high";

export interface PlagiarismRiskResult {
  risk_score: number;
  risk_level: RiskLevel;
  flagged_passages: FlaggedPassage[];
  issues: string[];
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
  ai_originality: number;
  plagiarism_risk: number;
  overall: number;
}

export type FixPriority = "high" | "medium" | "low";
export type FixCategory =
  | "citation"
  | "ai_writing"
  | "plagiarism"
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
  ai_writing: AIWritingResult | null;
  plagiarism_risk: PlagiarismRiskResult | null;
  unsupported_claims: UnsupportedClaim[];
  warnings: string[];
  recommended_fixes: RecommendedFix[];
  metadata: IntegrityReportMetadata;
}
