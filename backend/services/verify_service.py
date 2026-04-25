"""Verification orchestration service.

Coordinates the three analysis phases (citation check, AI writing detection,
plagiarism-risk analysis) and assembles the final IntegrityReport.

Also uses Claude to identify unsupported claims in the draft.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

from anthropic import AsyncAnthropic, AuthenticationError, RateLimitError, APITimeoutError, APIConnectionError, APIStatusError
from fastapi import HTTPException, status

from models.verify import (
    IntegrityReport,
    IntegrityReportMetadata,
    IntegrityScores,
    RecommendedFix,
    UnsupportedClaim,
    VerifyRequest,
)
from services.ai_detection_service import detect_ai_writing
from services.citation_service import verify_citations
from services.plagiarism_service import analyse_plagiarism_risk

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Unsupported-claims detection (Claude)
# ---------------------------------------------------------------------------

_CLAIMS_SYSTEM = """You are an academic integrity reviewer. Identify factual
claims or assertions in the draft that lack an inline citation or attribution.
Focus on claims that SHOULD be supported: statistics, specific findings,
comparative statements, causal claims.

Return a SINGLE JSON array — no prose, no markdown — where each element is:
{
  "text": string,       // the unsupported claim (≤200 chars verbatim)
  "reason": string,     // why it needs a citation
  "suggestion": string  // what kind of source would support it
}

Return at most 8 items. Return [] if the draft is well-cited.
Return ONLY the JSON array."""


async def _find_unsupported_claims(draft: str) -> list[UnsupportedClaim]:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return []
    timeout = float(os.getenv("ANTHROPIC_TIMEOUT_SECONDS", "60"))
    client = AsyncAnthropic(api_key=api_key, timeout=timeout)
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    words = draft.split()
    truncated = " ".join(words[:6000]) if len(words) > 6000 else draft

    try:
        message = await client.messages.create(
            model=model,
            max_tokens=2048,
            system=_CLAIMS_SYSTEM,
            messages=[{"role": "user", "content": f"Draft:\n\n{truncated}"}],
        )
    except Exception as exc:
        logger.warning("verify_service: unsupported-claims analysis failed: %s", exc)
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
        return []

    if not isinstance(data, list):
        return []

    claims: list[UnsupportedClaim] = []
    for item in data[:8]:
        if item.get("text"):
            claims.append(UnsupportedClaim(
                text=str(item["text"])[:200],
                reason=str(item.get("reason", "Missing citation")),
                suggestion=item.get("suggestion") or None,
            ))
    return claims


# ---------------------------------------------------------------------------
# Score aggregation helpers
# ---------------------------------------------------------------------------


def _compute_scores(
    citation_score: float | None,
    ai_score: float | None,
    plagiarism_risk_score: float | None,
) -> IntegrityScores:
    """Combine individual scores into IntegrityScores.

    ai_originality  = 100 - ai_detection_score (higher = more human)
    plagiarism_safe = 100 - plagiarism_risk_score (higher = safer)
    citation_integrity = citation_score as-is

    Overall weighted: 40% citation, 30% ai_originality, 30% plagiarism_safe
    Missing dimensions default to 75 (neutral-positive).
    """
    c = citation_score if citation_score is not None else 75.0
    ai_orig = (100.0 - ai_score) if ai_score is not None else 75.0
    plag_safe = (100.0 - plagiarism_risk_score) if plagiarism_risk_score is not None else 75.0

    overall = round(0.40 * c + 0.30 * ai_orig + 0.30 * plag_safe, 1)

    return IntegrityScores(
        citation_integrity=round(c, 1),
        ai_originality=round(ai_orig, 1),
        plagiarism_risk=round(plag_safe, 1),
        overall=overall,
    )


def _build_warnings(report: IntegrityReport) -> list[str]:
    warnings: list[str] = []

    if report.citation_check:
        cc = report.citation_check
        if cc.hallucinated_count > 0:
            warnings.append(
                f"{cc.hallucinated_count} reference(s) appear to be hallucinated "
                "(details don't match any real paper)."
            )
        if cc.unverified_count > 0:
            warnings.append(
                f"{cc.unverified_count} reference(s) could not be verified in any "
                "scholarly database."
            )
        if cc.mismatch_count > 0:
            warnings.append(
                f"{cc.mismatch_count} citation(s) found but the cited claim "
                "may not match the paper's content."
            )

    if report.ai_writing and report.ai_writing.verdict == "likely_ai":
        warnings.append(
            "High likelihood of AI-generated text detected. "
            "Review the flagged passages before submission."
        )
    elif report.ai_writing and report.ai_writing.verdict == "uncertain":
        warnings.append(
            "Some AI writing patterns detected. Results are inconclusive — "
            "review flagged passages."
        )

    if report.plagiarism_risk and report.plagiarism_risk.risk_level == "high":
        warnings.append(
            "High plagiarism risk detected. Run a dedicated tool "
            "(e.g. Turnitin) before submission."
        )
    elif report.plagiarism_risk and report.plagiarism_risk.risk_level == "moderate":
        warnings.append(
            "Moderate plagiarism risk indicators found. "
            "Review the flagged passages for attribution."
        )

    if len(report.unsupported_claims) > 3:
        warnings.append(
            f"{len(report.unsupported_claims)} claims may lack adequate citation support."
        )

    return warnings


def _build_fixes(report: IntegrityReport) -> list[RecommendedFix]:
    fixes: list[RecommendedFix] = []

    if report.citation_check:
        for c in report.citation_check.citations:
            if c.status == "hallucinated":
                fixes.append(RecommendedFix(
                    priority="high",
                    category="citation",
                    description=(
                        f"Replace or verify reference: '{c.reference.raw_text[:100]}'. "
                        f"The paper details don't match any real source."
                    ),
                    affected_text=c.reference.raw_text[:150],
                ))
            elif c.status == "mismatch":
                fixes.append(RecommendedFix(
                    priority="high",
                    category="citation",
                    description=(
                        f"Citation mismatch: '{c.reference.raw_text[:100]}'. "
                        f"{c.mismatch_reason or 'The cited claim may not match the paper.'}"
                    ),
                    affected_text=c.reference.raw_text[:150],
                ))
            elif c.status == "unverified":
                fixes.append(RecommendedFix(
                    priority="medium",
                    category="citation",
                    description=(
                        f"Could not verify reference: '{c.reference.raw_text[:100]}'. "
                        "Add a DOI or check for typos."
                    ),
                    affected_text=c.reference.raw_text[:150],
                ))

    if report.ai_writing:
        for fp in report.ai_writing.flagged_passages:
            if fp.severity in ("high", "medium"):
                fixes.append(RecommendedFix(
                    priority="medium" if fp.severity == "medium" else "high",
                    category="ai_writing",
                    description=f"AI writing pattern: {fp.reason}",
                    affected_text=fp.text[:150],
                ))

    if report.plagiarism_risk:
        for fp in report.plagiarism_risk.flagged_passages:
            if fp.severity == "high":
                fixes.append(RecommendedFix(
                    priority="high",
                    category="plagiarism",
                    description=f"Plagiarism risk: {fp.reason}",
                    affected_text=fp.text[:150],
                ))

    for claim in report.unsupported_claims:
        fixes.append(RecommendedFix(
            priority="medium",
            category="unsupported_claim",
            description=f"Add citation: {claim.reason}. {claim.suggestion or ''}".strip(),
            affected_text=claim.text[:150],
        ))

    # Deduplicate and cap
    seen: set[str] = set()
    unique_fixes: list[RecommendedFix] = []
    for f in fixes:
        key = f.description[:80]
        if key not in seen:
            seen.add(key)
            unique_fixes.append(f)

    # Sort: high → medium → low
    order = {"high": 0, "medium": 1, "low": 2}
    unique_fixes.sort(key=lambda f: order[f.priority])
    return unique_fixes[:20]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def run_verification(request: VerifyRequest) -> IntegrityReport:
    """Run all requested integrity checks and return an IntegrityReport.

    Checks run concurrently where possible to minimise total latency.
    Non-fatal errors in individual checks are logged but don't abort the run.

    Raises:
        HTTPException: on configuration errors (missing API key).
    """
    started = time.perf_counter()
    checks_performed: list[str] = []

    # ------------------------------------------------------------------
    # Launch concurrent checks
    # ------------------------------------------------------------------
    citation_task = (
        asyncio.create_task(verify_citations(request.draft))
        if request.check_citations
        else None
    )
    ai_task = (
        asyncio.create_task(detect_ai_writing(request.draft))
        if request.check_ai_writing
        else None
    )
    plagiarism_task = (
        asyncio.create_task(analyse_plagiarism_risk(request.draft))
        if request.check_plagiarism_risk
        else None
    )
    claims_task = asyncio.create_task(_find_unsupported_claims(request.draft))

    # Gather with individual error isolation
    async def safe(task, name: str):
        if task is None:
            return None
        try:
            result = await task
            checks_performed.append(name)
            return result
        except HTTPException as exc:
            # Re-raise rate-limit errors; swallow others gracefully
            if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
                raise
            logger.warning("verify_service: %s check failed: %s", name, exc.detail)
            return None
        except Exception as exc:
            logger.warning("verify_service: %s check failed: %s", name, exc)
            return None

    citation_result, ai_result, plagiarism_result, unsupported = await asyncio.gather(
        safe(citation_task, "citation"),
        safe(ai_task, "ai_writing"),
        safe(plagiarism_task, "plagiarism_risk"),
        safe(claims_task, "unsupported_claims"),
    )

    # ------------------------------------------------------------------
    # Assemble report
    # ------------------------------------------------------------------
    scores = _compute_scores(
        citation_score=citation_result.score if citation_result else None,
        ai_score=ai_result.score if ai_result else None,
        plagiarism_risk_score=plagiarism_result.risk_score if plagiarism_result else None,
    )

    word_count = len(request.draft.split())
    latency_ms = int((time.perf_counter() - started) * 1000)
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    # Build partial report first so we can derive warnings + fixes from it
    partial = IntegrityReport(
        title=request.title,
        scores=scores,
        citation_check=citation_result,
        ai_writing=ai_result,
        plagiarism_risk=plagiarism_result,
        unsupported_claims=unsupported or [],
        warnings=[],
        recommended_fixes=[],
        metadata=IntegrityReportMetadata(
            model=model,
            latency_ms=latency_ms,
            checks_performed=checks_performed,
            word_count=word_count,
        ),
    )

    partial.warnings = _build_warnings(partial)
    partial.recommended_fixes = _build_fixes(partial)

    return partial
