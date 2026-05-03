"""AI writing detection service — powered by Claude (Anthropic).

Uses the existing ANTHROPIC_API_KEY already in the stack.
No additional API key or cost required.

Claude analyses the draft for linguistic patterns associated with AI-generated
text: uniform sentence rhythm, hedged phrasing, lack of personal voice,
over-structured arguments, and statistical word choice patterns.
"""

from __future__ import annotations

import json
import logging
import os

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

_SYSTEM_PROMPT = """You are an expert forensic linguist specialising in detecting
AI-generated academic text. Analyse the draft for signs of AI authorship.

Look for these indicators:
  • Unnaturally uniform sentence length and rhythm
  • Generic, hedged phrasing ("it is important to note", "in conclusion")
  • Lack of genuine personal voice, anecdotes, or original insight
  • Over-structured arguments (numbered lists where prose would be natural)
  • Absence of field-specific jargon used correctly in context
  • Statistical word choice: overly balanced vocabulary, low perplexity
  • Repetition of ideas rephrased rather than developed
  • Perfect grammar with no natural human variation

Return a SINGLE JSON object — no prose, no markdown:
{
  "score": number,           // 0.0–1.0, probability text is AI-generated
  "verdict": string,         // "likely_human" | "uncertain" | "likely_ai"
  "explanation": string,     // 1–2 sentence plain-English summary
  "indicators": [string],    // 2–4 specific observations about this text
  "flagged_passages": [      // up to 5 most suspicious passages
    {
      "text": string,        // verbatim excerpt (max 200 chars)
      "reason": string,      // why this passage looks AI-generated
      "severity": string     // "low" | "medium" | "high"
    }
  ]
}

Scoring guide:
  0.0–0.19  → likely_human   (strong human voice, natural variation)
  0.20–0.64 → uncertain      (mixed signals, inconclusive)
  0.65–1.0  → likely_ai      (multiple strong AI indicators)

Be calibrated — most text is human. Only score high if multiple
strong indicators are present. Return ONLY the JSON object."""


async def detect_ai_writing(draft: str) -> AIWritingResult:
    """Analyse *draft* for AI writing patterns using Claude.

    Uses ANTHROPIC_API_KEY (already required by the rest of the backend).
    Gracefully degrades if the key is missing.

    Raises:
        HTTPException: on rate-limit or unrecoverable API errors.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        logger.warning("ai_detection_service: ANTHROPIC_API_KEY not set — skipping")
        return AIWritingResult(
            score=0.0,
            verdict="likely_human",
            flagged_passages=[],
            indicators=["AI detection unavailable — ANTHROPIC_API_KEY not configured."],
            explanation="AI writing detection could not run (API key missing).",
            disclaimer="Set ANTHROPIC_API_KEY to enable AI writing analysis.",
        )

    # Truncate to ~5000 words to keep latency and token cost reasonable
    words = draft.split()
    if len(words) > 5000:
        text_to_send = " ".join(words[:5000])
        truncated = True
    else:
        text_to_send = draft
        truncated = False

    timeout = float(os.getenv("ANTHROPIC_TIMEOUT_SECONDS", "60"))
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    client = AsyncAnthropic(api_key=api_key, timeout=timeout)

    try:
        message = await client.messages.create(
            model=model,
            max_tokens=1024,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Draft to analyse:\n\n{text_to_send}"}],
        )
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Anthropic authentication failed.",
        ) from exc
    except RateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Anthropic rate limit reached. Please retry shortly.",
        ) from exc
    except APITimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="AI detection timed out. Please try again.",
        ) from exc
    except (APIConnectionError, APIStatusError) as exc:
        logger.warning("ai_detection_service: API error: %s", exc)
        return AIWritingResult(
            score=0.0,
            verdict="likely_human",
            flagged_passages=[],
            indicators=["AI detection temporarily unavailable."],
            explanation="Could not reach the AI detection service.",
            disclaimer="Results unavailable for this request.",
        )

    raw = "".join(
        getattr(block, "text", "") for block in getattr(message, "content", []) or []
    ).strip()

    if not raw:
        logger.warning("ai_detection_service: empty response from Claude")
        return AIWritingResult(
            score=0.0,
            verdict="likely_human",
            flagged_passages=[],
            indicators=["AI detection returned no result."],
            explanation="The AI detection model returned an empty response.",
            disclaimer="Results unavailable for this request.",
        )

    # Strip accidental markdown fences
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("ai_detection_service: could not parse JSON response")
        return AIWritingResult(
            score=0.0,
            verdict="likely_human",
            flagged_passages=[],
            indicators=["AI detection result could not be parsed."],
            explanation="The AI detection model returned malformed data.",
            disclaimer="Results unavailable for this request.",
        )

    raw_score = float(data.get("score", 0.0))
    raw_score = max(0.0, min(1.0, raw_score))  # clamp to [0, 1]
    score = round(raw_score * 100, 1)

    verdict = data.get("verdict") or (
        "likely_ai" if raw_score >= 0.65
        else "uncertain" if raw_score >= 0.2
        else "likely_human"
    )

    indicators = [str(i) for i in (data.get("indicators") or [])][:4]
    if not indicators:
        indicators = [f"Claude estimates {round(score)}% probability of AI authorship."]

    flagged_passages: list[FlaggedPassage] = []
    for fp in (data.get("flagged_passages") or [])[:5]:
        if fp.get("text"):
            flagged_passages.append(FlaggedPassage(
                text=str(fp["text"])[:200],
                reason=str(fp.get("reason", "Suspicious AI pattern")),
                severity=fp.get("severity", "medium")
                    if fp.get("severity") in ("low", "medium", "high") else "medium",
            ))

    truncation_note = " Note: only the first 5,000 words were analysed." if truncated else ""
    explanation = str(data.get("explanation", "")) + truncation_note

    return AIWritingResult(
        score=score,
        verdict=verdict,
        flagged_passages=flagged_passages,
        indicators=indicators,
        explanation=explanation,
        disclaimer=(
            "Powered by Claude (Anthropic). AI detection reflects linguistic pattern "
            "analysis, not certainty. A high score does not prove AI authorship; "
            "a low score does not guarantee human authorship. "
            "Always review flagged passages in context."
        ),
    )
