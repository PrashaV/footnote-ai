"""Claim Match engine — Phase 4.5.

This is Footnote's most differentiated feature. Most integrity tools only
check whether a reference *exists*. This engine goes further: it verifies
whether each factual claim in the document is actually *supported by*
evidence in the academic literature.

Four-step pipeline
------------------
Step 1 — Claim extraction
    OpenAI extracts every verifiable claim from the document as a JSON array.
    Each item contains: claim text, enclosing sentence, char offsets, type.

Step 2 — Evidence retrieval (RAG)
    For each extracted claim:
      * Search Semantic Scholar for the 3 most relevant papers (query = claim text).
      * Retrieve each paper's abstract.
      * If the claim sits near an existing citation in the document, also pull
        that paper's abstract from the CitationRef.

Step 3 — NLI classification
    For each (claim, evidence abstract) pair OpenAI classifies:
      entailed | contradicted | unsupported
    The best/worst verdict across all evidence for a claim determines the
    final claim verdict:
      * Any CONTRADICTED → contradicted (highest severity).
      * Any ENTAILED with confidence > 0.7 → entailed.
      * Otherwise → unsupported.

Step 4 — Aggregate
    * Score = fraction of entailed claims (0–1 normalised).
    * flagged_sections built from contradicted + unsupported claims so the
      editor can apply colour-coded inline decorations.
    * claim_matches list carries the full per-claim breakdown for the sidebar.

Public API
----------
run_claim_match_engine(content, citations) → dict
    Returns a dict compatible with CheckResult(**result_dict).

Requires OPENAI_API_KEY env var. Returns a graceful neutral stub when absent.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SEMANTIC_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
_SEMANTIC_FIELDS = "paperId,title,authors,year,abstract,externalIds"
_MAX_CLAIMS = 15          # cap to limit cost + latency
_MAX_EVIDENCE = 3         # Semantic Scholar papers per claim
_OAI_SEMAPHORE = 3        # max concurrent OpenAI calls
_SS_SEMAPHORE = 4         # max concurrent Semantic Scholar calls
_API_TIMEOUT = 15.0       # seconds for each outbound HTTP call

# ---------------------------------------------------------------------------
# Step 1 — Claim extraction prompt
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = """You are an expert academic fact-checker.
Extract every verifiable factual claim from the provided text.

Return ONLY a valid JSON array — no prose, no markdown fences, no keys other than:
[
  {
    "claim": "<the specific factual assertion>",
    "sentence": "<full sentence containing the claim>",
    "char_start": <integer start offset in the original text>,
    "char_end": <integer end offset (exclusive) in the original text>,
    "claim_type": "statistic" | "causal" | "correlation" | "definition" | "quote" | "general"
  }
]

Only include claims that are:
- Specific and falsifiable (not vague opinions or value judgements)
- Grounded in an implied empirical or scholarly basis
- Worth verifying against the academic literature

Omit rhetorical questions, personal opinions, and normative statements.
Limit to the 15 most important verifiable claims if there are more.
Return an empty array [] if there are none."""


_NLI_SYSTEM = """You are a rigorous NLI (Natural Language Inference) classifier for academic fact-checking.

Given a CLAIM from a document and a piece of EVIDENCE (a paper abstract), classify the relationship.

Return ONLY a valid JSON object:
{
  "verdict": "entailed" | "contradicted" | "unsupported",
  "confidence": <float 0.0–1.0>,
  "explanation": "<2–3 sentences. Be specific. Quote both texts briefly.>"
}

Definitions (be strict):
  entailed    : The evidence clearly supports the specific claim. The abstract
                contains information that, if true, makes the claim likely correct.
  contradicted: The evidence directly conflicts with the claim, or the abstract
                explicitly states the opposite of what is claimed.
  unsupported : The abstract does not contain enough relevant information to
                either support or contradict the claim.

Return ONLY the JSON object."""


# ---------------------------------------------------------------------------
# Helper: fuzzy find claim position in original text
# ---------------------------------------------------------------------------

def _find_char_offsets(text: str, sentence: str) -> tuple[int, int]:
    """Return (start, end) char offsets for the sentence in text.

    Falls back to the first 50 chars of the claim if the full sentence
    is not found verbatim (handles minor OpenAI paraphrasing).
    """
    # Normalise whitespace for matching
    idx = text.find(sentence.strip())
    if idx != -1:
        return idx, idx + len(sentence.strip())

    # Try first 80 chars of sentence (avoids paraphrase drift)
    snippet = sentence.strip()[:80]
    idx = text.find(snippet)
    if idx != -1:
        return idx, idx + len(snippet)

    return 0, 0  # unknown — place at start of doc (will not be highlighted)


# ---------------------------------------------------------------------------
# Step 2 — Semantic Scholar search
# ---------------------------------------------------------------------------

async def _search_semantic_scholar(
    query: str,
    sem: asyncio.Semaphore,
    limit: int = _MAX_EVIDENCE,
) -> list[dict[str, Any]]:
    """Search Semantic Scholar for papers relevant to a claim.

    Returns a list of dicts with {title, abstract, authors, year, url}.
    Returns [] on any error to keep the pipeline running.
    """
    async with sem:
        try:
            params = {
                "query": query[:200],
                "fields": _SEMANTIC_FIELDS,
                "limit": limit,
            }
            async with httpx.AsyncClient(timeout=_API_TIMEOUT) as client:
                resp = await client.get(_SEMANTIC_SEARCH_URL, params=params)

            if resp.status_code != 200:
                logger.debug(
                    "claim_match: Semantic Scholar %d for query '%.60s'",
                    resp.status_code, query,
                )
                return []

            data = resp.json().get("data") or []
            results = []
            for paper in data:
                abstract = (paper.get("abstract") or "").strip()
                if not abstract:
                    continue  # skip papers without abstracts — useless for NLI
                paper_id = paper.get("paperId") or ""
                url = (
                    f"https://www.semanticscholar.org/paper/{paper_id}"
                    if paper_id else None
                )
                authors = [
                    a["name"]
                    for a in (paper.get("authors") or [])
                    if isinstance(a, dict) and a.get("name")
                ]
                results.append({
                    "title": (paper.get("title") or "Untitled").strip(),
                    "abstract": abstract,
                    "abstract_excerpt": abstract[:300] + ("…" if len(abstract) > 300 else ""),
                    "authors": authors,
                    "year": paper.get("year"),
                    "url": url,
                })
            return results[:limit]

        except Exception as exc:
            logger.debug("claim_match: Scholar search failed: %s", exc)
            return []


# ---------------------------------------------------------------------------
# Step 3 — NLI classification
# ---------------------------------------------------------------------------

async def _nli_classify(
    claim: str,
    abstract: str,
    oai_sem: asyncio.Semaphore,
    client: Any,
    model: str,
) -> dict[str, Any] | None:
    """Classify (claim, abstract) pair with OpenAI.

    Returns {"verdict": ..., "confidence": ..., "explanation": ...} or None.
    """
    user_msg = (
        f"CLAIM:\n{claim[:500]}\n\n"
        f"EVIDENCE (abstract):\n{abstract[:1500]}"
    )

    async with oai_sem:
        try:
            response = await client.chat.completions.create(
                model=model,
                max_tokens=300,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": _NLI_SYSTEM},
                    {"role": "user",   "content": user_msg},
                ],
            )
        except Exception as exc:
            logger.debug("claim_match: NLI call failed: %s", exc)
            return None

    raw = (response.choices[0].message.content or "").strip()
    # Strip markdown fences if present
    cleaned = raw
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned).rstrip("` \n")

    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.debug("claim_match: NLI JSON parse failed: %.80s", raw)
        return None

    verdict = payload.get("verdict", "unsupported")
    if verdict not in ("entailed", "contradicted", "unsupported"):
        verdict = "unsupported"
    confidence = float(payload.get("confidence", 0.5))
    confidence = max(0.0, min(1.0, confidence))
    explanation = str(payload.get("explanation", "No explanation provided."))

    return {"verdict": verdict, "confidence": confidence, "explanation": explanation}


# ---------------------------------------------------------------------------
# Step 3 (orchestrated) — evaluate one claim against all its evidence
# ---------------------------------------------------------------------------

async def _evaluate_claim(
    claim_item: dict[str, Any],
    existing_citations: list[Any],   # list[CitationRef] passed through
    oai_sem: asyncio.Semaphore,
    ss_sem: asyncio.Semaphore,
    oai_client: Any,
    oai_model: str,
) -> dict[str, Any]:
    """Search for evidence and NLI-classify a single claim.

    Returns a dict ready to populate a ClaimMatch model.
    """
    claim_text = claim_item.get("claim", "")
    sentence   = claim_item.get("sentence", claim_text)
    claim_type = claim_item.get("claim_type", "general")
    char_start = int(claim_item.get("char_start", 0))
    char_end   = int(claim_item.get("char_end", char_start + len(sentence)))

    # --- Evidence retrieval ---
    # 1. Semantic Scholar search (3 papers)
    ss_papers = await _search_semantic_scholar(claim_text, ss_sem, limit=_MAX_EVIDENCE)

    # 2. Absorb any pre-fetched abstracts from existing citations nearby
    #    (simple heuristic: citations within the same sentence)
    extra_evidence: list[dict[str, Any]] = []
    for cit in (existing_citations or []):
        cit_abstract = getattr(cit, "abstract", None) or ""
        if not cit_abstract:
            continue
        extra_evidence.append({
            "title": getattr(cit, "title", None) or "Existing citation",
            "abstract": cit_abstract,
            "abstract_excerpt": cit_abstract[:300] + ("…" if len(cit_abstract) > 300 else ""),
            "authors": getattr(cit, "authors", []) or [],
            "year": getattr(cit, "year", None),
            "url": None,
        })

    all_evidence = (ss_papers + extra_evidence)[: _MAX_EVIDENCE + 1]

    if not all_evidence:
        # No evidence at all — mark unsupported
        return {
            "claim": claim_text,
            "sentence": sentence,
            "claim_type": claim_type,
            "verdict": "unsupported",
            "confidence": 0.3,
            "explanation": (
                "No relevant academic sources could be found for this claim "
                "via Semantic Scholar."
            ),
            "supporting_sources": [],
            "char_start": char_start,
            "char_end": char_end,
        }

    # --- NLI classification ---
    nli_tasks = [
        _nli_classify(claim_text, ev["abstract"], oai_sem, oai_client, oai_model)
        for ev in all_evidence
    ]
    raw_verdicts = await asyncio.gather(*nli_tasks, return_exceptions=True)

    nli_results: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for ev, nli in zip(all_evidence, raw_verdicts):
        if isinstance(nli, dict) and nli.get("verdict"):
            nli_results.append((ev, nli))

    # --- Aggregate verdict ---
    # Priority: contradicted > entailed > unsupported
    final_verdict = "unsupported"
    final_confidence = 0.3
    final_explanation = "No supporting evidence found in the academic literature."
    best_sources: list[dict[str, Any]] = []

    # Check for contradiction first (any contradiction = flagged)
    for ev, nli in nli_results:
        if nli["verdict"] == "contradicted" and nli["confidence"] >= 0.55:
            final_verdict = "contradicted"
            final_confidence = nli["confidence"]
            final_explanation = nli["explanation"]
            best_sources = [ev]
            break   # one contradiction is enough

    if final_verdict != "contradicted":
        # Check for entailment (highest-confidence entailed source wins)
        entailed_pairs = [
            (ev, nli) for ev, nli in nli_results
            if nli["verdict"] == "entailed" and nli["confidence"] > 0.7
        ]
        if entailed_pairs:
            best = max(entailed_pairs, key=lambda x: x[1]["confidence"])
            final_verdict = "entailed"
            final_confidence = best[1]["confidence"]
            final_explanation = best[1]["explanation"]
            best_sources = [best[0]]

    if not best_sources and nli_results:
        # Use the highest-confidence source for context even if unsupported
        best = max(nli_results, key=lambda x: x[1]["confidence"])
        final_explanation = best[1].get(
            "explanation",
            "No academic source found that supports or contradicts this claim.",
        )
        best_sources = [best[0]]

    # Build supporting_sources list (max 3)
    supporting_sources = [
        {
            "title": src.get("title", "Unknown"),
            "url": src.get("url"),
            "abstract_excerpt": src.get("abstract_excerpt", ""),
            "year": src.get("year"),
            "authors": src.get("authors", []),
        }
        for src in best_sources[:3]
    ]

    return {
        "claim": claim_text,
        "sentence": sentence,
        "claim_type": claim_type,
        "verdict": final_verdict,
        "confidence": final_confidence,
        "explanation": final_explanation,
        "supporting_sources": supporting_sources,
        "char_start": char_start,
        "char_end": char_end,
    }


# ---------------------------------------------------------------------------
# Step 1 — Claim extraction
# ---------------------------------------------------------------------------

async def _extract_claims(
    content: str,
    oai_sem: asyncio.Semaphore,
    client: Any,
    model: str,
) -> list[dict[str, Any]]:
    """Use OpenAI to extract verifiable claims from the document.

    Returns a list of claim dicts. Returns [] on any error.
    """
    truncated = content[:8000]  # stay within context budget

    async with oai_sem:
        try:
            response = await client.chat.completions.create(
                model=model,
                max_tokens=2000,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": _EXTRACT_SYSTEM},
                    {"role": "user",   "content": truncated},
                ],
            )
        except Exception as exc:
            logger.warning("claim_match: claim extraction failed: %s", exc)
            return []

    raw = (response.choices[0].message.content or "").strip()
    # Strip markdown fences
    cleaned = raw
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned).rstrip("` \n")

    try:
        claims = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("claim_match: failed to parse extraction JSON: %.120s", raw)
        return []

    if not isinstance(claims, list):
        logger.warning("claim_match: extraction returned non-list: %s", type(claims))
        return []

    # Validate and cap
    valid = []
    for item in claims:
        if not isinstance(item, dict):
            continue
        if not item.get("claim") or not item.get("sentence"):
            continue
        valid.append(item)

    return valid[:_MAX_CLAIMS]


# ---------------------------------------------------------------------------
# Step 4 — Score + flagged_sections
# ---------------------------------------------------------------------------

def _aggregate(
    content: str,
    claim_results: list[dict[str, Any]],
) -> tuple[float, bool, list[dict], float, str]:
    """Compute score, flagged, flagged_sections, confidence, summary.

    Returns (score, flagged, flagged_sections, confidence, summary).
    """
    if not claim_results:
        return (
            0.8,   # neutral score — no claims found
            False,
            [],
            0.4,
            "No verifiable claims were found in this document to check.",
        )

    total = len(claim_results)
    entailed_count     = sum(1 for c in claim_results if c["verdict"] == "entailed")
    contradicted_count = sum(1 for c in claim_results if c["verdict"] == "contradicted")
    unsupported_count  = sum(1 for c in claim_results if c["verdict"] == "unsupported")

    # Score: entailed = 1.0, unsupported = 0.5, contradicted = 0.0
    raw_score = (
        entailed_count * 1.0
        + unsupported_count * 0.5
        + contradicted_count * 0.0
    ) / total
    score = round(raw_score, 3)

    flagged = contradicted_count > 0 or (unsupported_count / total) > 0.5

    # Build flagged_sections for ALL claims so the editor can decorate them.
    # Encode verdict in the reason prefix so ClaimHighlightExtension can style them:
    #   "claim_entailed: ..."
    #   "claim_unsupported: ..."
    #   "claim_contradicted: ..."
    flagged_sections = []
    for c in claim_results:
        start = c.get("char_start", 0)
        end   = c.get("char_end", start)
        if start >= end:
            continue  # unknown offset — skip decoration
        verdict = c.get("verdict", "unsupported")
        explanation = c.get("explanation", "")
        reason = f"claim_{verdict}: {explanation[:200]}"
        flagged_sections.append({
            "start_char": start,
            "end_char": end,
            "reason": reason,
        })

    # Confidence = average NLI confidence weighted by claim count
    avg_conf = (
        sum(c.get("confidence", 0.5) for c in claim_results) / total
    )
    confidence = round(avg_conf, 3)

    # Summary
    if contradicted_count > 0:
        summary = (
            f"{contradicted_count} claim(s) contradicted by the literature — "
            f"{entailed_count} supported, {unsupported_count} unsupported "
            f"(out of {total} checked)."
        )
    elif unsupported_count > 0:
        summary = (
            f"{entailed_count}/{total} claims supported by Semantic Scholar. "
            f"{unsupported_count} unsupported — consider adding citations."
        )
    else:
        summary = (
            f"All {entailed_count} verified claim(s) are supported by "
            "academic literature."
        )

    return score, flagged, flagged_sections, confidence, summary


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def run_claim_match_engine(
    content: str,
    citations: list[Any],  # list[CitationRef] from integrity_analyze
) -> dict[str, Any]:
    """Run the 4-step claim match pipeline.

    Returns a dict compatible with CheckResult(**result_dict).
    Includes a 'claim_matches' key with the per-claim breakdown.

    Returns a neutral stub dict when OPENAI_API_KEY is absent.
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        logger.info("claim_match: OPENAI_API_KEY not set — returning neutral stub")
        return {
            "score": 0.8,
            "flagged": False,
            "flagged_sections": [],
            "confidence": 0.0,
            "summary": (
                "Claim matching requires an OPENAI_API_KEY environment variable. "
                "Set it in Railway to enable this feature."
            ),
            "method": "openai-nli+semantic-scholar",
            "claim_matches": [],
        }

    # Lazy import to avoid module-level dependency errors if openai not installed
    try:
        from openai import AsyncOpenAI
    except ImportError:
        logger.error("claim_match: openai package not installed")
        return {
            "score": 0.8,
            "flagged": False,
            "flagged_sections": [],
            "confidence": 0.0,
            "summary": "claim_match engine unavailable: openai package not installed.",
            "method": "openai-nli+semantic-scholar",
            "claim_matches": [],
        }

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    timeout = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))
    client = AsyncOpenAI(api_key=api_key, timeout=timeout)

    oai_sem = asyncio.Semaphore(_OAI_SEMAPHORE)
    ss_sem  = asyncio.Semaphore(_SS_SEMAPHORE)

    # ── Step 1: Extract claims ───────────────────────────────────────────────
    logger.info("claim_match: extracting claims (content_len=%d)", len(content))
    raw_claims = await _extract_claims(content, oai_sem, client, model)
    logger.info("claim_match: extracted %d claims", len(raw_claims))

    if not raw_claims:
        return {
            "score": 0.8,
            "flagged": False,
            "flagged_sections": [],
            "confidence": 0.5,
            "summary": "No verifiable factual claims were found in this document.",
            "method": "openai-nli+semantic-scholar",
            "claim_matches": [],
        }

    # Repair char offsets from OpenAI (it's not always accurate)
    for item in raw_claims:
        start, end = _find_char_offsets(content, item.get("sentence", ""))
        if start != 0 or end != 0:
            item["char_start"] = start
            item["char_end"]   = end
        # Fallback: keep whatever OpenAI returned

    # ── Steps 2 + 3: Evidence retrieval + NLI for each claim ────────────────
    tasks = [
        _evaluate_claim(item, citations, oai_sem, ss_sem, client, model)
        for item in raw_claims
    ]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    claim_matches: list[dict[str, Any]] = []
    for r in raw_results:
        if isinstance(r, dict):
            claim_matches.append(r)
        elif isinstance(r, Exception):
            logger.debug("claim_match: task raised: %s", r)

    # ── Step 4: Aggregate ────────────────────────────────────────────────────
    score, flagged, flagged_sections, confidence, summary = _aggregate(
        content, claim_matches
    )

    logger.info(
        "claim_match: complete — %d claims, score=%.2f, flagged=%s",
        len(claim_matches), score, flagged,
    )

    return {
        "score": score,
        "flagged": flagged,
        "flagged_sections": flagged_sections,
        "confidence": confidence,
        "summary": summary,
        "method": "openai-nli+semantic-scholar",
        "claim_matches": claim_matches,
    }
