"""Integrity analysis service — orchestrates four checks in parallel.

Phase 4.2 status:
  ✅ run_ai_detection  — perplexity proxy (OpenAI) + burstiness
  🔲 run_citation_check  — stub (Phase 4.3)
  🔲 run_plagiarism_check — stub (Phase 4.4)
  🔲 run_claim_match    — stub (Phase 4.5)

Public API
----------
analyze_integrity(content, citations)
    → (ai_result, citation_result, plagiarism_result, claim_result)

All four jobs run concurrently via asyncio.gather so total latency ≈
max(individual latency) rather than sum.
"""

from __future__ import annotations

import asyncio
import logging

from models.integrity_analyze import CheckResult, CitationRef
from services.ai_detection_engine import run_ai_detection_engine

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Live engines
# ---------------------------------------------------------------------------


async def run_ai_detection(content: str) -> CheckResult:
    """Detect AI-generated text using perplexity proxy + burstiness analysis.

    Phase 4.2 — fully implemented. See ai_detection_engine.py for details.

    score = AI-likelihood (0.0 = human, 1.0 = AI). Note this is INVERTED
    relative to the other three engines where 1.0 = good / trustworthy.

    Args:
        content: Full plain-text document content.

    Returns:
        CheckResult with score, flagged status, flagged_sections, and summary.
    """
    logger.debug("run_ai_detection: calling ai_detection_engine (len=%d)", len(content))

    result_dict = await run_ai_detection_engine(content)
    return CheckResult(**result_dict)


async def run_citation_check(content: str, citations: list[CitationRef]) -> CheckResult:
    """Verify citations against external scholarly databases.

    Phase 4.1 stub — returns a neutral placeholder.
    Phase 4.3 will call Semantic Scholar, CrossRef, and OpenAlex.

    Args:
        content:   Full plain-text document content.
        citations: Citations attached to the document.

    Returns:
        CheckResult with score, flagged status, and summary.
    """
    await asyncio.sleep(0)

    logger.debug(
        "run_citation_check: stub called (len=%d, citations=%d)",
        len(content),
        len(citations),
    )

    n = len(citations)
    return CheckResult(
        score=0.8,
        flagged=False,
        flagged_sections=[],
        confidence=0.5,
        summary=(
            f"Citation check engine not yet implemented — coming in Phase 4.3. "
            f"{n} citation{'s' if n != 1 else ''} pending verification."
        ),
    )


async def run_plagiarism_check(content: str) -> CheckResult:
    """Check for text-similarity / plagiarism risk.

    Phase 4.1 stub — returns a neutral placeholder.
    Phase 4.4 will integrate a similarity / fingerprinting engine.

    Args:
        content: Full plain-text document content.

    Returns:
        CheckResult with score, flagged status, and summary.
    """
    await asyncio.sleep(0)

    logger.debug("run_plagiarism_check: stub called (len=%d)", len(content))

    return CheckResult(
        score=0.9,
        flagged=False,
        flagged_sections=[],
        confidence=0.5,
        summary="Plagiarism check engine not yet implemented — coming in Phase 4.4.",
    )


async def run_claim_match(content: str, citations: list[CitationRef]) -> CheckResult:
    """Match in-text claims against the abstracts of their cited sources.

    Phase 4.1 stub — returns a neutral placeholder.
    Phase 4.5 will use Claude to compare each claim against the cited paper's
    abstract and detect overstated, contradicted, or unsupported claims.

    Args:
        content:   Full plain-text document content.
        citations: Citations attached to the document (used to fetch abstracts).

    Returns:
        CheckResult with score, flagged status, and summary.
    """
    await asyncio.sleep(0)

    logger.debug(
        "run_claim_match: stub called (len=%d, citations=%d)",
        len(content),
        len(citations),
    )

    return CheckResult(
        score=0.8,
        flagged=False,
        flagged_sections=[],
        confidence=0.5,
        summary="Claim-to-source matching engine not yet implemented — coming in Phase 4.5.",
    )


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def analyze_integrity(
    content: str,
    citations: list[CitationRef],
) -> tuple[CheckResult, CheckResult, CheckResult, CheckResult]:
    """Run all four integrity checks concurrently.

    Uses asyncio.gather so all four jobs start immediately and total wall
    time ≈ max(individual latency), not the sum.

    Individual check failures are NOT caught here — callers should wrap
    each task with a safe() helper if they want isolated failure handling.
    For Phase 4.1 stubs this is fine; real engines may raise.

    Returns:
        (ai_result, citation_result, plagiarism_result, claim_result)
    """
    logger.info(
        "analyze_integrity: running 4 checks in parallel (content_len=%d, citations=%d)",
        len(content),
        len(citations),
    )

    ai_result, citation_result, plagiarism_result, claim_result = await asyncio.gather(
        run_ai_detection(content),
        run_citation_check(content, citations),
        run_plagiarism_check(content),
        run_claim_match(content, citations),
    )

    logger.info(
        "analyze_integrity: complete — scores ai=%.2f cite=%.2f plag=%.2f claim=%.2f",
        ai_result.score,
        citation_result.score,
        plagiarism_result.score,
        claim_result.score,
    )

    return ai_result, citation_result, plagiarism_result, claim_result
