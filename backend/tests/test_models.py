"""Unit tests for the Pydantic request/response models in models/research.py.

Covers:
  * ResearchRequest — valid inputs, invalid depth, missing topic, topic
    length bounds, and extra-field rejection.
  * Paper, KeyFinding, ResearchMetadata — field defaults and constraints.
  * ResearchResponse — round-trip construction with all sub-models.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from models.research import (
    KeyFinding,
    Paper,
    ResearchMetadata,
    ResearchRequest,
    ResearchResponse,
)


# ---------------------------------------------------------------------------
# ResearchRequest
# ---------------------------------------------------------------------------


class TestResearchRequestValid:
    """ResearchRequest accepts well-formed payloads."""

    def test_minimal_valid_request(self) -> None:
        req = ResearchRequest(topic="quantum computing")
        assert req.topic == "quantum computing"
        assert req.depth == "quick"  # default

    def test_explicit_quick_depth(self) -> None:
        req = ResearchRequest(topic="machine learning basics", depth="quick")
        assert req.depth == "quick"

    def test_explicit_deep_depth(self) -> None:
        req = ResearchRequest(topic="transformer attention mechanisms", depth="deep")
        assert req.depth == "deep"

    def test_whitespace_stripped_from_topic(self) -> None:
        req = ResearchRequest(topic="  neural networks  ")
        assert req.topic == "neural networks"

    def test_topic_at_min_length(self) -> None:
        req = ResearchRequest(topic="abc")  # exactly 3 chars
        assert req.topic == "abc"

    def test_topic_at_max_length(self) -> None:
        long_topic = "a" * 500
        req = ResearchRequest(topic=long_topic)
        assert len(req.topic) == 500

    def test_model_dump_round_trip(self) -> None:
        data = {"topic": "CRISPR gene editing", "depth": "deep"}
        req = ResearchRequest(**data)
        dumped = req.model_dump()
        assert dumped["topic"] == "CRISPR gene editing"
        assert dumped["depth"] == "deep"


class TestResearchRequestInvalid:
    """ResearchRequest raises ValidationError on bad payloads."""

    def test_missing_topic_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            ResearchRequest()  # type: ignore[call-arg]
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("topic",) for e in errors)

    def test_none_topic_raises(self) -> None:
        with pytest.raises(ValidationError):
            ResearchRequest(topic=None)  # type: ignore[arg-type]

    def test_topic_too_short_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            ResearchRequest(topic="ab")  # 2 chars — below min_length=3
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("topic",) for e in errors)

    def test_topic_too_long_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            ResearchRequest(topic="x" * 501)  # exceeds max_length=500
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("topic",) for e in errors)

    def test_empty_string_topic_raises(self) -> None:
        """Empty string stripped → length 0, below min_length=3."""
        with pytest.raises(ValidationError):
            ResearchRequest(topic="")

    def test_whitespace_only_topic_raises(self) -> None:
        """Whitespace-only string is stripped to '' → too short."""
        with pytest.raises(ValidationError):
            ResearchRequest(topic="   ")

    def test_invalid_depth_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            ResearchRequest(topic="valid topic", depth="medium")  # type: ignore[arg-type]
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("depth",) for e in errors)

    def test_numeric_depth_raises(self) -> None:
        with pytest.raises(ValidationError):
            ResearchRequest(topic="valid topic", depth=1)  # type: ignore[arg-type]

    def test_extra_fields_forbidden(self) -> None:
        """extra='forbid' must reject unknown keys."""
        with pytest.raises(ValidationError) as exc_info:
            ResearchRequest(topic="valid topic", unknown_field="oops")  # type: ignore[call-arg]
        errors = exc_info.value.errors()
        assert any("unknown_field" in str(e) for e in errors)


# ---------------------------------------------------------------------------
# Paper
# ---------------------------------------------------------------------------


class TestPaper:
    """Paper model optional fields and defaults."""

    def test_minimal_paper(self) -> None:
        paper = Paper(id="p1", title="Some Title")
        assert paper.id == "p1"
        assert paper.title == "Some Title"
        assert paper.authors == []
        assert paper.year is None
        assert paper.doi is None
        assert paper.url is None
        assert paper.abstract is None
        assert paper.citation_count is None

    def test_full_paper(self) -> None:
        paper = Paper(
            id="p2",
            title="Attention Is All You Need",
            authors=["Vaswani", "Shazeer"],
            year=2017,
            venue="NeurIPS",
            doi="10.48550/arXiv.1706.03762",
            url="https://arxiv.org/abs/1706.03762",
            abstract="We propose a new architecture...",
            citation_count=90000,
        )
        assert paper.year == 2017
        assert len(paper.authors) == 2
        assert paper.citation_count == 90000

    def test_year_lower_bound(self) -> None:
        with pytest.raises(ValidationError):
            Paper(id="p3", title="Old Paper", year=1799)

    def test_year_upper_bound(self) -> None:
        with pytest.raises(ValidationError):
            Paper(id="p4", title="Future Paper", year=2101)

    def test_negative_citation_count_raises(self) -> None:
        with pytest.raises(ValidationError):
            Paper(id="p5", title="Bad Count", citation_count=-1)

    def test_extra_fields_ignored(self) -> None:
        """Paper uses extra='ignore', so unknown keys are silently dropped."""
        paper = Paper(id="p6", title="Extra Fields", unknown="value")  # type: ignore[call-arg]
        assert not hasattr(paper, "unknown")


# ---------------------------------------------------------------------------
# KeyFinding
# ---------------------------------------------------------------------------


class TestKeyFinding:
    """KeyFinding model constraints."""

    def test_valid_key_finding(self) -> None:
        kf = KeyFinding(
            claim="Transformers outperform RNNs on long sequences.",
            evidence="Vaswani et al. show BLEU improvements on WMT14.",
            source_ids=["p1", "p2"],
            confidence="high",
        )
        assert kf.confidence == "high"
        assert "p1" in kf.source_ids

    def test_default_confidence_is_medium(self) -> None:
        kf = KeyFinding(claim="Some claim.", evidence="Some evidence.")
        assert kf.confidence == "medium"

    def test_default_source_ids_empty(self) -> None:
        kf = KeyFinding(claim="Claim.", evidence="Evidence.")
        assert kf.source_ids == []

    def test_invalid_confidence_raises(self) -> None:
        with pytest.raises(ValidationError):
            KeyFinding(claim="Claim.", evidence="Evidence.", confidence="very-high")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# ResearchMetadata
# ---------------------------------------------------------------------------


class TestResearchMetadata:
    """ResearchMetadata required fields and defaults."""

    def test_valid_metadata(self) -> None:
        meta = ResearchMetadata(model="claude-sonnet-4-6", depth="quick")
        assert meta.model == "claude-sonnet-4-6"
        assert meta.depth == "quick"
        assert meta.latency_ms is None
        assert meta.token_usage is None
        assert meta.generated_at is not None  # default_factory


# ---------------------------------------------------------------------------
# ResearchResponse
# ---------------------------------------------------------------------------


class TestResearchResponse:
    """ResearchResponse full construction."""

    def _make_response_dict(self) -> dict:
        from datetime import datetime

        return {
            "topic": "Neural scaling laws",
            "summary": "Models improve predictably with compute.",
            "key_findings": [
                {
                    "claim": "Loss follows a power law.",
                    "evidence": "Kaplan et al. 2020 demonstrate ...",
                    "source_ids": ["p1"],
                    "confidence": "high",
                }
            ],
            "papers": [
                {
                    "id": "p1",
                    "title": "Scaling Laws for Neural Language Models",
                    "authors": ["Kaplan", "McCandlish"],
                    "year": 2020,
                }
            ],
            "open_questions": ["Does this hold for multimodal models?"],
            "suggested_queries": ["scaling laws transformer"],
            "metadata": {
                "model": "claude-sonnet-4-6",
                "depth": "quick",
                "generated_at": datetime.utcnow().isoformat(),
            },
        }

    def test_full_response_validates(self) -> None:
        resp = ResearchResponse.model_validate(self._make_response_dict())
        assert resp.topic == "Neural scaling laws"
        assert len(resp.papers) == 1
        assert len(resp.key_findings) == 1
        assert resp.metadata.model == "claude-sonnet-4-6"

    def test_missing_summary_raises(self) -> None:
        data = self._make_response_dict()
        del data["summary"]
        with pytest.raises(ValidationError):
            ResearchResponse.model_validate(data)

    def test_missing_metadata_raises(self) -> None:
        data = self._make_response_dict()
        del data["metadata"]
        with pytest.raises(ValidationError):
            ResearchResponse.model_validate(data)

    def test_empty_lists_default(self) -> None:
        """Papers, findings, open_questions, suggested_queries default to []."""
        from datetime import datetime

        data = {
            "topic": "Minimal topic",
            "summary": "Brief summary.",
            "metadata": {
                "model": "claude-haiku-4-5-20251001",
                "depth": "quick",
                "generated_at": datetime.utcnow().isoformat(),
            },
        }
        resp = ResearchResponse.model_validate(data)
        assert resp.papers == []
        assert resp.key_findings == []
        assert resp.open_questions == []
        assert resp.suggested_queries == []
