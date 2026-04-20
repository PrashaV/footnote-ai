"""Pydantic v2 schemas for the /api/research route.

These models define the request/response contract between the frontend and
the FastAPI backend. They mirror the JSON structure produced by the Claude
service so that responses can be validated on the way out and consumed
type-safely on the way in.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class ResearchRequest(BaseModel):
    """Incoming payload for POST /api/research."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
        json_schema_extra={
            "example": {
                "topic": "Transformer architectures for long-context reasoning",
                "depth": "quick",
            }
        },
    )

    topic: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="Free-text research topic or question.",
    )
    depth: Literal["quick", "deep"] = Field(
        default="quick",
        description=(
            "Research depth. 'quick' returns a concise briefing with fewer "
            "sources; 'deep' performs a thorough survey with more papers and "
            "open questions."
        ),
    )


# ---------------------------------------------------------------------------
# Response sub-models
# ---------------------------------------------------------------------------


class Paper(BaseModel):
    """A single academic paper referenced in the research response."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Stable identifier used for citation links.")
    title: str = Field(..., description="Paper title.")
    authors: list[str] = Field(
        default_factory=list, description="Author names in publication order."
    )
    year: Optional[int] = Field(
        default=None, ge=1800, le=2100, description="Publication year."
    )
    venue: Optional[str] = Field(
        default=None, description="Journal, conference, or preprint server."
    )
    doi: Optional[str] = Field(default=None, description="Digital Object Identifier.")
    url: Optional[str] = Field(default=None, description="Canonical URL for the paper.")
    abstract: Optional[str] = Field(
        default=None, description="Paper abstract or summary."
    )
    citation_count: Optional[int] = Field(
        default=None, ge=0, description="Reported citation count if available."
    )


class KeyFinding(BaseModel):
    """A single synthesized claim with evidence and source pointers."""

    model_config = ConfigDict(extra="ignore")

    claim: str = Field(..., description="Concise statement of the finding.")
    evidence: str = Field(
        ..., description="Supporting explanation or excerpt justifying the claim."
    )
    source_ids: list[str] = Field(
        default_factory=list,
        description="IDs of Paper entries that support this finding.",
    )
    confidence: Literal["low", "medium", "high"] = Field(
        default="medium",
        description="Claude's self-reported confidence in the claim.",
    )


class ResearchMetadata(BaseModel):
    """Bookkeeping metadata attached to every response."""

    model_config = ConfigDict(extra="ignore")

    model: str = Field(..., description="Anthropic model used to generate the answer.")
    depth: Literal["quick", "deep"] = Field(
        ..., description="The depth setting used for this request."
    )
    generated_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="UTC timestamp the response was produced.",
    )
    latency_ms: Optional[int] = Field(
        default=None, ge=0, description="Total server-side latency in milliseconds."
    )
    token_usage: Optional[dict[str, int]] = Field(
        default=None,
        description="Token usage breakdown (input_tokens, output_tokens).",
    )


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------


class ResearchResponse(BaseModel):
    """Outgoing payload for POST /api/research."""

    model_config = ConfigDict(
        extra="ignore",
        json_schema_extra={
            "example": {
                "topic": "Transformer architectures for long-context reasoning",
                "summary": "Recent work explores sparse attention...",
                "key_findings": [
                    {
                        "claim": "Sparse attention scales to 1M tokens.",
                        "evidence": "Authors demonstrate linear memory ...",
                        "source_ids": ["p1"],
                        "confidence": "high",
                    }
                ],
                "papers": [
                    {
                        "id": "p1",
                        "title": "Sparse Attention at Scale",
                        "authors": ["A. Researcher"],
                        "year": 2024,
                        "venue": "NeurIPS",
                        "doi": "10.1000/example",
                        "url": "https://example.org/p1",
                        "abstract": "We propose ...",
                        "citation_count": 42,
                    }
                ],
                "open_questions": ["How does this interact with RLHF?"],
                "suggested_queries": ["sparse attention long context"],
                "metadata": {
                    "model": "claude-sonnet-4-6",
                    "depth": "quick",
                    "generated_at": "2026-04-18T12:00:00Z",
                    "latency_ms": 1830,
                    "token_usage": {"input_tokens": 512, "output_tokens": 1204},
                },
            }
        },
    )

    topic: str = Field(..., description="Echo of the requested topic.")
    summary: str = Field(
        ..., description="Executive summary of the research landscape."
    )
    key_findings: list[KeyFinding] = Field(
        default_factory=list,
        description="Synthesized claims with evidence and source pointers.",
    )
    papers: list[Paper] = Field(
        default_factory=list,
        description="Papers cited in the response, keyed by `id`.",
    )
    open_questions: list[str] = Field(
        default_factory=list,
        description="Unresolved questions worth further investigation.",
    )
    suggested_queries: list[str] = Field(
        default_factory=list,
        description="Follow-up search queries to explore the topic further.",
    )
    metadata: ResearchMetadata = Field(
        ..., description="Model and runtime metadata for this response."
    )
