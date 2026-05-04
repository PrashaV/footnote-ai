"""Pydantic v2 schemas for the POST /api/integrity/analyze endpoint.

Each of the four integrity engines returns a CheckResult with a normalised
0–1 score, a flagged boolean, character-range flagged sections, a confidence
value, and a human-readable summary.

Phase 4.1 — skeleton only. Engine implementations follow in 4.2–4.5.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class CitationRef(BaseModel):
    """A citation attached to the document, passed in from the frontend."""

    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = Field(default=None, description="Supabase citation UUID (if persisted).")
    paper_id: Optional[str] = Field(default=None, description="Semantic Scholar paper ID.")
    raw_text: Optional[str] = Field(default=None, description="Raw citation text as it appears in the document.")
    title: Optional[str] = Field(default=None, description="Parsed paper title.")
    authors: list[str] = Field(default_factory=list, description="Parsed author names.")
    year: Optional[int] = Field(default=None, description="Publication year.")
    doi: Optional[str] = Field(default=None, description="DOI if available.")
    url: Optional[str] = Field(default=None, description="URL if available.")


class IntegrityAnalyzeRequest(BaseModel):
    """Incoming payload for POST /api/integrity/analyze."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
        json_schema_extra={
            "example": {
                "document_id": "550e8400-e29b-41d4-a716-446655440000",
                "content": "According to Smith et al. (2022), machine learning models...",
                "citations": [
                    {
                        "id": "abc123",
                        "title": "Deep Learning at Scale",
                        "authors": ["Smith, J.", "Doe, A."],
                        "year": 2022,
                        "doi": "10.1000/example",
                    }
                ],
            }
        },
    )

    document_id: str = Field(
        ...,
        description="Supabase document UUID — used to key results in integrity_results table.",
    )
    content: str = Field(
        ...,
        min_length=10,
        max_length=100_000,
        description="Full plain-text content of the document.",
    )
    citations: list[CitationRef] = Field(
        default_factory=list,
        description="Citations attached to this document (from the citations table).",
    )


# ---------------------------------------------------------------------------
# Per-check result
# ---------------------------------------------------------------------------


class FlaggedSection(BaseModel):
    """A character-range region flagged by an integrity check."""

    model_config = ConfigDict(extra="ignore")

    start_char: int = Field(..., ge=0, description="Start character offset in the document content.")
    end_char: int = Field(..., ge=0, description="End character offset (exclusive).")
    reason: str = Field(..., description="Human-readable explanation of why this section was flagged.")


class FlaggedCitation(BaseModel):
    """A single citation issue found by the citation check engine."""

    model_config = ConfigDict(extra="ignore")

    citation_text: str = Field(..., description="The citation reference text (truncated to 120 chars).")
    issue_type: str = Field(
        ...,
        description=(
            "Machine-readable issue category: "
            "'format_error' | 'doi_not_found' | 'title_mismatch' | 'author_mismatch' | "
            "'retracted' | 'quote_mismatch' | 'predatory_journal' | 'missing_field'"
        ),
    )
    detail: str = Field(..., description="Plain-English explanation of the issue shown in the UI.")
    severity: str = Field(..., description="'high' | 'medium' | 'low'")


class CheckResult(BaseModel):
    """Normalised result from a single integrity check engine.

    score:            0.0 (worst) → 1.0 (best / most trustworthy)
                      Exception: ai_detection uses score as AI-likelihood (0 = human, 1 = AI).
    flagged:          True if the check found something worth reviewing
    flagged_sections: Zero or more character ranges in the source document
    confidence:       How certain the engine is (0.0 = uncertain, 1.0 = certain)
    summary:          One or two sentences for display in the UI
    method:           Optional engine/algorithm identifier (e.g. "perplexity+burstiness")
    """

    model_config = ConfigDict(extra="ignore")

    score: float = Field(..., ge=0.0, le=1.0)
    flagged: bool
    flagged_sections: list[FlaggedSection] = Field(default_factory=list)
    confidence: float = Field(..., ge=0.0, le=1.0)
    summary: str
    method: Optional[str] = Field(
        default=None,
        description="Identifier for the algorithm / data source used (e.g. 'perplexity+burstiness').",
    )
    flagged_citations: list[FlaggedCitation] = Field(
        default_factory=list,
        description="Per-citation issues found by the citation check engine (Phase 4.3+).",
    )


# ---------------------------------------------------------------------------
# Combined response
# ---------------------------------------------------------------------------


class IntegrityAnalyzeResponse(BaseModel):
    """Full result returned by POST /api/integrity/analyze."""

    model_config = ConfigDict(extra="ignore")

    document_id: str
    ai_detection: CheckResult = Field(..., description="AI-generated text detection result.")
    citation_check: CheckResult = Field(..., description="Citation existence and accuracy result.")
    plagiarism_check: CheckResult = Field(..., description="Plagiarism / text-similarity result.")
    claim_match: CheckResult = Field(..., description="Claim-to-source matching result.")
