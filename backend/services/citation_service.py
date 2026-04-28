"""Citation extraction and verification service.

Pipeline:
  1. Use Claude to extract all references from the draft (with parsed fields).
  2. For each reference, attempt to resolve it against:
       a. Semantic Scholar (already in the stack)
       b. CrossRef (free, great for humanities/social sciences)
       c. OpenAlex (free, broad scholarly coverage)
  3. Use Claude to compare the cited claim (context sentence) against the
     found paper's abstract/title to detect mismatches.
  4. Return a CitationCheckResult with per-reference VerifiedCitation entries.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

import httpx
from anthropic import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncAnthropic,
    AuthenticationError,
    RateLimitError,
)
from fastapi import HTTPException, status

from models.verify import (
    CitationCheckResult,
    ExtractedReference,
    VerifiedCitation,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_CROSSREF_BASE = "https://api.crossref.org/works"
_OPENALEX_BASE = "https://api.openalex.org/works"
_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1/paper"

_HTTP_TIMEOUT = 10.0  # seconds per external API call
_MAX_CONCURRENT_LOOKUPS = 5  # semaphore to avoid hammering external APIs


# ---------------------------------------------------------------------------
# Step 1: Extract references from draft via Claude
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = """You are a reference extraction engine. Given a research
draft, extract every academic reference or citation. Return a SINGLE JSON
array — no prose, no markdown fences — where each element matches:

{
  "raw_text": string,       // verbatim reference string (max 400 chars)
  "title": string | null,   // parsed paper title
  "authors": [string],      // parsed author surnames or full names
  "year": number | null,    // 4-digit publication year
  "doi": string | null,     // DOI if present (e.g. "10.1000/xyz123")
  "url": string | null      // URL if present
}

Include in-text citations (e.g. "Smith et al., 2022") AND bibliography
entries at the end of the document. De-duplicate: if an in-text citation
refers to the same work as a bibliography entry, include it only once
using the bibliography entry as raw_text.

Return an empty array [] if no references are found.
Return ONLY the JSON array."""


def _get_client() -> AsyncAnthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server misconfigured: ANTHROPIC_API_KEY is not set.",
        )
    timeout = float(os.getenv("ANTHROPIC_TIMEOUT_SECONDS", "60"))
    return AsyncAnthropic(api_key=api_key, timeout=timeout)


async def _extract_references(draft: str) -> list[ExtractedReference]:
    """Ask Claude to parse all references from *draft*."""
    client = _get_client()
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    # Truncate to keep prompt manageable (references are usually at the end)
    words = draft.split()
    if len(words) > 10000:
        # Keep first 2000 and last 3000 words (intro + bibliography)
        truncated = " ".join(words[:2000]) + "\n...\n" + " ".join(words[-3000:])
    else:
        truncated = draft

    try:
        message = await client.messages.create(
            model=model,
            max_tokens=4096,
            system=_EXTRACT_SYSTEM,
            messages=[{"role": "user", "content": f"Draft:\n\n{truncated}"}],
        )
    except (AuthenticationError, RateLimitError, APITimeoutError, APIConnectionError, APIStatusError) as exc:
        logger.warning("citation_service: reference extraction failed: %s", exc)
        return []

    raw = "".join(
        getattr(block, "text", "") for block in getattr(message, "content", []) or []
    ).strip()

    if not raw:
        return []

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("citation_service: could not parse reference extraction JSON")
        return []

    if not isinstance(data, list):
        return []

    refs: list[ExtractedReference] = []
    for item in data[:50]:  # cap at 50 references
        try:
            refs.append(ExtractedReference(
                raw_text=str(item.get("raw_text", ""))[:400],
                title=item.get("title") or None,
                authors=[str(a) for a in (item.get("authors") or [])],
                year=int(item["year"]) if item.get("year") else None,
                doi=item.get("doi") or None,
                url=item.get("url") or None,
            ))
        except Exception:
            continue
    return refs


# ---------------------------------------------------------------------------
# Step 2: Lookup reference in external APIs
# ---------------------------------------------------------------------------


async def _lookup_crossref(
    client: httpx.AsyncClient,
    ref: ExtractedReference,
) -> dict[str, Any] | None:
    """Try to find *ref* in CrossRef. Returns a simplified hit dict or None."""
    query = ref.title or ref.raw_text[:150]
    params: dict[str, Any] = {"query": query, "rows": 1, "select": "DOI,title,author,URL"}

    if ref.doi:
        # Direct DOI lookup is most accurate
        try:
            r = await client.get(f"{_CROSSREF_BASE}/{ref.doi}", timeout=_HTTP_TIMEOUT)
            if r.status_code == 200:
                item = r.json().get("message", {})
                return {
                    "source": "crossref",
                    "title": (item.get("title") or [""])[0],
                    "doi": item.get("DOI"),
                    "url": item.get("URL"),
                }
        except Exception:
            pass

    try:
        r = await client.get(_CROSSREF_BASE, params=params, timeout=_HTTP_TIMEOUT)
        if r.status_code != 200:
            return None
        items = r.json().get("message", {}).get("items", [])
        if not items:
            return None
        hit = items[0]
        return {
            "source": "crossref",
            "title": (hit.get("title") or [""])[0],
            "doi": hit.get("DOI"),
            "url": hit.get("URL"),
        }
    except Exception as exc:
        logger.debug("crossref lookup failed: %s", exc)
        return None


async def _lookup_openalex(
    client: httpx.AsyncClient,
    ref: ExtractedReference,
) -> dict[str, Any] | None:
    """Try to find *ref* in OpenAlex."""
    if ref.doi:
        try:
            doi_clean = re.sub(r"^https?://doi\.org/", "", ref.doi)
            r = await client.get(
                f"{_OPENALEX_BASE}/https://doi.org/{doi_clean}",
                timeout=_HTTP_TIMEOUT,
            )
            if r.status_code == 200:
                data = r.json()
                return {
                    "source": "openalex",
                    "title": data.get("title"),
                    "doi": data.get("doi"),
                    "url": data.get("id"),
                }
        except Exception:
            pass

    query = ref.title or ref.raw_text[:150]
    try:
        r = await client.get(
            _OPENALEX_BASE,
            params={"search": query, "per-page": 1, "select": "id,title,doi"},
            timeout=_HTTP_TIMEOUT,
            headers={"User-Agent": "Footnote-AI/1.0 (mailto:footnote@example.com)"},
        )
        if r.status_code != 200:
            return None
        results = r.json().get("results", [])
        if not results:
            return None
        hit = results[0]
        return {
            "source": "openalex",
            "title": hit.get("title"),
            "doi": hit.get("doi"),
            "url": hit.get("id"),
        }
    except Exception as exc:
        logger.debug("openalex lookup failed: %s", exc)
        return None


async def _lookup_semantic_scholar(
    client: httpx.AsyncClient,
    ref: ExtractedReference,
) -> dict[str, Any] | None:
    """Try to find *ref* in Semantic Scholar.

    Requests abstract in addition to other fields so claim_matcher_service
    can compare draft claims against actual paper content.
    """
    api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")
    headers = {"x-api-key": api_key} if api_key else {}
    # Include abstract so claim matching can use it
    fields = "title,authors,year,externalIds,url,abstract"

    if ref.doi:
        try:
            r = await client.get(
                f"{_SCHOLAR_BASE}/DOI:{ref.doi}",
                params={"fields": fields},
                headers=headers,
                timeout=_HTTP_TIMEOUT,
            )
            if r.status_code == 200:
                data = r.json()
                return {
                    "source": "semantic_scholar",
                    "title": data.get("title"),
                    "doi": (data.get("externalIds") or {}).get("DOI"),
                    "url": data.get("url"),
                    "abstract": data.get("abstract"),
                }
        except Exception:
            pass

    query = ref.title or ref.raw_text[:150]
    try:
        r = await client.get(
            f"{_SCHOLAR_BASE}/search",
            params={"query": query, "limit": 1, "fields": fields},
            headers=headers,
            timeout=_HTTP_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        data_list = r.json().get("data", [])
        if not data_list:
            return None
        hit = data_list[0]
        return {
            "source": "semantic_scholar",
            "title": hit.get("title"),
            "doi": (hit.get("externalIds") or {}).get("DOI"),
            "url": hit.get("url"),
            "abstract": hit.get("abstract"),
        }
    except Exception as exc:
        logger.debug("scholar lookup failed: %s", exc)
        return None


def _titles_match(ref_title: str | None, found_title: str | None) -> bool:
    """Fuzzy title match — normalise and compare lowercased tokens."""
    if not ref_title or not found_title:
        return False

    def normalise(s: str) -> set[str]:
        return set(re.sub(r"[^a-z0-9 ]", "", s.lower()).split())

    ref_tokens = normalise(ref_title)
    found_tokens = normalise(found_title)
    if not ref_tokens or not found_tokens:
        return False
    overlap = len(ref_tokens & found_tokens) / max(len(ref_tokens), len(found_tokens))
    return overlap >= 0.6


async def _resolve_reference(
    http: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    ref: ExtractedReference,
) -> VerifiedCitation:
    """Resolve a single reference against all three external APIs."""
    async with sem:
        # Try all three in parallel
        ss_task = asyncio.create_task(_lookup_semantic_scholar(http, ref))
        cr_task = asyncio.create_task(_lookup_crossref(http, ref))
        oa_task = asyncio.create_task(_lookup_openalex(http, ref))

        results = await asyncio.gather(ss_task, cr_task, oa_task, return_exceptions=True)

    hit = None
    source_api = None
    for i, r in enumerate(results):
        if isinstance(r, dict) and r.get("title"):
            hit = r
            source_api = ["semantic_scholar", "crossref", "openalex"][i]
            break

    if hit is None:
        return VerifiedCitation(
            reference=ref,
            status="unverified",
            confidence="low",
        )

    found_title: str | None = hit.get("title")
    found_doi: str | None = hit.get("doi")
    found_url: str | None = hit.get("url")
    found_abstract: str | None = hit.get("abstract")  # used by claim_matcher_service

    # Check if titles match
    if ref.title and not _titles_match(ref.title, found_title):
        return VerifiedCitation(
            reference=ref,
            status="hallucinated",
            found_title=found_title,
            found_doi=found_doi,
            found_url=found_url,
            found_abstract=found_abstract,
            source_api=source_api,
            mismatch_reason=(
                f"Reference title '{ref.title}' does not match found title '{found_title}'."
            ),
            confidence="medium",
        )

    return VerifiedCitation(
        reference=ref,
        status="verified",
        found_title=found_title,
        found_doi=found_doi,
        found_url=found_url,
        found_abstract=found_abstract,
        source_api=source_api,
        confidence="high",
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def verify_citations(draft: str) -> CitationCheckResult:
    """Extract and verify all citations in *draft*.

    Steps:
      1. Extract references from draft via Claude.
      2. Resolve each reference against Semantic Scholar, CrossRef, OpenAlex.
      3. Return aggregate CitationCheckResult.

    Raises:
        HTTPException: on unrecoverable errors.
    """
    refs = await _extract_references(draft)

    if not refs:
        # No references found — this is itself a red flag for academic writing.
        # An abstract or draft with zero detectable citations scores 40 (not 100).
        # A score of 100 would falsely imply perfect citation integrity.
        return CitationCheckResult(
            total_references=0,
            citations=[],
            score=40.0,  # No references detected — cannot verify citation integrity
        )

    sem = asyncio.Semaphore(_MAX_CONCURRENT_LOOKUPS)
    async with httpx.AsyncClient() as http:
        tasks = [_resolve_reference(http, sem, ref) for ref in refs]
        verified_citations: list[VerifiedCitation] = await asyncio.gather(*tasks)

    verified = sum(1 for c in verified_citations if c.status == "verified")
    unverified = sum(1 for c in verified_citations if c.status == "unverified")
    hallucinated = sum(1 for c in verified_citations if c.status == "hallucinated")
    mismatch = sum(1 for c in verified_citations if c.status == "mismatch")
    total = len(verified_citations)

    # Score: verified refs count fully; unverified penalise half; hallucinated/mismatch penalise fully
    if total > 0:
        good = verified + (unverified * 0.5)
        score = round((good / total) * 100, 1)
    else:
        score = 100.0

    return CitationCheckResult(
        total_references=total,
        verified_count=verified,
        unverified_count=unverified,
        hallucinated_count=hallucinated,
        mismatch_count=mismatch,
        citations=verified_citations,
        score=score,
    )
