"""Integration tests for the FastAPI routes in main.py.

Uses an ``httpx.AsyncClient`` backed by the ASGI app (via ``ASGITransport``)
so that real HTTP sockets are never opened and the full request/response
pipeline — middleware, validation, serialisation — is exercised.

The ``async_client`` fixture is defined in conftest.py.

Strategy
--------
* All calls to ``services.claude_service.get_research`` are patched with
  ``unittest.mock.AsyncMock`` so no real Anthropic API calls are made.
* The mock returns a fully-valid ``ResearchResponse`` object that the route
  serialises and returns to the client.
* Tests cover:
    - GET /         → 200 with service meta fields
    - GET /health   → 200 with {"status": "ok"}
    - POST /api/research (valid body, quick depth)  → 200 + ResearchResponse shape
    - POST /api/research (valid body, deep depth)   → 200 + ResearchResponse shape
    - POST /api/research (missing topic)            → 422
    - POST /api/research (topic too short)          → 422
    - POST /api/research (invalid depth value)      → 422
    - POST /api/research (extra unknown field)      → 422
    - POST /api/research (empty JSON body)          → 422
    - POST /api/export  (valid ResearchResponse)    → 200 + .docx content-type
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from models.research import (
    KeyFinding,
    Paper,
    ResearchMetadata,
    ResearchResponse,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_research_response(
    topic: str = "quantum computing",
    depth: str = "quick",
) -> ResearchResponse:
    """Build a minimal but fully-valid ResearchResponse for mocking."""
    return ResearchResponse(
        topic=topic,
        summary="Quantum computing leverages quantum mechanical phenomena.",
        key_findings=[
            KeyFinding(
                claim="Quantum computers outperform classical ones for certain tasks.",
                evidence="Shor's algorithm factors large integers in polynomial time.",
                source_ids=["p1"],
                confidence="high",
            )
        ],
        papers=[
            Paper(
                id="p1",
                title="Quantum Computing: An Overview",
                authors=["Alice Researcher", "Bob Scientist"],
                year=2022,
                venue="Nature",
                citation_count=512,
            )
        ],
        open_questions=["Can fault-tolerant quantum computers be built at scale?"],
        suggested_queries=["quantum error correction", "superconducting qubits"],
        metadata=ResearchMetadata(
            model="claude-sonnet-4-6",
            depth=depth,  # type: ignore[arg-type]
            generated_at=datetime.now(tz=timezone.utc),
            latency_ms=350,
            token_usage={"input_tokens": 800, "output_tokens": 600},
        ),
    )


# ---------------------------------------------------------------------------
# Meta routes
# ---------------------------------------------------------------------------


class TestMetaRoutes:
    """GET / and GET /health sanity checks."""

    @pytest.mark.asyncio
    async def test_root_returns_200(self, async_client) -> None:
        response = await async_client.get("/")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_root_contains_service_name(self, async_client) -> None:
        response = await async_client.get("/")
        body = response.json()
        assert body["service"] == "Footnote API"

    @pytest.mark.asyncio
    async def test_root_contains_status_ok(self, async_client) -> None:
        response = await async_client.get("/")
        body = response.json()
        assert body["status"] == "ok"

    @pytest.mark.asyncio
    async def test_root_contains_version(self, async_client) -> None:
        response = await async_client.get("/")
        body = response.json()
        assert "version" in body

    @pytest.mark.asyncio
    async def test_health_returns_200(self, async_client) -> None:
        response = await async_client.get("/health")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_health_body_is_ok(self, async_client) -> None:
        response = await async_client.get("/health")
        assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# POST /api/research — success paths
# ---------------------------------------------------------------------------


class TestResearchRouteSuccess:
    """POST /api/research with valid payloads returns 200 + ResearchResponse."""

    @pytest.mark.asyncio
    async def test_valid_quick_request_returns_200(self, async_client) -> None:
        mock_response = _make_research_response(depth="quick")

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing", "depth": "quick"},
            )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_valid_deep_request_returns_200(self, async_client) -> None:
        mock_response = _make_research_response(depth="deep")

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "transformer attention mechanisms", "depth": "deep"},
            )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_response_has_topic_field(self, async_client) -> None:
        mock_response = _make_research_response(topic="neural scaling laws")

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "neural scaling laws"},
            )

        body = response.json()
        assert body["topic"] == "neural scaling laws"

    @pytest.mark.asyncio
    async def test_response_has_summary_field(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        body = response.json()
        assert "summary" in body
        assert isinstance(body["summary"], str)
        assert len(body["summary"]) > 0

    @pytest.mark.asyncio
    async def test_response_has_papers_list(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        body = response.json()
        assert "papers" in body
        assert isinstance(body["papers"], list)

    @pytest.mark.asyncio
    async def test_response_papers_have_required_shape(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        papers = response.json()["papers"]
        assert len(papers) >= 1
        first = papers[0]
        assert "id" in first
        assert "title" in first
        assert "authors" in first

    @pytest.mark.asyncio
    async def test_response_has_key_findings(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        body = response.json()
        assert "key_findings" in body
        assert isinstance(body["key_findings"], list)

    @pytest.mark.asyncio
    async def test_response_key_findings_have_required_shape(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        findings = response.json()["key_findings"]
        assert len(findings) >= 1
        first = findings[0]
        assert "claim" in first
        assert "evidence" in first
        assert "confidence" in first

    @pytest.mark.asyncio
    async def test_response_has_metadata(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        body = response.json()
        assert "metadata" in body
        meta = body["metadata"]
        assert "model" in meta
        assert "depth" in meta
        assert "generated_at" in meta

    @pytest.mark.asyncio
    async def test_response_has_open_questions(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        body = response.json()
        assert "open_questions" in body
        assert isinstance(body["open_questions"], list)

    @pytest.mark.asyncio
    async def test_response_has_suggested_queries(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        body = response.json()
        assert "suggested_queries" in body
        assert isinstance(body["suggested_queries"], list)

    @pytest.mark.asyncio
    async def test_default_depth_is_quick(self, async_client) -> None:
        """Omitting depth should default to 'quick' and the service is called."""
        mock_response = _make_research_response(depth="quick")
        mock_get_research = AsyncMock(return_value=mock_response)

        with patch("main.get_research", new=mock_get_research):
            response = await async_client.post(
                "/api/research",
                json={"topic": "machine learning"},
            )

        assert response.status_code == 200
        # Verify the service was called with depth="quick" (the default).
        _, kwargs = mock_get_research.call_args
        assert kwargs.get("depth") == "quick"

    @pytest.mark.asyncio
    async def test_get_research_called_with_correct_topic(self, async_client) -> None:
        mock_response = _make_research_response(topic="CRISPR gene editing")
        mock_get_research = AsyncMock(return_value=mock_response)

        with patch("main.get_research", new=mock_get_research):
            await async_client.post(
                "/api/research",
                json={"topic": "CRISPR gene editing", "depth": "deep"},
            )

        mock_get_research.assert_called_once()
        _, kwargs = mock_get_research.call_args
        assert kwargs.get("topic") == "CRISPR gene editing"
        assert kwargs.get("depth") == "deep"

    @pytest.mark.asyncio
    async def test_response_is_valid_json(self, async_client) -> None:
        mock_response = _make_research_response()

        with patch("main.get_research", new=AsyncMock(return_value=mock_response)):
            response = await async_client.post(
                "/api/research",
                json={"topic": "quantum computing"},
            )

        # If this raises, the body is not valid JSON — test will fail naturally.
        body = response.json()
        assert isinstance(body, dict)


# ---------------------------------------------------------------------------
# POST /api/research — validation error paths (422)
# ---------------------------------------------------------------------------


class TestResearchRouteValidation:
    """POST /api/research with malformed payloads returns 422 Unprocessable Entity."""

    @pytest.mark.asyncio
    async def test_missing_topic_returns_422(self, async_client) -> None:
        response = await async_client.post(
            "/api/research",
            json={"depth": "quick"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_missing_topic_error_points_to_topic_field(self, async_client) -> None:
        response = await async_client.post(
            "/api/research",
            json={"depth": "quick"},
        )
        detail = response.json()["detail"]
        # FastAPI/Pydantic v2 reports the field location in the error list.
        locs = [str(e["loc"]) for e in detail]
        assert any("topic" in loc for loc in locs)

    @pytest.mark.asyncio
    async def test_empty_body_returns_422(self, async_client) -> None:
        response = await async_client.post(
            "/api/research",
            json={},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_topic_too_short_returns_422(self, async_client) -> None:
        """Two-character topic is below min_length=3."""
        response = await async_client.post(
            "/api/research",
            json={"topic": "ab"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_topic_too_long_returns_422(self, async_client) -> None:
        """501-character topic exceeds max_length=500."""
        response = await async_client.post(
            "/api/research",
            json={"topic": "x" * 501},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_whitespace_only_topic_returns_422(self, async_client) -> None:
        """Whitespace-only topic is stripped to '' → too short."""
        response = await async_client.post(
            "/api/research",
            json={"topic": "   "},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_depth_returns_422(self, async_client) -> None:
        """'medium' is not an accepted depth value."""
        response = await async_client.post(
            "/api/research",
            json={"topic": "valid topic", "depth": "medium"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_numeric_depth_returns_422(self, async_client) -> None:
        response = await async_client.post(
            "/api/research",
            json={"topic": "valid topic", "depth": 1},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_extra_fields_return_422(self, async_client) -> None:
        """ResearchRequest has extra='forbid'; unknown keys must cause 422."""
        response = await async_client.post(
            "/api/research",
            json={"topic": "valid topic", "sneaky_field": "oops"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_null_topic_returns_422(self, async_client) -> None:
        response = await async_client.post(
            "/api/research",
            json={"topic": None},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_non_json_content_type_returns_error(self, async_client) -> None:
        """Sending plain text instead of JSON should result in a 4xx error."""
        response = await async_client.post(
            "/api/research",
            content=b"topic=quantum computing",
            headers={"Content-Type": "text/plain"},
        )
        assert response.status_code in (400, 415, 422)


# ---------------------------------------------------------------------------
# POST /api/export — basic smoke test
# ---------------------------------------------------------------------------


class TestExportRoute:
    """POST /api/export returns a .docx binary on valid ResearchResponse input."""

    def _make_export_payload(self) -> dict[str, Any]:
        return {
            "topic": "quantum computing",
            "summary": "An introduction to quantum computing.",
            "key_findings": [
                {
                    "claim": "Quantum supremacy has been demonstrated.",
                    "evidence": "Google's Sycamore processor (2019).",
                    "source_ids": ["p1"],
                    "confidence": "high",
                }
            ],
            "papers": [
                {
                    "id": "p1",
                    "title": "Quantum supremacy using a programmable superconducting processor",
                    "authors": ["Arute et al."],
                    "year": 2019,
                }
            ],
            "open_questions": ["Will room-temperature quantum computers be viable?"],
            "suggested_queries": ["quantum error correction"],
            "metadata": {
                "model": "claude-sonnet-4-6",
                "depth": "quick",
                "generated_at": "2024-01-01T00:00:00Z",
            },
        }

    @pytest.mark.asyncio
    async def test_export_returns_200(self, async_client) -> None:
        response = await async_client.post(
            "/api/export",
            json=self._make_export_payload(),
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_export_content_type_is_docx(self, async_client) -> None:
        response = await async_client.post(
            "/api/export",
            json=self._make_export_payload(),
        )
        assert "wordprocessingml.document" in response.headers.get("content-type", "")

    @pytest.mark.asyncio
    async def test_export_content_disposition_has_filename(self, async_client) -> None:
        response = await async_client.post(
            "/api/export",
            json=self._make_export_payload(),
        )
        disposition = response.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert ".docx" in disposition

    @pytest.mark.asyncio
    async def test_export_missing_summary_returns_422(self, async_client) -> None:
        payload = self._make_export_payload()
        del payload["summary"]
        response = await async_client.post("/api/export", json=payload)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_export_missing_metadata_returns_422(self, async_client) -> None:
        payload = self._make_export_payload()
        del payload["metadata"]
        response = await async_client.post("/api/export", json=payload)
        assert response.status_code == 422
