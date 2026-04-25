"""Pydantic v2 schemas for the /api/verify (Academic Integrity Engine) route.

These models cover all phases of integrity analysis:
  - Draft upload / parsing
  - Reference / citation extraction and verification
  - AI writing pattern detection
  - Plagiarism-risk scoring
  - Aggregate IntegrityReport with per-section scores and recommendations
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
                "check_ai_writing": True,
                "check_plagiarism_risk": True,
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
    check_ai_writing: bool = Field(
        default=True,
        description="Whether to run AI writing pattern detection.",
    )
    check_plagiarism_risk: bool = Field(
        default=True,
        description="Whether to run plagiarism-risk analysis.",
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


class CitationVerificationStatus(str):
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    HALLUCINATED = "hallucinated"
    MISMATCH = "mismatch"


class VerifiedCitation(BaseModel):
    """Result of checking a single extracted reference against external APIs."""

    model_config = ConfigDict(extra="ignore")

    reference: ExtractedReference = Field(..., description="The extracted reference.")
    status: Literal["verified", "unverified", "hallucinated", "mismatch"] = Field(
        ...,
        description=(
            "verified = found and content matches; "
            "unverified = not found in any external source; "
            "hallucinated = found but key details (authors/year/title) don't match; "
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
        description="Citation integrity score (0 = all bad, 100 = all verified).",
    )


# ---------------------------------------------------------------------------
# AI Writing Detection models
# ---------------------------------------------------------------------------


class FlaggedPassage(BaseModel):
    """A passage of text flagged during AI writing or plagiarism analysis."""

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
    """Result of the AI writing pattern detection phase."""

    model_config = ConfigDict(extra="ignore")

    score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description=(
            "AI-likelihood score. 0 = almost certainly human, "
            "100 = very likely AI-generated. "
            "This is an ESTIMATE — not a definitive determination."
        ),
    )
    verdict: Literal["likely_human", "uncertain", "likely_ai"] = Field(
        ...,
        description="High-level classification based on the score.",
    )
    flagged_passages: list[FlaggedPassage] = Field(
        default_factory=list,
        description="Specific passages that exhibit AI-like patterns.",
    )
    indicators: list[str] = Field(
        default_factory=list,
        description=(
            "List of detected AI writing indicators "
            "(e.g. 'uniform sentence length', 'excessive hedging', 'low burstiness')."
        ),
    )
    explanation: str = Field(
        ...,
        description="Plain-language explanation of the detection reasoning.",
    )
    disclaimer: str = Field(
        default=(
            "This analysis is an AI-based estimate and should not be used as "
            "definitive proof of AI authorship. Results may vary and should be "
            "interpreted alongside other evidence."
        ),
        description="Mandatory disclaimer about the limitations of AI detection.",
    )


# ---------------------------------------------------------------------------
# Plagiarism Risk models
# ---------------------------------------------------------------------------


class PlagiarismRiskResult(BaseModel):
    """Result of the plagiarism-risk analysis phase.

    NOTE: This is a risk indicator, NOT a plagiarism determination.
    It does not replace dedicated tools like Turnitin or iThenticate.
    """

    model_config = ConfigDict(extra="ignore")

    risk_score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description=(
            "Plagiarism risk score (0 = very low risk, 100 = high risk). "
            "This is a RISK INDICATOR only."
        ),
    )
    risk_level: Literal["low", "moderate", "high"] = Field(
        ..., description="Categorical risk level derived from the score."
    )
    flagged_passages: list[FlaggedPassage] = Field(
        default_factory=list,
        description="Passages with unusual phrasing, attribution gaps, or verbatim patterns.",
    )
    issues: list[str] = Field(
        default_factory=list,
        description=(
            "Specific issues found "
            "(e.g. 'missing attribution', 'unusual phrasing uniformity', "
            "'verbatim-style text without quotation marks')."
        ),
    )
    explanation: str = Field(
        ...,
        description="Plain-language explanation of the risk assessment.",
    )
    disclaimer: str = Field(
        default=(
            "This is a risk indicator only. It does not replace Turnitin, "
            "iThenticate, or other dedicated plagiarism detection tools. "
            "A high risk score does not prove plagiarism; a low score does not "
            "guarantee originality."
        ),
        description="Mandatory disclaimer about the scope of this analysis.",
    )


# ---------------------------------------------------------------------------
# Unsupported Claims
# ---------------------------------------------------------------------------


class UnsupportedClaim(BaseModel):
    """A claim in the draft that lacks visible citation support."""

    model_config = ConfigDict(extra="ignore")

    text: str = Field(..., description="The unsupported claim text.")
    reason: str = Field(..., description="Why this claim appears unsupported.")
    suggestion: Optional[str] = Field(
        default=None, description="Recommended fix or action."
    )


# ---------------------------------------------------------------------------
# Aggregate Integrity Report
# ---------------------------------------------------------------------------


class IntegrityScores(BaseModel):
    """Numeric scores for each analysis dimension (0–100, higher = better)."""

    model_config = ConfigDict(extra="ignore")

    citation_integrity: float = Field(
        ..., ge=0.0, le=100.0,
        description="How well citations are verified and accurate.",
    )
    ai_originality: float = Field(
        ..., ge=0.0, le=100.0,
        description="Likelihood the text is human-written (100 = likely human).",
    )
    plagiarism_risk: float = Field(
        ..., ge=0.0, le=100.0,
        description="Plagiarism risk (100 = low risk, 0 = high risk).",
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
    category: Literal["citation", "ai_writing", "plagiarism", "unsupported_claim", "general"] = Field(
        ..., description="Which integrity dimension this fix addresses."
    )
    description: str = Field(..., description="Plain-language description of the fix.")
    affected_text: Optional[str] = Field(
        default=None, description="The specific text excerpt to fix (if applicable)."
    )


class IntegrityReportMetadata(BaseModel):
    """Bookkeeping metadata for the integrity report."""

    model_config = ConfigDict(extra="ignore")

    model: str = Field(..., description="Anthropic model used for analysis.")
    generated_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="UTC timestamp the report was generated.",
    )
    latency_ms: Optional[int] = Field(
        default=None, ge=0, description="Total server-side latency in milliseconds."
    )
    checks_performed: list[str] = Field(
        default_factory=list,
        description="Which checks were run (citation, ai_writing, plagiarism_risk).",
    )
    word_count: Optional[int] = Field(
        default=None, description="Approximate word count of the analyzed draft."
    )


class IntegrityReport(BaseModel):
    """Full integrity report returned by POST /api/verify."""

    model_config = ConfigDict(
        extra="ignore",
        json_schema_extra={
            "example": {
                "title": "My Research Draft",
                "scores": {
                    "citation_integrity": 82.0,
                    "ai_originality": 91.0,
                    "plagiarism_risk": 78.0,
                    "overall": 84.0,
                },
                "warnings": ["2 references could not be verified"],
                "recommended_fixes": [
                    {
                        "priority": "high",
                        "category": "citation",
                        "description": "Verify or replace the unverified Smith (2019) reference.",
                        "affected_text": "Smith et al. (2019) argue that ...",
                    }
                ],
            }
        },
    )

    title: Optional[str] = Field(
        default=None, description="Paper title (from the request, if provided)."
    )
    scores: IntegrityScores = Field(
        ..., description="Numeric scores across all integrity dimensions."
    )
    citation_check: Optional[CitationCheckResult] = Field(
        default=None, description="Citation verification results."
    )
    ai_writing: Optional[AIWritingResult] = Field(
        default=None, description="AI writing detection results."
    )
    plagiarism_risk: Optional[PlagiarismRiskResult] = Field(
        default=None, description="Plagiarism risk analysis results."
    )
    unsupported_claims: list[UnsupportedClaim] = Field(
        default_factory=list,
        description="Claims in the draft that lack visible citation support.",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="High-level warning messages surfaced for the user.",
    )
    recommended_fixes: list[RecommendedFix] = Field(
        default_factory=list,
        description="Prioritized list of recommended corrective actions.",
    )
    metadata: IntegrityReportMetadata = Field(
        ..., description="Analysis metadata (model, timestamp, latency)."
    )
