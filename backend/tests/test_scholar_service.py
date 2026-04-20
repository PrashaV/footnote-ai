"""Tests for services/scholar_service.py.

All network calls are intercepted with unittest.mock so no real HTTP traffic
is sent.  The module-level ``_cache`` is wiped before each test by the
``clear_scholar_cache`` fixture in conftest.py.

Strategy
--------
* Patch ``httpx.AsyncClient`` at the point it is used inside scholar_service.
* Also patch ``asyncio.sleep`` so tests don't actually wait 1 second.
* Use ``pytest.mark.asyncio`` for every coroutine test.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from models.research import Paper
from services import scholar_service


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raw_paper(
    *,
    paper_id: str = "abc123",
    title: str = "Deep Learning Survey",
    authors: list[str] | None = None,
    year: int | None = 2023,
    citation_count: int | None = 42,
    doi: str | None = "10.1000/xyz",
    abstract: str | None = "A survey of deep learning.",
) -> dict:
    """Build a minimal Semantic Scholar API paper dict."""
    return {
        "paperId": paper_id,
        "title": title,
        "authors": [{"authorId": f"a{i}", "name": name} for i, name in enumerate(authors or ["Alice", "Bob"])],
        "year": year,
        "citationCount": citation_count,
        "externalIds": {"DOI": doi} if doi else {},
        "abstract": abstract,
    }


def _make_response(papers: list[dict], status_code: int = 200) -> MagicMock:
    """Build a mock httpx.Response-like object."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = {"data": papers, "total": len(papers)}
    resp.text = json.dumps({"data": papers})
    return resp


def _mock_client(response: MagicMock) -> MagicMock:
    """Return an AsyncClient mock whose .get() returns *response*."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=response)
    # Support async context manager (__aenter__ / __aexit__).
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=None)
    return ctx


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSearchPapersShape:
    """Correct Paper objects are returned for a successful API response."""

    @pytest.mark.asyncio
    async def test_returns_list_of_paper_instances(self) -> None:
        raw = _make_raw_paper()
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("deep learning")

        assert isinstance(papers, list)
        assert len(papers) == 1
        assert isinstance(papers[0], Paper)

    @pytest.mark.asyncio
    async def test_paper_id_uses_position_prefix(self) -> None:
        """IDs must be p1, p2, … regardless of the Scholar paperId."""
        raw_papers = [_make_raw_paper(paper_id=f"id{i}") for i in range(3)]
        resp = _make_response(raw_papers)

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert [p.id for p in papers] == ["p1", "p2", "p3"]

    @pytest.mark.asyncio
    async def test_paper_title_mapped(self) -> None:
        raw = _make_raw_paper(title="Attention Is All You Need")
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("transformers")

        assert papers[0].title == "Attention Is All You Need"

    @pytest.mark.asyncio
    async def test_paper_authors_mapped(self) -> None:
        raw = _make_raw_paper(authors=["Alice Smith", "Bob Jones"])
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("neural nets")

        assert papers[0].authors == ["Alice Smith", "Bob Jones"]

    @pytest.mark.asyncio
    async def test_paper_year_mapped(self) -> None:
        raw = _make_raw_paper(year=2021)
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers[0].year == 2021

    @pytest.mark.asyncio
    async def test_paper_doi_mapped(self) -> None:
        raw = _make_raw_paper(doi="10.9999/test")
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers[0].doi == "10.9999/test"

    @pytest.mark.asyncio
    async def test_paper_url_uses_scholar_id(self) -> None:
        raw = _make_raw_paper(paper_id="abc789")
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers[0].url == "https://www.semanticscholar.org/paper/abc789"

    @pytest.mark.asyncio
    async def test_paper_citation_count_mapped(self) -> None:
        raw = _make_raw_paper(citation_count=1337)
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers[0].citation_count == 1337

    @pytest.mark.asyncio
    async def test_paper_abstract_mapped(self) -> None:
        raw = _make_raw_paper(abstract="This paper explores ...")
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers[0].abstract == "This paper explores ..."

    @pytest.mark.asyncio
    async def test_missing_optional_fields_become_none(self) -> None:
        raw = {"paperId": "x", "title": "No optionals", "authors": [], "year": None,
               "citationCount": None, "externalIds": {}, "abstract": None}
        resp = _make_response([raw])

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        p = papers[0]
        assert p.year is None
        assert p.doi is None
        assert p.citation_count is None
        assert p.abstract is None


class TestSearchPapersEmptyResults:
    """Empty result cases return [] without raising."""

    @pytest.mark.asyncio
    async def test_empty_data_array_returns_empty_list(self) -> None:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = {"data": [], "total": 0}
        resp.text = '{"data": []}'

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("obscure topic xyz")

        assert papers == []

    @pytest.mark.asyncio
    async def test_missing_data_key_returns_empty_list(self) -> None:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = {}  # no "data" key
        resp.text = "{}"

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers == []

    @pytest.mark.asyncio
    async def test_non_200_non_429_returns_empty_list(self) -> None:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 503
        resp.json.return_value = {}
        resp.text = "Service Unavailable"

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers == []

    @pytest.mark.asyncio
    async def test_malformed_json_returns_empty_list(self) -> None:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.side_effect = ValueError("invalid JSON")
        resp.text = "not json"

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers = await scholar_service.search_papers("topic")

        assert papers == []


class TestSearchPapersNetworkErrors:
    """Network failures raise HTTPException without crashing the service."""

    @pytest.mark.asyncio
    async def test_timeout_raises_http_502(self) -> None:
        from fastapi import HTTPException

        client_ctx = AsyncMock()
        client = AsyncMock()
        client.get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
        client_ctx.__aenter__ = AsyncMock(return_value=client)
        client_ctx.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=client_ctx),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await scholar_service.search_papers("topic")

        assert exc_info.value.status_code == 502

    @pytest.mark.asyncio
    async def test_connection_error_raises_http_502(self) -> None:
        from fastapi import HTTPException

        client_ctx = AsyncMock()
        client = AsyncMock()
        client.get = AsyncMock(
            side_effect=httpx.ConnectError("connection refused")
        )
        client_ctx.__aenter__ = AsyncMock(return_value=client)
        client_ctx.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=client_ctx),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await scholar_service.search_papers("topic")

        assert exc_info.value.status_code == 502

    @pytest.mark.asyncio
    async def test_rate_limit_429_raises_http_429(self) -> None:
        from fastapi import HTTPException

        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 429
        resp.json.return_value = {}
        resp.text = "Too Many Requests"

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=_mock_client(resp)),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await scholar_service.search_papers("topic")

        assert exc_info.value.status_code == 429


class TestSearchPapersCache:
    """In-memory cache prevents duplicate network calls."""

    @pytest.mark.asyncio
    async def test_cache_hit_skips_network(self) -> None:
        raw = _make_raw_paper()
        resp = _make_response([raw])
        client_ctx = _mock_client(resp)

        with (
            patch("services.scholar_service.httpx.AsyncClient", return_value=client_ctx),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            first = await scholar_service.search_papers("caching topic")
            second = await scholar_service.search_papers("caching topic")

        # Network should have been called exactly once.
        assert client_ctx.__aenter__.call_count == 1
        assert first == second

    @pytest.mark.asyncio
    async def test_different_topics_hit_network_separately(self) -> None:
        resp_a = _make_response([_make_raw_paper(title="Paper A")])
        resp_b = _make_response([_make_raw_paper(title="Paper B")])

        call_count = 0

        class _SequentialClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def get(self, *args, **kwargs):
                nonlocal call_count
                call_count += 1
                return resp_a if call_count == 1 else resp_b

        with (
            patch("services.scholar_service.httpx.AsyncClient", _SequentialClient),
            patch("services.scholar_service.asyncio.sleep", new_callable=AsyncMock),
        ):
            papers_a = await scholar_service.search_papers("topic alpha")
            papers_b = await scholar_service.search_papers("topic beta")

        assert papers_a[0].title == "Paper A"
        assert papers_b[0].title == "Paper B"
        assert call_count == 2
