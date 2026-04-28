"""Pydantic v2 schemas for the /api/verify (Academic Integrity Engine) route.

Integrity dimensions covered:
  1. Citation verification   — real API lookups (Semantic Scholar, CrossRef, OpenAlex)
  2. Claim-to-citation match — Claude compares draft claims against paper abstracts
  3. AI writing detection    — GPTZero trained classifier (perplexity + burstiness)
  4. Unsupported claims      — Claude flags factual claims missing citations

Plagiarism string-matching is NOT included. We do not have access to a
database of billions of documents. We recommend Turnitin or Copyleaks for that.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class VerifyRequest(BaseModel):
    """Incoming payload for POST /api/verify."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
        json_schema_extra={
            "example": {
                "draft": "According to Smith et al. (2022) ...",
                "title": "My Research Paper",
                "check_citations": True,
                "check_claim_matching": True,
                "check_ai_writing": True,
            }
        },
    )

    draft: str = Field(
        ...,
        min_length=50,
        max_length=100_000,
        description="The full text of the research draft to verify.",
    )
    title: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Optional title of the paper (used in the report header).",
    )
    check_citations: bool = Field(
        default=True,
        description="Whether to run citation existence + hallucination checks.",
    )
    check_claim_matching: bool = Field(
        default=True,
        description=(
            "Whether to compare draft claims against actual paper abstracts "
            "to detect misrepresentation."
        ),
    )
    check_ai_writing: bool = Field(
        default=True,
        description="Whether to run GPTZero AI writing detection.",
    )


# ---------------------------------------------------------------------------
# Citation / Reference models
# ---------------------------------------------------------------------------


class ExtractedReference(BaseModel):
    """A single reference extracted from the draft."""

    model_config = ConfigDict(extra="ignore")

    raw_text: str = Field(..., description="The raw reference string as found in the draft.")
    title: Optional[str] = Field(default=None, description="Parsed paper title.")
    authors: list[str] = Field(default_factory=list, description="Parsed author names.")
    year: Optional[int] = Field(default=None, description="Parsed publication year.")
    doi: Optional[str] = Field(default=None, description="DOI if present in the reference.")
    url: Optional[str] = Field(default=None, description="URL if present in the reference.")


class VerifiedCitation(BaseModel):
    """Result of checking a single extracted reference against external APIs."""

    model_config = ConfigDict(extra="ignore")

    reference: ExtractedReference = Field(..., description="The extracted reference.")
    status: Literal["verified", "unverified", "hallucinated", "mismatch"] = Field(
        ...,
        description=(
            "verified = found in a scholarly database and title matches; "
            "unverified = not found in any external source; "
            "hallucinated = found but key details don't match (wrong authors/year/title); "
            "mismatch = found but the cited claim doesn't match the paper's content."
        ),
    )
    found_title: Optional[str] = Field(
        default=None, description="Actual title found in external source (if any)."
    )
    found_doi: Optional[str] = Field(
        default=None, description="DOI found in external source (if any)."
    )
    found_url: Optional[str] = Field(
        default=None, description="URL of the actual paper (if found)."
    )
    found_abstract: Optional[str] = Field(
        default=None,
        description="Abstract of the found paper — used for claim matching.",
    )
    source_api: Optional[Literal["semantic_scholar", "crossref", "openalex"]] = Field(
        default=None, description="Which external API confirmed this reference."
    )
    mismatch_reason: Optional[str] = Field(
        default=None,
        description="Human-readable explanation of why the citation doesn't match.",
    )
    confidence: Literal["low", "medium", "high"] = Field(
        default="medium",
        description="Confidence in the verification result.",
    )


class CitationCheckResult(BaseModel):
    """Aggregate result of the citation verification phase."""

    model_config = ConfigDict(extra="ignore")

    total_references: int = Field(..., description="Total references found in the draft.")
    verified_count: int = Field(default=0, description="References successfully verified.")
    unverified_count: int = Field(default=0, description="References not found in any source.")
    hallucinated_count: int = Field(
        default=0, description="References that appear to be hallucinated."
    )
    mismatch_count: int = Field(
        default=0, description="References found but claims don't match paper content."
    )
    citations: list[VerifiedCitation] = Field(
        default_factory=list, description="Per-reference verification details."
    )
    score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description=(
            "Citation integrity score (0 = all bad, 100 = all verified). "
            "Score is 40 when no references are detected — absence of citations "
            "is itself a concern for academic writing."
        ),
    )


# ---------------------------------------------------------------------------
# Claim-to-citation matching (unique feature)
# ---------------------------------------------------------------------------


class ClaimMatchVerdict(BaseModel):
    """Result of comparing one in-text claim against the cited paper's abstract."""

    model_config = ConfigDict(extra="ignore")

    claim_text: str = Field(
        ..., description="The sentence or phrase in the draft making the claim."
    )
    reference_raw: str = Field(
        ..., description="The reference being cited for this claim."
    )
    found_abstract: Optional[str] = Field(
        default=None,
        description="The actual abstract of the cited paper (from Semantic Scholar).",
    )
    verdict: Literal["supported", "overstated", "contradicted", "unverifiable"] = Field(
        ...,
        description=(
            "supported = the claim accurately reflects the paper's findings; "
            "overstated = the claim goes beyond what the paper actually shows; "
            "contradicted = the paper says something different or opposite; "
            "unverifiable = no abstract available to check against."
        ),
    )
    explanation: str = Field(
        ...,
        description="Plain-language explanation of the verdict with specific evidence.",
    )
    severity: Literal["low", "medium", "high"] = Field(
        default="medium",
        description="How serious the mismatch is if verdict is not 'supported'.",
    )


class ClaimMatchResult(BaseModel):
    """Aggregate result of the claim-to-citation matching phase."""

    model_config = ConfigDict(extra="ignore")

    total_checked: int = Field(
        ..., description="Number of claim-citation pairs that were checked."
    )
    supported_count: int = Field(default=0)
    overstated_count: int = Field(default=0)
    contradicted_count: int = Field(default=0)
    unverifiable_count: int = Field(default=0)
    verdicts: list[ClaimMatchVerdict] = Field(default_factory=list)
    score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description=(
            "Claim accuracy score. 100 = all claims accurately reflect their sources. "
            "Contradicted claims penalise heavily; overstated claims penalise moderately."
        ),
    )


# ---------------------------------------------------------------------------
# AI Writing Detection models (powered by GPTZero)
# ---------------------------------------------------------------------------


class FlaggedPassage(BaseModel):
    """A passage flagged by AI writing detection."""

    model_config = ConfigDict(extra="ignore")

    text: str = Field(..., description="The flagged text excerpt.")
    reason: str = Field(..., description="Why this passage was flagged.")
    start_char: Optional[int] = Field(
        default=None, description="Character offset in the original draft (if available)."
    )
    severity: Literal["low", "medium", "high"] = Field(
        default="medium", description="Severity of the flag."
    )


class AIWritingResult(BaseModel):
    """Result of the GPTZero AI writing detection phase."""

    model_config = ConfigDict(extra="ignore")

    score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description=(
            "GPTZero AI-likelihood score (0 = human, 100 = AI-generated). "
            "Based on perplexity and burstiness — not heuristic pattern matching."
        ),
    )
    verdict: Literal["likely_human", "uncertain", "likely_ai"] = Field(
        ...,
        description="High-level classification based on GPTZero's output.",
    )
    flagged_passages: list[FlaggedPassage] = Field(
        default_factory=list,
        description="Individual sentences GPTZero scored as likely AI-generated.",
    )
    indicators: list[str] = Field(
        default_factory=list,
        description="Specific signals from GPTZero (perplexity, burstiness, sentence-level scores).",
    )
    explanation: str = Field(
        ...,
        description="Plain-language explanation of GPTZero's findings.",
    )
    disclaimer: str = Field(
        default=(
            "Powered by GPTZero — a trained AI text classifier. "
            "Results reflect statistical patterns, not certainty. "
            "A high score does not prove AI authorship."
        ),
        description="Disclaimer about the limitations of AI detection.",
    )


# ---------------------------------------------------------------------------
# Unsupported Claims
# ---------------------------------------------------------------------------


class UnsupportedClaim(BaseModel):
    """A factual claim in the draft that appears to lack citation support."""

    model_config = ConfigDict(extra="ignore")

    text: str = Field(..., description="The unsupported claim text.")
    reason: str = Field(..., description="Why this claim appears to need a citation.")
    suggestion: Optional[str] = Field(
        default=None, description="What type of source would support this claim."
    )


# ---------------------------------------------------------------------------
# Aggregate Integrity Report
# ---------------------------------------------------------------------------


class IntegrityScores(BaseModel):
    """Numeric scores for each analysis dimension (0–100, higher = better)."""

    model_config = ConfigDict(extra="ignore")

    citation_integrity: float = Field(
        ..., ge=0.0, le=100.0,
        description="How well citations are verified and accurate (real API lookups).",
    )
    claim_accuracy: float = Field(
        ..., ge=0.0, le=100.0,
        description="How accurately draft claims reflect their cited sources.",
    )
    ai_originality: float = Field(
        ..., ge=0.0, le=100.0,
        description="GPTZero human-likelihood score (100 = likely human-written).",
    )
    overall: float = Field(
        ..., ge=0.0, le=100.0,
        description="Weighted composite integrity score.",
    )


class RecommendedFix(BaseModel):
    """A single recommended corrective action."""

    model_config = ConfigDict(extra="ignore")

    priority: Literal["high", "medium", "low"] = Field(
        ..., description="How urgently this fix should be addressed."
    )
    category: Literal["citation", "claim_match", "ai_writing", "unsupported_claim", "general"] = Field(
        ..., description="Which integrity dimension this fix addresses."
    )
    description: str = Field(..., description="Plain-language description of the fix.")
    affected_text: Optional[str] = Field(
        default=None, description="The specific text excerpt to fix (if applicable)."
    )


class IntegrityReportMetadata(BaseModel):
    """Bookkeeping metadata for the integrity report."""

    model_config = ConfigDict(extra="ignore")

    model: str = Field(..., description="Model used for analysis.")
    generated_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="UTC timestamp the report was generated.",
    )
    latency_ms: Optional[int] = Field(
        default=None, ge=0, description="Total server-side latency in milliseconds."
    )
    checks_performed: list[str] = Field(
        default_factory=list,
        description="Which checks were run.",
    )
    word_count: Optional[int] = Field(
        default=None, description="Approximate word count of the analysed draft."
    )


class IntegrityReport(BaseModel):
    """Full integrity report returned by POST /api/verify."""

    model_config = ConfigDict(extra="ignore")

    title: Optional[str] = Field(
        default=None, description="Paper title (from the request, if provided)."
    )
    scores: IntegrityScores = Field(
        ..., description="Numeric scores across all integrity dimensions."
    )
    citation_check: Optional[CitationCheckResult] = Field(
        default=None, description="Citation verification results (real API lookups)."
    )
    claim_match: Optional[ClaimMatchResult] = Field(
        default=None,
        description=(
            "Claim-to-citation matching results — checks whether draft claims "
            "accurately reflect what the cited papers actually say."
        ),
    )
    ai_writing: Optional[AIWritingResult] = Field(
        default=None, description="GPTZero AI writing detection results."
    )
    unsupported_claims: list[UnsupportedClaim] = Field(
        default_factory=list,
        description=(
            "Factual claims in the draft that appear to lack citation support. "
            "AI-assisted editorial suggestions — review in context."
        ),
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="High-level warning messages surfaced for the user.",
    )
    recommended_fixes: list[RecommendedFix] = Field(
        default_factory=list,
        description="Prioritised list of recommended corrective actions.",
    )
    metadata: IntegrityReportMetadata = Field(
        ..., description="Analysis metadata (model, timestamp, latency)."
    )
