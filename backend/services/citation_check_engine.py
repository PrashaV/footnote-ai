"""Citation Check engine — Phase 4.3.

Five checks run for every citation passed from the frontend:

  1. Format validation   — missing year / author / title; malformed DOI
  2. DOI resolution      — CrossRef API; title + first-author match
  3. Retraction check    — Semantic Scholar isRetracted field
  4. Quote accuracy      — quoted phrases in context window vs. abstract
  5. Predatory journal   — DOAJ API lookup; trusted-publisher fast-path

All per-citation checks run concurrently (asyncio.gather) behind a shared
semaphore that limits outbound API concurrency to 4.  This keeps total
latency ≈ max(per-citation latency) while staying polite to public APIs.

External APIs used (all free, no key required):
  CrossRef      https://api.crossref.org/works/{doi}
  Semantic Scholar  https://api.semanticscholar.org/graph/v1/paper/{id}
  DOAJ          https://doaj.org/api/search/journals/{query}

Score
-----
Each citation starts at 1.0.  Severity deductions:
  high   → -0.45
  medium → -0.20
  low    → -0.07
Per-citation score = max(0.0, 1.0 - sum_of_deductions).
Document score = mean of per-citation scores.
If no citations: score = 0.80 (neutral / unable to assess).
"""

from __future__ import annotations

import asyncio
import logging
import re
import statistics
from typing import Optional
from urllib.parse import quote as url_quote

import httpx

from models.integrity_analyze import CitationRef, FlaggedCitation

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CROSSREF_URL = "https://api.crossref.org/works/{doi}"
SEMANTIC_URL = "https://api.semanticscholar.org/graph/v1/paper/{id}"
SEMANTIC_FIELDS = "paperId,title,authors,year,isRetracted,abstract,externalIds"
DOAJ_URL = "https://doaj.org/api/search/journals/{query}"

# Polite User-Agent header for CrossRef (gives priority access)
CROSSREF_HEADERS = {
    "User-Agent": "Footnote-IntegrityEngine/1.0 (mailto:support@footnote.ai)"
}

API_TIMEOUT = 12.0   # seconds per request
API_CONCURRENCY = 4  # max simultaneous outbound requests

_SEVERITY_DEDUCTIONS = {"high": 0.45, "medium": 0.20, "low": 0.07}

# Minimum word-overlap fraction to consider a title a match
TITLE_MATCH_THRESHOLD = 0.60
# Minimum word-overlap fraction to consider a quote verified in an abstract
QUOTE_MATCH_THRESHOLD = 0.55

# Publishers whose journals are unconditionally trusted (skip DOAJ)
_TRUSTED_PUBLISHERS: frozenset[str] = frozenset({
    "elsevier", "springer", "springer nature", "nature publishing group",
    "wiley", "wiley-blackwell", "john wiley & sons",
    "oxford university press", "cambridge university press",
    "taylor & francis", "informa", "routledge",
    "sage", "sage publications",
    "plos", "public library of science",
    "biomed central", "bmc",
    "ieee", "acm",
    "american chemical society", "acs",
    "american physical society", "aps",
    "american psychological association", "apa",
    "nih", "national institutes of health",
    "frontiers", "frontiers media",
    "mdpi",
    "cell press", "lancet", "bmj", "nejm", "jama", "new england journal",
    "nature", "science", "pnas",
})

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _word_overlap(a: str, b: str) -> float:
    """Return Jaccard-like word overlap between two strings (case-insensitive)."""
    wa = set(re.sub(r"[^\w\s]", "", a.lower()).split())
    wb = set(re.sub(r"[^\w\s]", "", b.lower()).split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / max(len(wa), len(wb))


def _label(citation: CitationRef) -> str:
    """Short display label for a citation (used in issue descriptions)."""
    parts: list[str] = []
    if citation.authors:
        last = citation.authors[0].split(",")[0].split()[-1]
        parts.append(last + (" et al." if len(citation.authors) > 1 else ""))
    if citation.year:
        parts.append(str(citation.year))
    if citation.title:
        parts.append(f'"{citation.title[:50]}"')
    return " ".join(parts) or (citation.raw_text or "Unknown citation")[:80]


# ---------------------------------------------------------------------------
# Check 1 — Format validation (no API)
# ---------------------------------------------------------------------------


def _check_format(citation: CitationRef) -> list[FlaggedCitation]:
    issues: list[FlaggedCitation] = []
    label = _label(citation)

    if not citation.title:
        issues.append(FlaggedCitation(
            citation_text=label,
            issue_type="missing_field",
            detail="Citation has no title — cannot verify the paper exists.",
            severity="medium",
        ))

    if not citation.authors:
        issues.append(FlaggedCitation(
            citation_text=label,
            issue_type="missing_field",
            detail="Citation has no author names listed.",
            severity="medium",
        ))

    if not citation.year:
        issues.append(FlaggedCitation(
            citation_text=label,
            issue_type="missing_field",
            detail="Citation is missing a publication year.",
            severity="low",
        ))
    elif citation.year < 1600 or citation.year > 2030:
        issues.append(FlaggedCitation(
            citation_text=label,
            issue_type="format_error",
            detail=f"Publication year {citation.year} looks implausible.",
            severity="low",
        ))

    if citation.doi:
        # Valid DOI pattern: 10.XXXX/anything
        if not re.match(r"^10\.\d{4,9}/\S+$", citation.doi.strip()):
            issues.append(FlaggedCitation(
                citation_text=label,
                issue_type="format_error",
                detail=f"DOI \"{citation.doi}\" appears malformed (should start with 10.XXXX/).",
                severity="low",
            ))

    return issues


# ---------------------------------------------------------------------------
# Check 2 — DOI resolution via CrossRef
# ---------------------------------------------------------------------------


async def _check_doi_crossref(
    citation: CitationRef,
    client: httpx.AsyncClient,
) -> tuple[list[FlaggedCitation], Optional[dict]]:
    """Resolve DOI via CrossRef.  Returns (issues, crossref_message_or_None)."""
    if not citation.doi:
        return [], None

    label = _label(citation)
    doi_enc = url_quote(citation.doi.strip(), safe="")

    try:
        resp = await client.get(
            CROSSREF_URL.format(doi=doi_enc),
            headers=CROSSREF_HEADERS,
            timeout=API_TIMEOUT,
        )
    except Exception as exc:
        logger.debug("citation_check: CrossRef request failed: %s", exc)
        return [], None

    if resp.status_code == 404:
        return [FlaggedCitation(
            citation_text=label,
            issue_type="doi_not_found",
            detail=f"DOI {citation.doi} returned 404 from CrossRef — paper may not exist.",
            severity="high",
        )], None

    if resp.status_code != 200:
        logger.debug("citation_check: CrossRef returned %d for %s", resp.status_code, citation.doi)
        return [], None

    try:
        msg = resp.json().get("message", {})
    except Exception:
        return [], None

    issues: list[FlaggedCitation] = []

    # Title match
    cr_titles = msg.get("title") or []
    cr_title = cr_titles[0] if cr_titles else ""
    if citation.title and cr_title:
        similarity = _word_overlap(citation.title, cr_title)
        if similarity < TITLE_MATCH_THRESHOLD:
            issues.append(FlaggedCitation(
                citation_text=label,
                issue_type="title_mismatch",
                detail=(
                    f'Cited as "{citation.title[:60]}" but CrossRef found '
                    f'"{cr_title[:60]}". Possible wrong paper or typo.'
                ),
                severity="high",
            ))

    # First-author last-name match (loose check)
    cr_authors = msg.get("author") or []
    if citation.authors and cr_authors:
        cited_last = citation.authors[0].split(",")[0].split()[-1].lower()
        cr_last = cr_authors[0].get("family", "").lower()
        if cited_last and cr_last and cited_last not in cr_last and cr_last not in cited_last:
            issues.append(FlaggedCitation(
                citation_text=label,
                issue_type="author_mismatch",
                detail=(
                    f'First author cited as "{citation.authors[0]}" but CrossRef '
                    f'lists "{cr_authors[0].get("family", "?")}, '
                    f'{cr_authors[0].get("given", "")}". May be a different paper.'
                ),
                severity="medium",
            ))

    return issues, msg


# ---------------------------------------------------------------------------
# Check 3 — Retraction check via Semantic Scholar
# ---------------------------------------------------------------------------


async def _check_retraction(
    citation: CitationRef,
    client: httpx.AsyncClient,
) -> tuple[list[FlaggedCitation], Optional[dict]]:
    """Check isRetracted on Semantic Scholar.  Returns (issues, paper_data_or_None)."""
    label = _label(citation)

    # Prefer direct paper_id lookup; fall back to DOI
    if citation.paper_id:
        paper_id = citation.paper_id
    elif citation.doi:
        paper_id = f"DOI:{citation.doi.strip()}"
    else:
        return [], None

    try:
        resp = await client.get(
            SEMANTIC_URL.format(id=url_quote(paper_id, safe=":")),
            params={"fields": SEMANTIC_FIELDS},
            timeout=API_TIMEOUT,
        )
    except Exception as exc:
        logger.debug("citation_check: Semantic Scholar request failed: %s", exc)
        return [], None

    if resp.status_code != 200:
        logger.debug("citation_check: Semantic Scholar returned %d for %s", resp.status_code, paper_id)
        return [], None

    try:
        data = resp.json()
    except Exception:
        return [], None

    if data.get("isRetracted"):
        return [FlaggedCitation(
            citation_text=label,
            issue_type="retracted",
            detail=(
                f'This paper has been retracted according to Semantic Scholar. '
                f'Using retracted research without disclosure is a serious integrity issue.'
            ),
            severity="high",
        )], data

    return [], data


# ---------------------------------------------------------------------------
# Check 4 — Quote accuracy (context window vs. abstract)
# ---------------------------------------------------------------------------

_QUOTE_RE = re.compile(
    r'["\u201c]([^"\u201d]{8,200})["\u201d]'  # straight and curly double-quotes
)


def _check_quote_accuracy(
    citation: CitationRef,
    content: str,
    abstract: str,
) -> list[FlaggedCitation]:
    """Find quoted phrases near the citation and verify them against the abstract."""
    if not abstract or not citation.raw_text:
        return []

    label = _label(citation)
    issues: list[FlaggedCitation] = []

    # Locate the citation inline reference in the document
    try:
        match = re.search(re.escape(citation.raw_text), content)
    except re.error:
        return []

    if not match:
        # Try a shorter prefix of raw_text
        prefix = citation.raw_text[:20] if len(citation.raw_text) > 20 else None
        if prefix:
            match = re.search(re.escape(prefix), content)
    if not match:
        return []

    # 400-char window either side of the citation
    win_start = max(0, match.start() - 400)
    win_end = min(len(content), match.end() + 400)
    window = content[win_start:win_end]

    abstract_lower = abstract.lower()

    for quote_match in _QUOTE_RE.finditer(window):
        phrase = quote_match.group(1).strip()
        if len(phrase) < 8:
            continue

        # Fast path: exact substring
        if phrase.lower() in abstract_lower:
            continue

        # Trigram overlap fallback (handles minor transcription differences)
        words = phrase.lower().split()
        if len(words) < 3:
            continue

        n_trigrams = len(words) - 2
        matched = sum(
            1 for i in range(n_trigrams)
            if " ".join(words[i : i + 3]) in abstract_lower
        )
        if matched / n_trigrams < QUOTE_MATCH_THRESHOLD:
            issues.append(FlaggedCitation(
                citation_text=label,
                issue_type="quote_mismatch",
                detail=(
                    f'Quoted phrase "{phrase[:70]}…" '
                    f'was not found in the paper\'s abstract. '
                    f'Verify the quote comes from this source.'
                ),
                severity="medium",
            ))

    return issues


# ---------------------------------------------------------------------------
# Check 5 — Predatory journal detection via DOAJ
# ---------------------------------------------------------------------------


async def _check_predatory(
    citation: CitationRef,
    crossref_msg: Optional[dict],
    client: httpx.AsyncClient,
) -> list[FlaggedCitation]:
    """Flag journals not listed in DOAJ (Directory of Open Access Journals)."""
    label = _label(citation)

    # Resolve journal name and publisher
    journal_name: Optional[str] = None
    publisher: Optional[str] = None

    if crossref_msg:
        titles = crossref_msg.get("container-title") or []
        journal_name = titles[0] if titles else None
        publisher = crossref_msg.get("publisher") or None

    if not journal_name:
        return []  # no journal info — skip rather than false-flag

    # Fast-path: skip DOAJ if publisher is in the trusted list
    if publisher:
        pub_lower = publisher.lower()
        if any(trusted in pub_lower for trusted in _TRUSTED_PUBLISHERS):
            return []

    # Call DOAJ
    try:
        resp = await client.get(
            DOAJ_URL.format(query=url_quote(journal_name, safe="")),
            params={"pageSize": 1},
            timeout=API_TIMEOUT,
        )
    except Exception as exc:
        logger.debug("citation_check: DOAJ request failed: %s", exc)
        return []

    if resp.status_code != 200:
        return []

    try:
        data = resp.json()
        total = data.get("total", 0)
    except Exception:
        return []

    if total == 0:
        return [FlaggedCitation(
            citation_text=label,
            issue_type="predatory_journal",
            detail=(
                f'Journal "{journal_name[:60]}" was not found in DOAJ '
                f'(Directory of Open Access Journals). '
                f'Verify it is a legitimate peer-reviewed venue.'
            ),
            severity="low",
        )]

    return []


# ---------------------------------------------------------------------------
# Per-citation orchestrator
# ---------------------------------------------------------------------------


async def _check_citation(
    citation: CitationRef,
    content: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> list[FlaggedCitation]:
    """Run all 5 checks for a single citation under the shared semaphore."""
    async with semaphore:
        issues: list[FlaggedCitation] = []

        # Check 1 — format (sync, no API)
        issues.extend(_check_format(citation))

        # Checks 2 & 3 run in parallel (both need network)
        doi_issues, crossref_msg = await _check_doi_crossref(citation, client)
        retraction_issues, semantic_data = await _check_retraction(citation, client)

        issues.extend(doi_issues)
        issues.extend(retraction_issues)

        # Check 4 — quote accuracy (needs abstract from Semantic Scholar)
        if semantic_data:
            abstract = semantic_data.get("abstract") or ""
            issues.extend(_check_quote_accuracy(citation, content, abstract))

        # Check 5 — predatory journal (needs CrossRef container-title)
        issues.extend(await _check_predatory(citation, crossref_msg, client))

        return issues


# ---------------------------------------------------------------------------
# Score computation
# ---------------------------------------------------------------------------


def _compute_score(
    all_issues: list[list[FlaggedCitation]],
    n_citations: int,
) -> tuple[float, float]:
    """Return (score, confidence) for the citation check as a whole.

    score     0.0 = all citations problematic, 1.0 = all citations clean
    confidence grows with the number of citations that could be checked
    """
    if n_citations == 0:
        return 0.80, 0.30  # no citations to assess

    per_citation_scores: list[float] = []
    for issues in all_issues:
        deduction = sum(_SEVERITY_DEDUCTIONS.get(iss.severity, 0.10) for iss in issues)
        per_citation_scores.append(max(0.0, 1.0 - deduction))

    score = round(statistics.mean(per_citation_scores), 3)
    # Confidence: rises with n_citations, but capped (we only check APIs, not full text)
    confidence = round(min(0.85, 0.40 + (n_citations / 15) * 0.45), 3)
    return score, confidence


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_citation_check_engine(
    content: str,
    citations: list[CitationRef],
) -> dict:
    """Run all citation checks and return a CheckResult-shaped dict.

    Keys: score, flagged, flagged_sections, flagged_citations, confidence,
          summary, method.
    """
    from models.integrity_analyze import CheckResult, FlaggedSection

    if not citations:
        return CheckResult(
            score=0.80,
            flagged=False,
            flagged_sections=[],
            flagged_citations=[],
            confidence=0.25,
            summary=(
                "No citations were passed to the citation check engine. "
                "Add citations via the @ command in the editor."
            ),
            method="crossref+semantic_scholar+doaj",
        ).model_dump()

    semaphore = asyncio.Semaphore(API_CONCURRENCY)

    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        per_citation_issues = await asyncio.gather(
            *[
                _check_citation(citation, content, client, semaphore)
                for citation in citations
            ],
            return_exceptions=True,
        )

    # Flatten and handle exceptions (keep partial results)
    cleaned: list[list[FlaggedCitation]] = []
    for result in per_citation_issues:
        if isinstance(result, Exception):
            logger.warning("citation_check: per-citation task raised: %s", result)
            cleaned.append([])
        else:
            cleaned.append(result)  # type: ignore[arg-type]

    all_flagged: list[FlaggedCitation] = [issue for group in cleaned for issue in group]

    score, confidence = _compute_score(cleaned, len(citations))
    flagged = score < 0.75

    # Build flagged_sections: find citation raw_text positions in content
    flagged_sections: list[FlaggedSection] = []
    bad_citation_texts: set[str] = {iss.citation_text for iss in all_flagged}
    for citation in citations:
        raw = citation.raw_text or ""
        label = _label(citation)
        if label not in bad_citation_texts and raw not in bad_citation_texts:
            continue
        if not raw:
            continue
        try:
            m = re.search(re.escape(raw), content)
        except re.error:
            continue
        if m:
            flagged_sections.append(FlaggedSection(
                start_char=m.start(),
                end_char=m.end(),
                reason=f"Citation has integrity issues — see Integrity sidebar.",
            ))

    # ── Summary ──────────────────────────────────────────────────────────────
    n = len(citations)
    n_issues = len(all_flagged)
    n_high = sum(1 for iss in all_flagged if iss.severity == "high")

    if n_issues == 0:
        summary = (
            f"All {n} citation{'s' if n != 1 else ''} passed CrossRef, "
            f"Semantic Scholar, and DOAJ checks."
        )
    else:
        parts = [
            f"{n_issues} issue{'s' if n_issues != 1 else ''} found across {n} "
            f"citation{'s' if n != 1 else ''}."
        ]
        if n_high:
            parts.append(
                f"{n_high} high-severity issue{'s' if n_high != 1 else ''} "
                f"(retraction, DOI not found, or title mismatch) require immediate attention."
            )
        summary = " ".join(parts)

    return CheckResult(
        score=score,
        flagged=flagged,
        flagged_sections=flagged_sections[:20],
        flagged_citations=all_flagged[:40],
        confidence=confidence,
        summary=summary,
        method="crossref+semantic_scholar+doaj",
    ).model_dump()
