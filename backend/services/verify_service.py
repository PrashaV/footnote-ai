"""Verification orchestration service.

Runs three grounded integrity checks concurrently:
  1. Citation verification   — real API lookups (Semantic Scholar, CrossRef, OpenAlex)
  2. AI writing detection    — GPTZero trained classifier
  3. Claim-to-citation match — Claude compares draft claims vs. paper abstracts (unique)

Also runs unsupported-claims detection via Claude as an editorial assist.

Plagiarism string-matching is NOT included — we do not have a document
database. Users are directed to Turnitin or Copyleaks for that.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

from anthropic import AsyncAnthropic
from fastapi import HTTPException, status

from models.verify import (
    ClaimMatchResult,
    IntegrityReport,
    IntegrityReportMetadata,
    IntegrityScores,
    RecommendedFix,
    UnsupportedClaim,
    VerifyRequest,
)
from services.ai_detection_service import detect_ai_writing
from services.citation_service import verify_citations
from services.claim_matcher_service import match_claims

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Unsupported-claims detection (Claude — editorial assist)
# ---------------------------------------------------------------------------

_CLAIMS_SYSTEM = """You are a strict academic integrity reviewer. Your job is
to find claims in academic text that NEED a citation but don't have one.
Be CRITICAL — almost every factual statement in academic writing requires
a source. Do not let anything slide.

Return a SINGLE JSON array — no prose, no markdown:
[{
  "text": string,       // the unsupported claim verbatim (≤200 chars)
  "reason": string,     // exactly why this needs a citation
  "suggestion": string  // what type of source would support it
}]

Flag AGGRESSIVELY:
  • Any statistic or numerical claim without a source
  • Any "studies show" or "research suggests" without citing which study
  • Any field-specific definition not attributed to a source
  • Background claims presented as established fact without attribution
  • Any causal claim ("X causes Y", "X leads to Z")
  • Comparative claims ("more effective than", "better than")
  • Historical claims about when something was discovered

For abstracts: flag ALL factual claims — abstracts routinely skip inline
citations but still make claims that need backing.

Return up to 8 items. Only return [] if literally every factual claim
has an inline citation. Default assumption: claims need citations.
Return ONLY the JSON array."""


async def _find_unsupported_claims(draft: str) -> list[UnsupportedClaim]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
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
# Score aggregation
# ---------------------------------------------------------------------------


def _compute_scores(
    citation_score: float | None,
    claim_score: float | None,
    ai_score: float | None,
) -> IntegrityScores:
    """Combine individual scores into IntegrityScores.

    ai_originality = 100 - ai_detection_score (higher = more human-written)
    citation_integrity = citation_score as-is
    claim_accuracy = claim match score as-is

    Weighted overall: 40% citations, 35% claim accuracy, 25% AI originality.
    Defaults when a check is skipped: 50 (unknown/neutral — never inflates score).
    """
    c = citation_score if citation_score is not None else 50.0
    cl = claim_score if claim_score is not None else 50.0
    ai_orig = (100.0 - ai_score) if ai_score is not None else 50.0

    overall = round(0.40 * c + 0.35 * cl + 0.25 * ai_orig, 1)

    return IntegrityScores(
        citation_integrity=round(c, 1),
        claim_accuracy=round(cl, 1),
        ai_originality=round(ai_orig, 1),
        overall=overall,
    )


def _build_warnings(report: IntegrityReport) -> list[str]:
    warnings: list[str] = []

    if report.citation_check:
        cc = report.citation_check
        if cc.total_references == 0:
            warnings.append(
                "No references detected in this text. "
                "Academic writing requires cited sources for factual claims."
            )
        if cc.hallucinated_count > 0:
            warnings.append(
                f"{cc.hallucinated_count} reference(s) appear to be hallucinated — "
                "details don't match any real paper found in scholarly databases."
            )
        if cc.unverified_count > 0:
            warnings.append(
                f"{cc.unverified_count} reference(s) could not be verified in "
                "Semantic Scholar, CrossRef, or OpenAlex."
            )

    if report.claim_match:
        cm = report.claim_match
        if cm.contradicted_count > 0:
            warnings.append(
                f"{cm.contradicted_count} claim(s) appear to contradict what "
                "the cited paper actually says — review these carefully."
            )
        if cm.overstated_count > 0:
            warnings.append(
                f"{cm.overstated_count} claim(s) appear to overstate the cited "
                "paper's findings (e.g. stating causation when paper shows correlation)."
            )

    if report.ai_writing:
        if report.ai_writing.verdict == "likely_ai":
            warnings.append(
                f"GPTZero estimates {round(report.ai_writing.score)}% probability of "
                "AI-generated text. Review flagged passages before submission."
            )
        elif report.ai_writing.verdict == "uncertain":
            warnings.append(
                f"GPTZero detected some AI writing patterns "
                f"({round(report.ai_writing.score)}% AI probability). "
                "Results are inconclusive — review flagged passages."
            )

    if len(report.unsupported_claims) > 3:
        warnings.append(
            f"{len(report.unsupported_claims)} factual claims may lack citation support. "
            "(AI-assisted suggestion — review in context.)"
        )

    return warnings


def _build_fixes(report: IntegrityReport) -> list[RecommendedFix]:
    fixes: list[RecommendedFix] = []

    # Citation fixes
    if report.citation_check:
        for c in report.citation_check.citations:
            if c.status == "hallucinated":
                fixes.append(RecommendedFix(
                    priority="high",
                    category="citation",
                    description=(
                        f"Replace or verify: '{c.reference.raw_text[:100]}'. "
                        "Details don't match any real paper in scholarly databases."
                    ),
                    affected_text=c.reference.raw_text[:150],
                ))
            elif c.status == "unverified":
                fixes.append(RecommendedFix(
                    priority="medium",
                    category="citation",
                    description=(
                        f"Could not verify: '{c.reference.raw_text[:100]}'. "
                        "Add a DOI or check for typos in the author name or year."
                    ),
                    affected_text=c.reference.raw_text[:150],
                ))

    # Claim-match fixes
    if report.claim_match:
        for v in report.claim_match.verdicts:
            if v.verdict == "contradicted":
                fixes.append(RecommendedFix(
                    priority="high",
                    category="claim_match",
                    description=(
                        f"Claim contradicts source: {v.explanation}"
                    ),
                    affected_text=v.claim_text[:150],
                ))
            elif v.verdict == "overstated":
                fixes.append(RecommendedFix(
                    priority="medium",
                    category="claim_match",
                    description=(
                        f"Claim overstates source: {v.explanation}"
                    ),
                    affected_text=v.claim_text[:150],
                ))

    # AI writing fixes
    if report.ai_writing:
        for fp in report.ai_writing.flagged_passages:
            if fp.severity == "high":
                fixes.append(RecommendedFix(
                    priority="medium",
                    category="ai_writing",
                    description=f"GPTZero flagged this passage as likely AI-generated: {fp.reason}",
                    affected_text=fp.text[:150],
                ))

    # Unsupported claims
    for claim in report.unsupported_claims:
        fixes.append(RecommendedFix(
            priority="medium",
            category="unsupported_claim",
            description=f"Add citation: {claim.reason}. {claim.suggestion or ''}".strip(),
            affected_text=claim.text[:150],
        ))

    # Deduplicate and sort
    seen: set[str] = set()
    unique: list[RecommendedFix] = []
    for f in fixes:
        key = f.description[:80]
        if key not in seen:
            seen.add(key)
            unique.append(f)

    order = {"high": 0, "medium": 1, "low": 2}
    unique.sort(key=lambda f: order[f.priority])
    return unique[:20]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def run_verification(request: VerifyRequest) -> IntegrityReport:
    """Run all integrity checks and return an IntegrityReport.

    Checks run concurrently to minimise total latency.
    Individual check failures are isolated and don't abort the whole report.

    Raises:
        HTTPException: on rate-limit errors (pass-through to caller).
    """
    started = time.perf_counter()
    checks_performed: list[str] = []

    # ------------------------------------------------------------------
    # Step 1: Citation verification (always runs if requested)
    # ------------------------------------------------------------------
    citation_result = None
    if request.check_citations:
        try:
            citation_result = await verify_citations(request.draft)
            checks_performed.append("citation_verification")
        except HTTPException as exc:
            if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
                raise
            logger.warning("verify_service: citation check failed: %s", exc.detail)
        except Exception as exc:
            logger.warning("verify_service: citation check failed: %s", exc)

    # ------------------------------------------------------------------
    # Step 2: Claim matching (needs citation results for abstracts)
    # runs after citation so it has access to found_abstract fields
    # ------------------------------------------------------------------
    claim_task = None
    if request.check_claim_matching and citation_result:
        claim_task = asyncio.create_task(match_claims(request.draft, citation_result))

    # ------------------------------------------------------------------
    # Step 3: AI writing detection + unsupported claims (parallel)
    # ------------------------------------------------------------------
    ai_task = (
        asyncio.create_task(detect_ai_writing(request.draft))
        if request.check_ai_writing else None
    )
    claims_task = asyncio.create_task(_find_unsupported_claims(request.draft))

    async def safe(task, name: str):
        if task is None:
            return None
        try:
            result = await task
            checks_performed.append(name)
            return result
        except HTTPException as exc:
            if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
                raise
            logger.warning("verify_service: %s failed: %s", name, exc.detail)
            return None
        except Exception as exc:
            logger.warning("verify_service: %s failed: %s", name, exc)
            return None

    claim_result, ai_result, unsupported = await asyncio.gather(
        safe(claim_task, "claim_matching"),
        safe(ai_task, "ai_writing_detection"),
        safe(claims_task, "unsupported_claims"),
    )

    # ------------------------------------------------------------------
    # Assemble report
    # ------------------------------------------------------------------
    scores = _compute_scores(
        citation_score=citation_result.score if citation_result else None,
        claim_score=claim_result.score if claim_result else None,
        ai_score=ai_result.score if ai_result else None,
    )

    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    latency_ms = int((time.perf_counter() - started) * 1000)
    word_count = len(request.draft.split())

    partial = IntegrityReport(
        title=request.title,
        scores=scores,
        citation_check=citation_result,
        claim_match=claim_result,
        ai_writing=ai_result,
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
