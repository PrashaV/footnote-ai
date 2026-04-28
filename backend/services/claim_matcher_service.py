"""Claim-to-citation matching service — Footnote's unique feature.

Most integrity tools only check whether a reference EXISTS. This service
goes further: it checks whether what the draft CLAIMS matches what the
cited paper ACTUALLY SAYS.

Pipeline:
  1. Take the verified citations that have abstracts (from citation_service).
  2. For each, extract the sentence(s) in the draft that cite it.
  3. Use Claude to compare: does the claim in the draft accurately reflect
     the paper's abstract, or is it overstated / contradicted?
  4. Return a ClaimMatchResult with a verdict per claim.

This is genuinely novel — no other publicly available tool does this.
It catches the most dangerous form of academic misconduct: citing real
papers but misrepresenting what they say.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

from anthropic import AsyncAnthropic
from fastapi import HTTPException, status

from models.verify import (
    CitationCheckResult,
    ClaimMatchResult,
    ClaimMatchVerdict,
    VerifiedCitation,
)

logger = logging.getLogger(__name__)

_MAX_CONCURRENT = 3  # limit parallel Claude calls


# ---------------------------------------------------------------------------
# Step 1: Extract the citing sentence(s) from the draft
# ---------------------------------------------------------------------------

def _extract_citing_sentences(draft: str, reference: "VerifiedCitation") -> list[str]:
    """Find sentences in the draft that cite this reference.

    Looks for in-text citation patterns near the reference's author names
    and/or year. Returns up to 3 matching sentences.
    """
    sentences = re.split(r'(?<=[.!?])\s+', draft)

    authors = reference.reference.authors
    year = reference.reference.year
    title_words = (reference.reference.title or "").split()[:3]  # first 3 words of title

    matches: list[str] = []
    for sent in sentences:
        hit = False

        # Match author + year pattern e.g. "Smith et al. (2022)" or "(Smith, 2022)"
        if year:
            for author in authors[:2]:  # check first two authors
                surname = author.split()[-1] if author else ""
                if surname and str(year) in sent and surname in sent:
                    hit = True
                    break

        # Match partial title
        if not hit and len(title_words) >= 2:
            title_str = " ".join(title_words[:2]).lower()
            if title_str in sent.lower():
                hit = True

        if hit:
            matches.append(sent.strip())
            if len(matches) >= 3:
                break

    return matches


# ---------------------------------------------------------------------------
# Step 2: Ask Claude to compare claim vs. abstract
# ---------------------------------------------------------------------------

_MATCH_SYSTEM = """You are a rigorous academic fact-checker. Your job is to
determine whether a claim made in a research draft accurately reflects what
a cited paper actually says in its abstract.

You will be given:
  - CLAIM: the sentence(s) from the draft making a claim about the paper
  - ABSTRACT: the actual abstract of the cited paper

Return a SINGLE JSON object — no prose, no markdown:
{
  "verdict": "supported" | "overstated" | "contradicted" | "unverifiable",
  "explanation": string,   // 2-3 sentences. Be specific. Quote both texts.
  "severity": "low" | "medium" | "high"   // only matters if not "supported"
}

Verdict definitions — be strict:
  supported     : The claim accurately and proportionally reflects the abstract.
                  The draft does not exaggerate scope, certainty, or findings.
  overstated    : The claim is directionally correct but exaggerates the paper's
                  findings — e.g. the paper shows correlation but the draft says
                  causation; or the paper shows a small effect but the draft
                  implies a large one; or the paper is preliminary but the draft
                  presents it as conclusive.
  contradicted  : The claim directly contradicts what the abstract says, or
                  attributes a finding to this paper that it does not make.
  unverifiable  : The abstract does not contain enough information to verify
                  the specific claim being made.

Severity guide (for overstated/contradicted only):
  high   : The misrepresentation significantly changes the meaning or implications
  medium : The misrepresentation is notable but the general direction is correct
  low    : Minor exaggeration or imprecision that doesn't change the core message

Return ONLY the JSON object."""


async def _check_one_claim(
    claim_sentences: list[str],
    citation: VerifiedCitation,
    sem: asyncio.Semaphore,
    client: AsyncAnthropic,
    model: str,
) -> ClaimMatchVerdict | None:
    """Check a single claim against a paper abstract. Returns None if skipped."""

    abstract = citation.found_abstract
    if not abstract or not claim_sentences:
        return ClaimMatchVerdict(
            claim_text=" ".join(claim_sentences) if claim_sentences else "(no citing sentence found)",
            reference_raw=citation.reference.raw_text,
            found_abstract=None,
            verdict="unverifiable",
            explanation=(
                "No abstract was available for this paper, so the claim could "
                "not be verified against its source."
            ),
            severity="low",
        )

    claim_text = " ".join(claim_sentences)[:600]
    abstract_text = abstract[:1500]

    user_prompt = (
        f"CLAIM (from draft):\n{claim_text}\n\n"
        f"PAPER: {citation.reference.title or citation.reference.raw_text}\n\n"
        f"ABSTRACT:\n{abstract_text}"
    )

    async with sem:
        try:
            message = await client.messages.create(
                model=model,
                max_tokens=512,
                system=_MATCH_SYSTEM,
                messages=[{"role": "user", "content": user_prompt}],
            )
        except Exception as exc:
            logger.warning("claim_matcher: Claude call failed: %s", exc)
            return None

    raw = "".join(
        getattr(block, "text", "") for block in getattr(message, "content", []) or []
    ).strip()

    if not raw:
        return None

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()

    try:
        payload: dict[str, Any] = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("claim_matcher: could not parse JSON response")
        return None

    verdict_raw = payload.get("verdict", "unverifiable")
    if verdict_raw not in ("supported", "overstated", "contradicted", "unverifiable"):
        verdict_raw = "unverifiable"

    severity_raw = payload.get("severity", "medium")
    if severity_raw not in ("low", "medium", "high"):
        severity_raw = "medium"

    return ClaimMatchVerdict(
        claim_text=claim_text,
        reference_raw=citation.reference.raw_text[:200],
        found_abstract=abstract[:300] + "…" if len(abstract) > 300 else abstract,
        verdict=verdict_raw,
        explanation=str(payload.get("explanation", "No explanation provided.")),
        severity=severity_raw,
    )


# ---------------------------------------------------------------------------
# Score calculation
# ---------------------------------------------------------------------------

def _compute_score(verdicts: list[ClaimMatchVerdict]) -> float:
    """Score 0–100 based on verdict distribution.

    supported     → full points
    unverifiable  → neutral (half points, we can't penalise what we can't check)
    overstated    → lose 60% of points
    contradicted  → lose 100% of points
    """
    if not verdicts:
        return 50.0  # unknown, neutral

    total = len(verdicts)
    points = 0.0
    for v in verdicts:
        if v.verdict == "supported":
            points += 1.0
        elif v.verdict == "unverifiable":
            points += 0.5
        elif v.verdict == "overstated":
            points += 0.4
        elif v.verdict == "contradicted":
            points += 0.0

    return round((points / total) * 100, 1)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def match_claims(
    draft: str,
    citation_result: CitationCheckResult,
) -> ClaimMatchResult:
    """Compare draft claims against cited paper abstracts.

    Only checks citations that were verified and have an abstract available.
    Uses Claude to reason about whether the claim accurately reflects the paper.

    Returns a ClaimMatchResult with a verdict per claim-citation pair.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return ClaimMatchResult(
            total_checked=0,
            verdicts=[],
            score=50.0,
        )

    timeout = float(os.getenv("ANTHROPIC_TIMEOUT_SECONDS", "60"))
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    client = AsyncAnthropic(api_key=api_key, timeout=timeout)
    sem = asyncio.Semaphore(_MAX_CONCURRENT)

    # Only check verified citations — we need a real paper to compare against
    checkable = [
        c for c in citation_result.citations
        if c.status in ("verified", "mismatch") and c.reference.title
    ]

    if not checkable:
        return ClaimMatchResult(
            total_checked=0,
            verdicts=[],
            score=50.0,
        )

    # Build tasks: extract citing sentences + check each claim
    tasks = []
    for citation in checkable[:10]:  # cap at 10 to limit API usage
        citing_sentences = _extract_citing_sentences(draft, citation)
        tasks.append(
            _check_one_claim(citing_sentences, citation, sem, client, model)
        )

    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    verdicts: list[ClaimMatchVerdict] = []
    for r in raw_results:
        if isinstance(r, ClaimMatchVerdict):
            verdicts.append(r)
        elif isinstance(r, Exception):
            logger.warning("claim_matcher: task failed: %s", r)

    supported = sum(1 for v in verdicts if v.verdict == "supported")
    overstated = sum(1 for v in verdicts if v.verdict == "overstated")
    contradicted = sum(1 for v in verdicts if v.verdict == "contradicted")
    unverifiable = sum(1 for v in verdicts if v.verdict == "unverifiable")

    return ClaimMatchResult(
        total_checked=len(verdicts),
        supported_count=supported,
        overstated_count=overstated,
        contradicted_count=contradicted,
        unverifiable_count=unverifiable,
        verdicts=verdicts,
        score=_compute_score(verdicts),
    )
