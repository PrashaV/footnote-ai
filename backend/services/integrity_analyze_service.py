"""Integrity analysis service — orchestrates four checks in parallel.

Phase status:
  ✅ run_ai_detection     — Claude sentence scoring + burstiness (Phase 4.2)
  ✅ run_citation_check   — CrossRef + Semantic Scholar + DOAJ (Phase 4.3)
  ✅ run_plagiarism_check — embedding similarity + Semantic Scholar (Phase 4.4)
  🔲 run_claim_match      — stub (Phase 4.5)

Public API
----------
analyze_integrity(content, citations, user_id, document_id)
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
    """Detect AI-generated text using Claude sentence scoring + burstiness.

    Phase 4.2 — fully implemented. See ai_detection_engine.py for details.

    score = AI-likelihood (0.0 = human, 1.0 = AI). Note this is INVERTED
    relative to the other three engines where 1.0 = good / trustworthy.
    """
    logger.debug("run_ai_detection: calling ai_detection_engine (len=%d)", len(content))
    result_dict = await run_ai_detection_engine(content)
    return CheckResult(**result_dict)


async def run_citation_check(content: str, citations: list[CitationRef]) -> CheckResult:
    """Verify citations against CrossRef, Semantic Scholar, and DOAJ.

    Phase 4.3 — fully implemented. See citation_check_engine.py for details.
    """
    from services.citation_check_engine import run_citation_check_engine  # local import

    logger.debug(
        "run_citation_check: calling citation_check_engine (len=%d, citations=%d)",
        len(content),
        len(citations),
    )
    result_dict = await run_citation_check_engine(content, citations)
    return CheckResult(**result_dict)


async def run_plagiarism_check(
    content: str,
    user_id: str = "",
    document_id: str = "",
) -> CheckResult:
    """Check for text-similarity / plagiarism using embedding-based search.

    Phase 4.4 — fully implemented. See plagiarism_check_engine.py for details.

    Algorithm:
      1. Chunk document into overlapping ~100-word windows.
      2. Embed each chunk with OpenAI text-embedding-3-small.
      3. Search Semantic Scholar for each chunk (top 5 papers), embed abstracts,
         compute cosine similarity.
      4. Flag: similarity >= 0.88 (exact), >= 0.75 (paraphrase).
      5. Detect mosaic plagiarism across consecutive sentences.
      6. Self-plagiarism: compare against user's own previous documents.

    Requires OPENAI_API_KEY environment variable. Returns a neutral stub
    result (score=0.9, flagged=False) when the key is absent so the other
    three checks are unaffected.

    Args:
        content:     Full plain-text document content.
        user_id:     Supabase auth user ID — enables self-plagiarism check.
        document_id: Current document UUID — excluded from self-plag comparison.

    Returns:
        CheckResult with score, flagged_sections, plagiarism_matches, summary.
    """
    from services.plagiarism_check_engine import run_plagiarism_check_engine  # local import

    logger.debug(
        "run_plagiarism_check: calling plagiarism_check_engine (len=%d, user=%s)",
        len(content),
        user_id[:8] if user_id else "anon",
    )
    result_dict = await run_plagiarism_check_engine(content, user_id, document_id)
    return CheckResult(**result_dict)


async def run_claim_match(content: str, citations: list[CitationRef]) -> CheckResult:
    """Match in-text claims against the abstracts of their cited sources.

    Phase 4.1 stub — returns a neutral placeholder.
    Phase 4.5 will use Claude to compare each claim against the cited paper's
    abstract and detect overstated, contradicted, or unsupported claims.
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
    user_id: str = "",
    document_id: str = "",
) -> tuple[CheckResult, CheckResult, CheckResult, CheckResult]:
    """Run all four integrity checks concurrently.

    Uses asyncio.gather so all four jobs start immediately and total wall
    time ≈ max(individual latency), not the sum.

    Args:
        content:     Full plain-text document content.
        citations:   Citations attached to the document.
        user_id:     Auth user ID (enables self-plagiarism check in Phase 4.4).
        document_id: Current document UUID (excluded from self-plag comparison).

    Returns:
        (ai_result, citation_result, plagiarism_result, claim_result)
    """
    logger.info(
        "analyze_integrity: running 4 checks in parallel "
        "(content_len=%d, citations=%d, user=%s, doc=%s)",
        len(content),
        len(citations),
        user_id[:8] if user_id else "anon",
        document_id[:8] if document_id else "none",
    )

    ai_result, citation_result, plagiarism_result, claim_result = await asyncio.gather(
        run_ai_detection(content),
        run_citation_check(content, citations),
        run_plagiarism_check(content, user_id, document_id),
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
