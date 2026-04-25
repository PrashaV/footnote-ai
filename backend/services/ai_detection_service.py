"""AI writing pattern detection service.

Uses Claude to analyse a draft for linguistic patterns associated with
AI-generated text: low perplexity proxies (uniform sentence rhythm, limited
vocabulary variation), excessive hedging, structural uniformity, and
repetitive transitional phrasing.

The module does NOT make any claims of certainty — it returns a probabilistic
score (0–100) alongside detected indicators and a mandatory disclaimer.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from anthropic import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncAnthropic,
    AuthenticationError,
    RateLimitError,
)
from fastapi import HTTPException, status

from models.verify import AIWritingResult, FlaggedPassage

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are an expert linguistic analyst specialising in
detecting stylistic patterns associated with AI-generated academic text.

Analyse the provided draft and return a SINGLE JSON object — no prose, no
markdown fences — conforming exactly to this schema:

{
  "score": number,           // 0–100 (0 = almost certainly human, 100 = very likely AI)
  "verdict": "likely_human" | "uncertain" | "likely_ai",
  "indicators": [string],    // specific detected patterns, e.g. "uniform sentence length"
  "flagged_passages": [
    {
      "text": string,        // verbatim excerpt ≤200 chars
      "reason": string,      // why it was flagged
      "severity": "low" | "medium" | "high"
    }
  ],
  "explanation": string      // 2–4 sentence plain-language summary of your reasoning
}

Scoring guide:
  0–30  : Likely human — varied rhythm, natural imperfections, authentic voice
  31–60 : Uncertain — some AI patterns present but not conclusive
  61–100: Likely AI — strong stylistic uniformity, low burstiness, hedging clusters

Patterns to look for:
  • Sentence length uniformity (burstiness < expected for human prose)
  • Excessive modal hedging ("it is worth noting", "it is important to consider")
  • Repetitive paragraph structure (every para starts with a topic sentence, ends with a summary)
  • Generic transitional phrases ("furthermore", "in conclusion", "notably")
  • Lack of personal anecdote, opinion, or authorial voice
  • Overly balanced, list-like enumerations even in prose
  • Absence of colloquialisms, contractions, or domain-specific slang
  • Vocabulary richness lower than expected for the field

Flag at most 5 passages. Keep flagged text to ≤200 characters.
Return ONLY the JSON object."""


def _build_prompt(draft: str) -> str:
    # Truncate very long drafts — 8 000 words is plenty for pattern detection
    words = draft.split()
    if len(words) > 8000:
        truncated = " ".join(words[:8000])
        note = "\n\n[NOTE: Draft truncated to first 8 000 words for analysis.]"
    else:
        truncated = draft
        note = ""
    return f"Analyse the following research draft for AI writing patterns:{note}\n\n{truncated}"


def _parse_result(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("ai_detection_service: failed to parse JSON: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI detection returned malformed JSON: {exc.msg}",
        ) from exc


def _get_client() -> AsyncAnthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server misconfigured: ANTHROPIC_API_KEY is not set.",
        )
    timeout = float(os.getenv("ANTHROPIC_TIMEOUT_SECONDS", "60"))
    return AsyncAnthropic(api_key=api_key, timeout=timeout)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def detect_ai_writing(draft: str) -> AIWritingResult:
    """Analyse *draft* for AI writing patterns and return an AIWritingResult.

    Returns a probabilistic score with flagged passages and indicators.
    Always includes a disclaimer about the limitations of AI detection.

    Raises:
        HTTPException: on Anthropic API errors.
    """
    client = _get_client()
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    max_tokens = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))

    prompt = _build_prompt(draft)
    started = time.perf_counter()

    try:
        message = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upstream authentication with Anthropic failed.",
        ) from exc
    except RateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Upstream rate limit reached. Please retry shortly.",
        ) from exc
    except APITimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Upstream request to Anthropic timed out.",
        ) from exc
    except (APIConnectionError, APIStatusError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach Anthropic API.",
        ) from exc

    logger.debug(
        "ai_detection_service: Anthropic call took %dms",
        int((time.perf_counter() - started) * 1000),
    )

    raw = "".join(
        getattr(block, "text", "") for block in getattr(message, "content", []) or []
    ).strip()

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI detection returned an empty response.",
        )

    payload = _parse_result(raw)

    # Normalise score
    score = float(payload.get("score", 50))
    score = max(0.0, min(100.0, score))

    # Determine verdict from score if not supplied
    raw_verdict = payload.get("verdict", "")
    if raw_verdict in ("likely_human", "uncertain", "likely_ai"):
        verdict = raw_verdict
    else:
        if score <= 30:
            verdict = "likely_human"
        elif score <= 60:
            verdict = "uncertain"
        else:
            verdict = "likely_ai"

    flagged_passages = [
        FlaggedPassage(
            text=fp.get("text", ""),
            reason=fp.get("reason", ""),
            severity=fp.get("severity", "medium")
            if fp.get("severity") in ("low", "medium", "high")
            else "medium",
        )
        for fp in (payload.get("flagged_passages") or [])[:5]
        if fp.get("text")
    ]

    return AIWritingResult(
        score=score,
        verdict=verdict,
        flagged_passages=flagged_passages,
        indicators=payload.get("indicators") or [],
        explanation=payload.get("explanation") or "No explanation provided.",
    )
