"""Citation search service — lightweight Semantic Scholar proxy for the
Footnote Workspace editor's @ citation autocomplete feature.

Intentionally separate from scholar_service.py which fetches 20 papers for
deep research synthesis.  This service:
  - Returns at most 5 results (fast dropdown UX)
  - Requests only the fields needed for inline citation display
  - Does NOT cache (queries are user-typed partial strings; results change fast)
  - Does NOT enforce the 1-second rate limit (user is typing; latency matters)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE_URL   = "https://api.semanticscholar.org/graph/v1/paper/search"
_FIELDS     = "title,authors,year,externalIds"
_LIMIT      = 5
_TIMEOUT    = 8.0   # seconds — short so the dropdown feels snappy


# ---------------------------------------------------------------------------
# Data class returned to the route
# ---------------------------------------------------------------------------

@dataclass
class CitationResult:
    paper_id:     str
    title:        str
    authors:      list[str]
    year:         int | None
    doi:          str | None
    external_ids: dict[str, str]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def search_citations(query: str) -> list[CitationResult]:
    """Query Semantic Scholar for up to 5 papers matching *query*.

    Returns an empty list (never raises) on API failure so the editor
    dropdown simply shows "No results" rather than surfacing a backend error.
    """
    if not query or len(query.strip()) < 2:
        return []

    params: dict[str, Any] = {
        "query":  query.strip(),
        "fields": _FIELDS,
        "limit":  _LIMIT,
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(_BASE_URL, params=params)
    except httpx.TimeoutException:
        logger.warning("Citation search timed out for query: %.60s", query)
        return []
    except httpx.RequestError as exc:
        logger.warning("Citation search network error: %s", exc)
        return []

    if response.status_code == 429:
        logger.warning("Semantic Scholar rate limit hit during citation search")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Citation search rate limited — please wait a moment.",
        )

    if response.status_code != 200:
        logger.warning(
            "Semantic Scholar returned %d for citation query: %.60s",
            response.status_code, query,
        )
        return []

    try:
        data: dict[str, Any] = response.json()
    except Exception:
        return []

    results: list[CitationResult] = []
    for raw in data.get("data") or []:
        try:
            external_ids: dict[str, str] = raw.get("externalIds") or {}
            doi: str | None = external_ids.get("DOI") or external_ids.get("doi") or None
            authors: list[str] = [
                a["name"]
                for a in (raw.get("authors") or [])
                if isinstance(a, dict) and a.get("name")
            ]
            results.append(CitationResult(
                paper_id=raw.get("paperId") or "",
                title=(raw.get("title") or "").strip() or "Untitled",
                authors=authors,
                year=raw.get("year"),
                doi=doi,
                external_ids=external_ids,
            ))
        except Exception as exc:
            logger.debug("Skipping malformed citation result: %s", exc)

    return results
