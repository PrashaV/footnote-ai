"""Plagiarism-risk analysis service.

Uses Claude to identify passages in the draft that exhibit patterns
associated with unattributed copying, paraphrasing without citation, or
unusual phrasing uniformity.

IMPORTANT: This is a RISK INDICATOR only. It does NOT replace dedicated
plagiarism-detection tools such as Turnitin or iThenticate. A high risk
score does not prove plagiarism; a low score does not guarantee originality.
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

from models.verify import FlaggedPassage, PlagiarismRiskResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are an academic integrity analyst performing a
PLAGIARISM RISK assessment on a research draft. You are NOT a plagiarism
detector — you are flagging stylistic and structural indicators that
*suggest* unattributed copying or insufficient attribution.

Return a SINGLE JSON object — no prose, no markdown fences — matching:

{
  "risk_score": number,          // 0–100 (0 = very low risk, 100 = very high risk)
  "risk_level": "low" | "moderate" | "high",
  "issues": [string],            // specific issue types found
  "flagged_passages": [
    {
      "text": string,            // verbatim excerpt ≤200 chars
      "reason": string,          // why it was flagged
      "severity": "low" | "medium" | "high"
    }
  ],
  "explanation": string          // 2–4 sentence summary of your risk assessment
}

Risk scoring guide:
  0–30  : Low risk — text appears original with appropriate attribution
  31–60 : Moderate risk — some attribution gaps or suspicious patterns
  61–100: High risk — multiple patterns suggesting unattributed copying

Indicators to look for:
  • Statements presented as facts without any citation (especially statistics, claims)
  • Paragraphs that read as polished, encyclopaedic prose unlike the author's voice
  • Sudden style shifts (formal to informal or vice versa) within a section
  • Verbatim-style text without quotation marks or attribution
  • Paraphrasing patterns that closely echo standard reference material phrasing
  • Repeated identical sentence structures across multiple consecutive paragraphs
  • Statistical claims, definitions, or taxonomies without inline citations
  • Dense factual claims with no footnotes or references

Flag at most 6 passages. Keep flagged text to ≤200 characters.
Return ONLY the JSON object."""


def _build_prompt(draft: str) -> str:
    words = draft.split()
    if len(words) > 8000:
        truncated = " ".join(words[:8000])
        note = "\n\n[NOTE: Draft truncated to first 8 000 words for analysis.]"
    else:
        truncated = draft
        note = ""
    return (
        f"Perform a plagiarism-risk assessment on the following research draft:{note}\n\n"
        f"{truncated}"
    )


def _parse_result(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("plagiarism_service: failed to parse JSON: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Plagiarism analysis returned malformed JSON: {exc.msg}",
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


async def analyse_plagiarism_risk(draft: str) -> PlagiarismRiskResult:
    """Analyse *draft* for plagiarism-risk indicators.

    Returns a PlagiarismRiskResult with a risk score (0–100, lower is better),
    flagged passages, and a mandatory disclaimer.

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
        "plagiarism_service: Anthropic call took %dms",
        int((time.perf_counter() - started) * 1000),
    )

    raw = "".join(
        getattr(block, "text", "") for block in getattr(message, "content", []) or []
    ).strip()

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Plagiarism analysis returned an empty response.",
        )

    payload = _parse_result(raw)

    risk_score = float(payload.get("risk_score", 50))
    risk_score = max(0.0, min(100.0, risk_score))

    raw_level = payload.get("risk_level", "")
    if raw_level in ("low", "moderate", "high"):
        risk_level = raw_level
    else:
        if risk_score <= 30:
            risk_level = "low"
        elif risk_score <= 60:
            risk_level = "moderate"
        else:
            risk_level = "high"

    flagged_passages = [
        FlaggedPassage(
            text=fp.get("text", ""),
            reason=fp.get("reason", ""),
            severity=fp.get("severity", "medium")
            if fp.get("severity") in ("low", "medium", "high")
            else "medium",
        )
        for fp in (payload.get("flagged_passages") or [])[:6]
        if fp.get("text")
    ]

    return PlagiarismRiskResult(
        risk_score=risk_score,
        risk_level=risk_level,
        flagged_passages=flagged_passages,
        issues=payload.get("issues") or [],
        explanation=payload.get("explanation") or "No explanation provided.",
    )
