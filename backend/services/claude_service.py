"""Claude (Anthropic) service wrapper.

This module owns all direct contact with the Anthropic API.  Routes call
`get_research(topic, depth)` and receive a validated ResearchResponse.

Flow
----
1. Fetch real papers from Semantic Scholar via `scholar_service.search_papers`.
2. Embed those papers as structured context in the user prompt.
3. Ask Claude to synthesise findings, open questions, and a summary — all
   grounded in the real papers provided rather than invented ones.
4. Override the ``papers`` array in Claude's JSON with the validated Scholar
   data so metadata (DOIs, URLs, citation counts) is always accurate.

Design goals:
  * Non-blocking I/O via AsyncAnthropic so FastAPI routes stay async.
  * All configuration read from environment variables — nothing hard-coded.
  * Any upstream failure is translated into HTTPException with a sensible
    status code so the route layer doesn't need its own try/except tree.
  * Scholar failures are non-fatal: if the Scholar call errors we fall back
    to Claude generating its own paper list (original behaviour).
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Literal

from anthropic import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncAnthropic,
    AuthenticationError,
    RateLimitError,
)
from fastapi import HTTPException, status
from pydantic import ValidationError

from models.research import Paper, ResearchMetadata, ResearchResponse
from services.scholar_service import search_papers

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------


def _get_api_key() -> str:
    """Return the ANTHROPIC_API_KEY from the environment or raise 500."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY environment variable is not set")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server misconfigured: ANTHROPIC_API_KEY is not set.",
        )
    return api_key


def _get_model() -> str:
    return os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")


def _get_max_tokens() -> int:
    try:
        return int(os.getenv("ANTHROPIC_MAX_TOKENS", "4096"))
    except ValueError:
        return 4096


def _get_timeout() -> float:
    try:
        return float(os.getenv("ANTHROPIC_TIMEOUT_SECONDS", "60"))
    except ValueError:
        return 60.0


# ---------------------------------------------------------------------------
# Client factory — lazy so unit tests can patch os.environ without import
# side-effects.
# ---------------------------------------------------------------------------


_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=_get_api_key(), timeout=_get_timeout())
    return _client


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


# Base system prompt — tells Claude about the JSON contract.
# When real Scholar papers are injected the user prompt instructs Claude to
# use them as its primary sources; the schema rules here still apply.
_SYSTEM_PROMPT = """You are Footnote, an AI research assistant that produces
rigorous, well-sourced briefings. Respond with a SINGLE JSON object and
nothing else — no prose before or after, no Markdown code fences.

The JSON object MUST conform exactly to this schema:

{
  "topic": string,
  "summary": string,
  "key_findings": [
    {
      "claim": string,
      "evidence": string,
      "source_ids": [string],
      "confidence": "low" | "medium" | "high"
    }
  ],
  "papers": [
    {
      "id": string,
      "title": string,
      "authors": [string],
      "year": number | null,
      "venue": string | null,
      "doi": string | null,
      "url": string | null,
      "abstract": string | null,
      "citation_count": number | null
    }
  ],
  "open_questions": [string],
  "suggested_queries": [string]
}

Rules:
  * Every KeyFinding.source_ids entry MUST match a Paper.id in the same response.
  * Use the paper IDs exactly as supplied (p1, p2, …).
  * Only include papers you are given or are highly confident exist; set unknown
    fields to null rather than inventing values.
  * Be concise but specific. Prefer peer-reviewed work when possible.
"""


def _build_user_prompt(
    topic: str,
    depth: Literal["quick", "deep"],
    papers: list[Paper] | None = None,
) -> str:
    """Construct the user turn, optionally embedding real Scholar papers.

    When *papers* is provided Claude is instructed to treat them as its
    primary source material, reference their exact IDs, and not invent
    additional papers.  When *papers* is empty or None Claude falls back to
    its own knowledge (original behaviour).
    """
    if depth == "deep":
        guidance = (
            "Produce a DEEP survey: 6-10 papers, 5-8 key findings, and 4-6 "
            "open questions. Cover historical context and current frontier."
        )
    else:
        guidance = (
            "Produce a QUICK briefing: 3-5 papers, 3-5 key findings, and 2-3 "
            "open questions. Focus on the most important recent work."
        )

    if papers:
        # Serialise the Paper instances to a compact JSON block.
        papers_payload = [p.model_dump(mode="json") for p in papers]
        papers_json = json.dumps(papers_payload, indent=2, ensure_ascii=False)
        papers_section = (
            "\n\nThe following real papers were retrieved from Semantic Scholar "
            "for this topic. Use them as your PRIMARY sources:\n"
            "  • Include all relevant papers from this list in the `papers` array, "
            "preserving their exact IDs (p1, p2, …), titles, authors, years, DOIs, "
            "URLs, abstracts, and citation counts.\n"
            "  • Reference their IDs in key_findings.source_ids.\n"
            "  • Do NOT invent papers that are not in this list.\n\n"
            f"Provided papers:\n{papers_json}"
        )
    else:
        papers_section = ""

    return f"Research topic: {topic}\n\n{guidance}{papers_section}"


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def _extract_text(message: Any) -> str:
    """Extract concatenated text from an Anthropic Message content list."""
    parts: list[str] = []
    for block in getattr(message, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "".join(parts).strip()


def _parse_json(raw: str) -> dict[str, Any]:
    """Parse the model's JSON output, tolerating stray code fences."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.exception("Failed to parse Claude JSON output")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Claude returned malformed JSON: {exc.msg}",
        ) from exc


def _override_papers(
    payload: dict[str, Any],
    scholar_papers: list[Paper],
) -> None:
    """Replace the papers array in *payload* with validated Scholar data.

    Claude may paraphrase or partially reproduce the paper metadata we sent
    it; we always prefer the ground-truth Scholar data for accuracy.  Only
    papers whose IDs appear in key_findings are retained so the list stays
    tightly coupled to the synthesis.

    Modifies *payload* in-place.
    """
    if not scholar_papers:
        return

    # Collect IDs referenced by Claude's key findings.
    referenced_ids: set[str] = set()
    for finding in payload.get("key_findings") or []:
        for sid in finding.get("source_ids") or []:
            referenced_ids.add(sid)

    # Build a lookup: id → Scholar Paper.
    scholar_by_id: dict[str, Paper] = {p.id: p for p in scholar_papers}

    # Include referenced papers first; fall back to all Scholar papers if
    # Claude didn't produce any key_findings yet.
    if referenced_ids:
        ordered = [
            scholar_by_id[sid]
            for sid in sorted(referenced_ids)
            if sid in scholar_by_id
        ]
        # Append any Scholar papers not yet referenced (preserves full context).
        seen = {p.id for p in ordered}
        for p in scholar_papers:
            if p.id not in seen:
                ordered.append(p)
    else:
        ordered = list(scholar_papers)

    payload["papers"] = [p.model_dump(mode="json") for p in ordered]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_research(
    topic: str, depth: Literal["quick", "deep"] = "quick"
) -> ResearchResponse:
    """Fetch Scholar papers then call Claude to synthesise a ResearchResponse.

    Steps:
      1. Query Semantic Scholar for up to 20 real papers on *topic*.
      2. Embed those papers in the Claude user prompt as grounding context.
      3. Call Claude to produce the JSON briefing.
      4. Overwrite the papers array in Claude's output with ground-truth
         Scholar metadata to guarantee accuracy.
      5. Validate and return the final ResearchResponse.

    Scholar failures are non-fatal — if the Scholar call raises we log a
    warning and continue with an empty papers list so Claude falls back to
    its own knowledge.

    Raises:
        HTTPException: on any fatal failure — misconfiguration, upstream
            network/timeout/rate-limit/auth errors, malformed JSON, or
            schema validation failures.
    """
    # ------------------------------------------------------------------
    # 1. Fetch real papers (non-fatal if Scholar is unavailable)
    # ------------------------------------------------------------------
    scholar_papers: list[Paper] = []
    try:
        scholar_papers = await search_papers(topic)
    except HTTPException as exc:
        # Pass 429 through so callers can back off; swallow everything else.
        if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
            raise
        logger.warning(
            "Scholar fetch failed (HTTP %d), falling back to Claude-only mode: %s",
            exc.status_code,
            exc.detail,
        )
    except Exception as exc:
        logger.warning(
            "Unexpected Scholar error, falling back to Claude-only mode: %s", exc
        )

    # ------------------------------------------------------------------
    # 2. Build prompt and call Claude
    # ------------------------------------------------------------------
    client = _get_client()
    model = _get_model()
    max_tokens = _get_max_tokens()
    user_prompt = _build_user_prompt(topic, depth, scholar_papers or None)

    started = time.perf_counter()
    try:
        message = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except AuthenticationError as exc:
        logger.error("Anthropic authentication failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upstream authentication with Anthropic failed.",
        ) from exc
    except RateLimitError as exc:
        logger.warning("Anthropic rate limit hit: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Upstream rate limit reached. Please retry shortly.",
        ) from exc
    except APITimeoutError as exc:
        logger.warning("Anthropic request timed out: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Upstream request to Anthropic timed out.",
        ) from exc
    except APIConnectionError as exc:
        logger.warning("Anthropic connection error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach Anthropic API.",
        ) from exc
    except APIStatusError as exc:
        logger.warning("Anthropic returned %s: %s", exc.status_code, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Anthropic API error (status {exc.status_code}).",
        ) from exc
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("Unexpected error calling Anthropic")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while generating research.",
        ) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)

    # ------------------------------------------------------------------
    # 3. Parse Claude's response
    # ------------------------------------------------------------------
    raw_text = _extract_text(message)
    if not raw_text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Claude returned an empty response.",
        )

    payload = _parse_json(raw_text)

    # ------------------------------------------------------------------
    # 4. Replace Claude's paper list with ground-truth Scholar data
    # ------------------------------------------------------------------
    if scholar_papers:
        _override_papers(payload, scholar_papers)

    # ------------------------------------------------------------------
    # 5. Inject authoritative metadata and validate
    # ------------------------------------------------------------------
    usage = getattr(message, "usage", None)
    token_usage = None
    if usage is not None:
        token_usage = {
            "input_tokens": getattr(usage, "input_tokens", 0) or 0,
            "output_tokens": getattr(usage, "output_tokens", 0) or 0,
        }

    payload["metadata"] = ResearchMetadata(
        model=model,
        depth=depth,
        latency_ms=latency_ms,
        token_usage=token_usage,
    ).model_dump(mode="json")

    payload.setdefault("topic", topic)

    try:
        return ResearchResponse.model_validate(payload)
    except ValidationError as exc:
        logger.error("Claude response failed schema validation: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Claude response did not match the expected schema.",
        ) from exc
