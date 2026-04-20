"""Semantic Scholar service — fetches and normalises academic paper metadata.

Exposes `search_papers(topic)` which queries the public Semantic Scholar
Graph API and returns up to 20 validated Paper instances.  A simple
in-memory cache (topic-hash → results) prevents duplicate network calls for
the same query within a process lifetime.

Design goals:
  * Non-blocking I/O via httpx AsyncClient.
  * 1-second rate-limit delay injected before every live request.
  * All API failures translated into HTTPException or a safe empty list —
    callers never see raw httpx errors.
  * Results mapped directly onto the shared Paper Pydantic model so they slot
    into ResearchResponse.papers without any further conversion.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from models.research import Paper

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE_URL = "https://api.semanticscholar.org/graph/v1/paper/search"

# Fields requested from the API — must match what _map_paper reads.
_FIELDS = "title,year,authors,citationCount,externalIds,abstract"

_LIMIT = 20
_RATE_LIMIT_SECONDS = 1.0
_TIMEOUT_SECONDS = 15.0

# ---------------------------------------------------------------------------
# In-memory response cache: SHA-256(normalised topic) → list[Paper]
# ---------------------------------------------------------------------------

_cache: dict[str, list[Paper]] = {}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _topic_hash(topic: str) -> str:
    """Return a stable hex digest for the normalised topic string."""
    return hashlib.sha256(topic.strip().lower().encode()).hexdigest()


def _map_paper(raw: dict[str, Any], idx: int) -> Paper:
    """Map one Semantic Scholar paper dict onto our Paper model.

    Args:
        raw: A single element from the API ``data`` array.
        idx: Zero-based position in the result list, used to assign a stable
             short ID (p1, p2, …).

    Returns:
        A validated Paper instance.  Missing optional fields become None.
    """
    paper_id: str = raw.get("paperId") or ""
    external_ids: dict[str, str] = raw.get("externalIds") or {}

    doi: str | None = external_ids.get("DOI") or external_ids.get("doi") or None
    url: str | None = (
        f"https://www.semanticscholar.org/paper/{paper_id}" if paper_id else None
    )

    # Authors come as a list of {"authorId": …, "name": …} dicts.
    authors: list[str] = [
        a["name"]
        for a in (raw.get("authors") or [])
        if isinstance(a, dict) and a.get("name")
    ]

    title: str = (raw.get("title") or "").strip() or "Untitled"
    year: int | None = raw.get("year")
    citation_count: int | None = raw.get("citationCount")
    abstract: str | None = raw.get("abstract") or None

    return Paper(
        id=f"p{idx + 1}",
        title=title,
        authors=authors,
        year=year,
        venue=None,  # add "venue" to _FIELDS and map here if needed later
        doi=doi,
        url=url,
        abstract=abstract,
        citation_count=citation_count,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def search_papers(topic: str) -> list[Paper]:
    """Return up to 20 Paper instances for *topic* from Semantic Scholar.

    Cached results are returned immediately without hitting the network.  Live
    requests are preceded by a 1-second sleep to honour the API's rate-limit
    guidance.

    Raises:
        HTTPException 429: when Semantic Scholar itself returns 429.
        HTTPException 502: on network-level failures (timeout, connection err).

    Returns:
        A (possibly empty) list of Paper instances.  Non-200 responses that
        still parse, and genuinely empty result sets, both yield ``[]`` so
        callers can degrade gracefully rather than failing hard.
    """
    cache_key = _topic_hash(topic)
    if cache_key in _cache:
        logger.debug("Scholar cache hit for topic: %.80s", topic)
        return _cache[cache_key]

    # Respect the API's recommended 1 req/s rate limit.
    await asyncio.sleep(_RATE_LIMIT_SECONDS)

    params: dict[str, Any] = {
        "query": topic,
        "fields": _FIELDS,
        "limit": _LIMIT,
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(_BASE_URL, params=params)
    except httpx.TimeoutException as exc:
        logger.warning("Semantic Scholar request timed out: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Semantic Scholar API request timed out.",
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("Semantic Scholar network error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach Semantic Scholar API.",
        ) from exc

    if response.status_code == 429:
        logger.warning("Semantic Scholar rate limit hit (HTTP 429)")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Semantic Scholar rate limit reached. Please retry shortly.",
        )

    if response.status_code != 200:
        logger.warning(
            "Semantic Scholar returned unexpected status %d for topic '%.60s': %.200s",
            response.status_code,
            topic,
            response.text,
        )
        # Non-fatal: return empty rather than propagating a hard error so the
        # caller can still ask Claude to generate findings from its own knowledge.
        return []

    try:
        data: dict[str, Any] = response.json()
    except Exception as exc:
        logger.warning("Failed to parse Semantic Scholar JSON response: %s", exc)
        return []

    raw_papers: list[dict[str, Any]] = data.get("data") or []
    if not raw_papers:
        logger.info(
            "Semantic Scholar returned 0 results for topic: %.80s", topic
        )
        return []

    papers: list[Paper] = []
    for idx, raw in enumerate(raw_papers):
        try:
            papers.append(_map_paper(raw, idx))
        except Exception as exc:
            # Skip malformed individual entries rather than failing the whole batch.
            logger.warning("Skipping malformed paper at index %d: %s", idx, exc)

    _cache[cache_key] = papers
    logger.info(
        "Scholar search complete: %d/%d papers mapped for topic: %.80s",
        len(papers),
        len(raw_papers),
        topic,
    )
    return papers
