"""Plagiarism Check engine — Phase 4.4.

Algorithm
---------
1. Chunking
   Split the document into overlapping ~100-word chunks (20-word stride).
   Each chunk carries its start/end character offsets so the frontend can
   highlight the flagged region in the editor.

2. Embeddings
   Batch-embed every chunk with OpenAI text-embedding-3-small.
   Falls back gracefully (no matches returned) when OPENAI_API_KEY is absent.

3. Source search
   For each chunk: extract key noun phrases → Semantic Scholar paper/search API
   (top 5 papers per chunk) → embed each paper's abstract → cosine similarity
   against the chunk embedding.

4. Flagging
   similarity >= 0.88  → match_type "exact"      (near-verbatim copy)
   similarity >= 0.75  → match_type "paraphrase"  (reworded / paraphrased)
   Only the best-matching source per chunk is reported.

5. Mosaic detection
   Split the document into individual sentences. If >= MOSAIC_CONSECUTIVE
   consecutive sentences each have a Semantic Scholar match (even below
   the normal thresholds, >= 0.65) from *different* sources, flag the
   entire run as match_type "mosaic".

6. Self-plagiarism
   When user_id is provided: query the Supabase documents table for the
   user's most recent OTHER documents (up to 5), chunk + embed them, and
   compare against the current document's chunks.
   similarity >= 0.85 → match_type "self"

Returns a CheckResult-shaped dict:
  score              float  0.0 = high plagiarism, 1.0 = fully original
  flagged            bool
  flagged_sections   list[FlaggedSection]  character ranges for editor
  plagiarism_matches list[PlagiarismMatch] rich per-match data for sidebar
  confidence         float
  summary            str
  method             str
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tuneable constants
# ---------------------------------------------------------------------------

CHUNK_WORDS = 100          # target words per chunk
OVERLAP_WORDS = 20         # overlap between consecutive chunks
EXACT_THRESHOLD = 0.88     # cosine sim → "exact" match
PARAPHRASE_THRESHOLD = 0.75  # cosine sim → "paraphrase" match
MOSAIC_LOWER = 0.65        # minimum per-sentence sim for mosaic detection
MOSAIC_CONSECUTIVE = 3     # consecutive sentences from diff sources → mosaic
SELF_THRESHOLD = 0.85      # self-plagiarism cosine sim threshold
MAX_CHUNKS = 40            # cap to limit OpenAI + Semantic Scholar calls
SS_RESULTS_PER_CHUNK = 5   # Semantic Scholar papers to fetch per chunk
API_CONCURRENCY = 3        # simultaneous Semantic Scholar fetches
EMBED_BATCH = 20           # chunks to embed per OpenAI API call
SS_TIMEOUT = 12.0          # seconds
SELF_DOC_LIMIT = 5         # previous documents to check for self-plagiarism

SEMANTIC_SEARCH_URL = (
    "https://api.semanticscholar.org/graph/v1/paper/search"
)
SEMANTIC_FIELDS = "paperId,title,abstract,authors,year,externalIds"

# Common English stop-words — used for query extraction
_STOP = frozenset({
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "this", "that", "these",
    "those", "it", "its", "as", "which", "who", "what", "how", "when",
    "where", "why", "their", "they", "we", "our", "you", "your", "he",
    "she", "his", "her", "not", "no", "so", "if", "then", "than", "into",
    "about", "also", "can", "just", "more", "such", "between", "through",
    "while", "during", "each", "both", "other", "same", "very",
})

# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def _chunk_document(
    text: str,
    chunk_words: int = CHUNK_WORDS,
    overlap_words: int = OVERLAP_WORDS,
) -> list[tuple[str, int, int]]:
    """Return list of (chunk_text, start_char, end_char) from *text*.

    Uses regex to locate every whitespace-delimited token so that start/end
    character offsets are exact positions in the original string.
    """
    # Find every non-whitespace token with its char positions
    tokens: list[tuple[str, int, int]] = [
        (m.group(), m.start(), m.end())
        for m in re.finditer(r"\S+", text)
    ]

    if not tokens:
        return []

    stride = max(1, chunk_words - overlap_words)
    chunks: list[tuple[str, int, int]] = []
    i = 0

    while i < len(tokens) and len(chunks) < MAX_CHUNKS:
        window = tokens[i : i + chunk_words]
        chunk_text = " ".join(t[0] for t in window)
        start_char = window[0][1]
        end_char = window[-1][2]
        chunks.append((chunk_text, start_char, end_char))

        # If this window already reached the end, stop
        if i + chunk_words >= len(tokens):
            break
        i += stride

    return chunks


# ---------------------------------------------------------------------------
# Query extraction (no NLTK required)
# ---------------------------------------------------------------------------


def _extract_query(chunk: str, max_words: int = 12) -> str:
    """Extract key content words from *chunk* for a Semantic Scholar search query.

    Strips punctuation, removes stop-words, keeps the first *max_words*
    significant tokens. Caps the result at 200 chars (API safety).
    """
    tokens = re.sub(r"[^\w\s]", " ", chunk).split()
    content = [
        t for t in tokens
        if t.lower() not in _STOP and len(t) > 2
    ]
    query = " ".join(content[:max_words])
    return query[:200]


# ---------------------------------------------------------------------------
# Cosine similarity (pure Python — no numpy needed)
# ---------------------------------------------------------------------------


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Return cosine similarity in [0, 1] between two equal-length vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)


# ---------------------------------------------------------------------------
# OpenAI embeddings
# ---------------------------------------------------------------------------


async def _batch_embed(
    texts: list[str],
    api_key: str,
) -> list[Optional[list[float]]]:
    """Embed *texts* in batches using OpenAI text-embedding-3-small.

    Returns a list of the same length as *texts*; entries are None where
    embedding failed.
    """
    try:
        from openai import AsyncOpenAI  # type: ignore
    except ImportError:
        logger.warning("plagiarism_engine: openai package not installed")
        return [None] * len(texts)

    client = AsyncOpenAI(api_key=api_key, timeout=30.0)
    embeddings: list[Optional[list[float]]] = []

    for i in range(0, len(texts), EMBED_BATCH):
        batch = [t[:8_000] for t in texts[i : i + EMBED_BATCH]]
        try:
            resp = await client.embeddings.create(
                model="text-embedding-3-small",
                input=batch,
            )
            # Results are returned in the same order as inputs
            batch_vecs: dict[int, list[float]] = {
                item.index: item.embedding for item in resp.data
            }
            for j in range(len(batch)):
                embeddings.append(batch_vecs.get(j))
        except Exception as exc:
            logger.warning(
                "plagiarism_engine: embedding batch %d failed: %s", i // EMBED_BATCH, exc
            )
            embeddings.extend([None] * len(batch))

    return embeddings


# ---------------------------------------------------------------------------
# Semantic Scholar search + abstract embedding
# ---------------------------------------------------------------------------


async def _search_and_embed_papers(
    query: str,
    api_key: str,
    http: httpx.AsyncClient,
) -> list[dict]:
    """Search Semantic Scholar for *query*, embed each abstract.

    Returns a list of dicts:
      paperId, title, authors, year, url, abstract, embedding
    """
    try:
        resp = await http.get(
            SEMANTIC_SEARCH_URL,
            params={
                "query": query,
                "limit": SS_RESULTS_PER_CHUNK,
                "fields": SEMANTIC_FIELDS,
            },
            timeout=SS_TIMEOUT,
        )
    except Exception as exc:
        logger.debug("plagiarism_engine: Semantic Scholar search failed: %s", exc)
        return []

    if resp.status_code != 200:
        logger.debug(
            "plagiarism_engine: Semantic Scholar returned %d", resp.status_code
        )
        return []

    try:
        data = resp.json().get("data") or []
    except Exception:
        return []

    papers: list[dict] = []
    abstracts: list[str] = []

    for p in data:
        abstract = (p.get("abstract") or "").strip()
        if not abstract:
            continue
        authors = [
            a.get("name", "") for a in (p.get("authors") or [])
        ]
        ext_ids = p.get("externalIds") or {}
        doi = ext_ids.get("DOI")
        ss_id = p.get("paperId", "")
        url = (
            f"https://www.semanticscholar.org/paper/{ss_id}"
            if ss_id
            else None
        )
        papers.append({
            "paperId": ss_id,
            "title": (p.get("title") or "Untitled")[:200],
            "authors": authors,
            "year": p.get("year"),
            "url": url,
            "doi": doi,
            "abstract": abstract,
            "embedding": None,
        })
        abstracts.append(abstract)

    if not abstracts:
        return []

    # Embed all abstracts in one batch call
    vecs = await _batch_embed(abstracts, api_key)
    for i, paper in enumerate(papers):
        paper["embedding"] = vecs[i] if i < len(vecs) else None

    return papers


# ---------------------------------------------------------------------------
# Per-chunk check
# ---------------------------------------------------------------------------


async def _check_chunk(
    chunk: tuple[str, int, int],
    chunk_vec: Optional[list[float]],
    api_key: str,
    http: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> Optional[dict]:
    """Search Semantic Scholar for the chunk and return the best match, or None.

    The returned dict has:
      text_excerpt, start_char, end_char, matched_source, similarity_score, match_type
    """
    chunk_text, start_char, end_char = chunk

    if chunk_vec is None:
        return None

    query = _extract_query(chunk_text)
    if not query:
        return None

    async with semaphore:
        papers = await _search_and_embed_papers(query, api_key, http)
        # Small courtesy delay between Semantic Scholar calls
        await asyncio.sleep(0.15)

    best_sim = 0.0
    best_paper: Optional[dict] = None

    for paper in papers:
        if paper["embedding"] is None:
            continue
        sim = _cosine_similarity(chunk_vec, paper["embedding"])
        if sim > best_sim:
            best_sim = sim
            best_paper = paper

    if best_paper is None or best_sim < MOSAIC_LOWER:
        return None

    match_type: Optional[str] = None
    if best_sim >= EXACT_THRESHOLD:
        match_type = "exact"
    elif best_sim >= PARAPHRASE_THRESHOLD:
        match_type = "paraphrase"
    # Below PARAPHRASE_THRESHOLD but >= MOSAIC_LOWER — only used for mosaic
    # detection downstream; don't report as a standalone match.

    source = {
        "paperId":  best_paper["paperId"],
        "title":    best_paper["title"],
        "authors":  best_paper["authors"],
        "year":     best_paper["year"],
        "url":      best_paper["url"],
        "doi":      best_paper["doi"],
    }

    return {
        "text_excerpt":     chunk_text[:300],
        "start_char":       start_char,
        "end_char":         end_char,
        "matched_source":   source,
        "similarity_score": round(best_sim, 4),
        "match_type":       match_type,  # None = below threshold (used for mosaic)
        "_paper_id":        best_paper["paperId"],  # internal — stripped before return
    }


# ---------------------------------------------------------------------------
# Mosaic detection
# ---------------------------------------------------------------------------

_SENT_SPLIT_RE = re.compile(
    r"(?<=[.!?])\s+(?=[A-Z\"\u201c])",
)


def _detect_mosaic(
    content: str,
    chunk_results: list[dict],
) -> list[dict]:
    """Detect mosaic plagiarism: >= MOSAIC_CONSECUTIVE consecutive sentences,
    each matched to a *different* source (even below the normal thresholds).

    Walks sentences, maps each to the best matching chunk result by character
    overlap, then looks for runs of different-source matches.

    Returns additional PlagiarismMatch dicts with match_type="mosaic".
    """
    # Build sentence list with char offsets
    sentences: list[tuple[str, int, int]] = []
    seg_start = 0
    for m in _SENT_SPLIT_RE.finditer(content):
        seg = content[seg_start : m.start() + 1].strip()
        if seg:
            sentences.append((seg, seg_start, m.start() + 1))
        seg_start = m.end()
    tail = content[seg_start:].strip()
    if tail:
        sentences.append((tail, seg_start, len(content)))

    # Map sentence → best chunk_result by character overlap
    def _best_chunk_for_sentence(
        sent_start: int, sent_end: int
    ) -> Optional[dict]:
        best: Optional[dict] = None
        best_overlap = 0
        for cr in chunk_results:
            overlap = min(cr["end_char"], sent_end) - max(
                cr["start_char"], sent_start
            )
            if overlap > best_overlap:
                best_overlap = overlap
                best = cr
        return best if best_overlap > 0 else None

    sentence_sources = [
        _best_chunk_for_sentence(s, e) for _, s, e in sentences
    ]

    # Scan for runs of MOSAIC_CONSECUTIVE sentences from different sources
    mosaic_matches: list[dict] = []
    n = len(sentences)
    i = 0
    while i < n:
        run_start = i
        run_sources: list[str] = []
        while i < n:
            cr = sentence_sources[i]
            if cr is None:
                break
            pid = cr.get("_paper_id", "")
            if not pid:
                break
            # New paper id must differ from all previous in run
            if pid in run_sources:
                break
            run_sources.append(pid)
            i += 1

        run_len = i - run_start
        if run_len >= MOSAIC_CONSECUTIVE:
            run_sents = sentences[run_start:i]
            run_text = " ".join(s for s, _, _ in run_sents)
            run_start_char = run_sents[0][1]
            run_end_char = run_sents[-1][2]

            # Use the first matched source as the representative source
            rep_cr = sentence_sources[run_start]
            if rep_cr:
                mosaic_matches.append({
                    "text_excerpt":     run_text[:300],
                    "start_char":       run_start_char,
                    "end_char":         run_end_char,
                    "matched_source":   rep_cr["matched_source"],
                    "similarity_score": rep_cr["similarity_score"],
                    "match_type":       "mosaic",
                    "_paper_id":        rep_cr.get("_paper_id", ""),
                })
        else:
            i += 1  # restart the scan from next position

    return mosaic_matches


# ---------------------------------------------------------------------------
# Self-plagiarism via Supabase
# ---------------------------------------------------------------------------


async def _check_self_plagiarism(
    chunks: list[tuple[str, int, int]],
    chunk_embeddings: list[Optional[list[float]]],
    user_id: str,
    document_id: str,
    api_key: str,
) -> list[dict]:
    """Compare current document chunks against user's previous documents.

    Queries Supabase for up to SELF_DOC_LIMIT other documents by this user,
    chunks + embeds them, and flags any chunk in the current doc with
    cosine similarity >= SELF_THRESHOLD as self-plagiarism.
    """
    from db import get_supabase  # local import to avoid circular

    sb = get_supabase()
    if not sb:
        return []

    try:
        query = (
            sb.table("documents")
            .select("id, title, content")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(SELF_DOC_LIMIT + 1)
            .execute()
        )
        rows = query.data or []
    except Exception as exc:
        logger.warning("plagiarism_engine: Supabase query failed: %s", exc)
        return []

    # Exclude the current document
    other_docs = [
        r for r in rows if r.get("id") != document_id
    ][:SELF_DOC_LIMIT]

    if not other_docs:
        return []

    self_matches: list[dict] = []

    for doc in other_docs:
        prev_content = (doc.get("content") or "").strip()
        if not prev_content or len(prev_content.split()) < 30:
            continue

        prev_chunks = _chunk_document(prev_content)
        if not prev_chunks:
            continue

        prev_texts = [c[0] for c in prev_chunks]
        prev_vecs = await _batch_embed(prev_texts, api_key)

        for ci, (chunk_text, start_char, end_char) in enumerate(chunks):
            cv = chunk_embeddings[ci]
            if cv is None:
                continue
            for pi, pv in enumerate(prev_vecs):
                if pv is None:
                    continue
                sim = _cosine_similarity(cv, pv)
                if sim >= SELF_THRESHOLD:
                    self_matches.append({
                        "text_excerpt":   chunk_text[:300],
                        "start_char":     start_char,
                        "end_char":       end_char,
                        "matched_source": {
                            "paperId":  None,
                            "title":    doc.get("title") or "Untitled document",
                            "authors":  [],
                            "year":     None,
                            "url":      None,
                            "doi":      None,
                            "is_self":  True,
                        },
                        "similarity_score": round(sim, 4),
                        "match_type":       "self",
                        "_paper_id":        f"self:{doc['id']}",
                    })
                    break  # one self-match per current chunk is enough

    return self_matches


# ---------------------------------------------------------------------------
# Score computation
# ---------------------------------------------------------------------------

_MATCH_TYPE_WEIGHT = {
    "exact":     1.0,
    "paraphrase": 0.70,
    "mosaic":    0.80,
    "self":      0.50,
}


def _compute_score(
    flagged_matches: list[dict],
    total_chunks: int,
) -> tuple[float, float]:
    """Return (score, confidence).

    score  1.0 = fully original, 0.0 = heavily plagiarised
    """
    if total_chunks == 0:
        return 0.9, 0.1

    # Weighted penalty: each flagged chunk subtracts from the original score
    penalty = 0.0
    for m in flagged_matches:
        weight = _MATCH_TYPE_WEIGHT.get(m["match_type"] or "", 0.5)
        penalty += weight / max(total_chunks, 1)

    score = max(0.0, round(1.0 - penalty, 3))

    # Confidence grows with chunk count
    confidence = round(min(0.85, 0.30 + (total_chunks / 30) * 0.55), 3)

    return score, confidence


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_plagiarism_check_engine(
    content: str,
    user_id: str = "",
    document_id: str = "",
) -> dict:
    """Run the full plagiarism check pipeline on *content*.

    Returns a CheckResult-shaped dict with an extra ``plagiarism_matches`` key
    holding the rich per-match data (list of PlagiarismMatch-compatible dicts).

    Keys: score, flagged, flagged_sections, plagiarism_matches, confidence,
          summary, method.
    """
    from models.integrity_analyze import CheckResult, FlaggedSection, PlagiarismMatch

    started = time.perf_counter()

    # ── Validate environment ────────────────────────────────────────────────
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_key:
        logger.info(
            "plagiarism_engine: OPENAI_API_KEY not set — returning neutral stub"
        )
        return CheckResult(
            score=0.9,
            flagged=False,
            flagged_sections=[],
            plagiarism_matches=[],
            confidence=0.1,
            summary=(
                "Plagiarism check requires OPENAI_API_KEY to compute text embeddings. "
                "Add the key to your environment variables to enable this check."
            ),
            method="unavailable",
        ).model_dump()

    # ── Chunk the document ──────────────────────────────────────────────────
    chunks = _chunk_document(content)
    if not chunks:
        return CheckResult(
            score=0.9,
            flagged=False,
            flagged_sections=[],
            plagiarism_matches=[],
            confidence=0.1,
            summary="Document is too short for plagiarism analysis (no chunks produced).",
            method="embedding+semantic_scholar",
        ).model_dump()

    logger.info(
        "plagiarism_engine: %d chunks (user=%s doc=%s)",
        len(chunks),
        user_id[:8] if user_id else "anon",
        document_id[:8] if document_id else "none",
    )

    # ── Embed all chunks at once ────────────────────────────────────────────
    chunk_texts = [c[0] for c in chunks]
    chunk_embeddings = await _batch_embed(chunk_texts, openai_key)

    # ── Search Semantic Scholar for each chunk in parallel ──────────────────
    semaphore = asyncio.Semaphore(API_CONCURRENCY)

    async with httpx.AsyncClient(timeout=SS_TIMEOUT) as http:
        tasks = [
            _check_chunk(chunks[i], chunk_embeddings[i], openai_key, http, semaphore)
            for i in range(len(chunks))
        ]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    chunk_results: list[dict] = []
    for r in raw_results:
        if isinstance(r, dict):
            chunk_results.append(r)
        elif isinstance(r, Exception):
            logger.debug("plagiarism_engine: chunk check raised: %s", r)

    # ── Mosaic detection ────────────────────────────────────────────────────
    mosaic_matches = _detect_mosaic(content, chunk_results)

    # ── Self-plagiarism ─────────────────────────────────────────────────────
    self_matches: list[dict] = []
    if user_id:
        try:
            self_matches = await _check_self_plagiarism(
                chunks, chunk_embeddings, user_id, document_id, openai_key
            )
        except Exception as exc:
            logger.warning("plagiarism_engine: self-plagiarism check failed: %s", exc)

    # ── Collect only reportable matches ────────────────────────────────────
    # "reportable" = match_type is not None (i.e., above PARAPHRASE_THRESHOLD)
    reportable: list[dict] = [
        cr for cr in chunk_results if cr.get("match_type") is not None
    ] + mosaic_matches + self_matches

    # De-duplicate by start_char (keep highest similarity)
    seen_starts: dict[int, dict] = {}
    for m in reportable:
        sc = m["start_char"]
        if sc not in seen_starts or m["similarity_score"] > seen_starts[sc]["similarity_score"]:
            seen_starts[sc] = m
    reportable = list(seen_starts.values())

    # Sort by position in document
    reportable.sort(key=lambda m: m["start_char"])

    # ── Build CheckResult fields ────────────────────────────────────────────
    flagged_sections = [
        FlaggedSection(
            start_char=m["start_char"],
            end_char=m["end_char"],
            reason=(
                f"{m['match_type'].capitalize()} match "
                f"({round(m['similarity_score'] * 100)}% similarity) — "
                f"{m['matched_source'].get('title', 'unknown source')[:80]}"
            ),
        )
        for m in reportable
    ]

    plagiarism_matches = [
        PlagiarismMatch(
            text_excerpt=m["text_excerpt"],
            start_char=m["start_char"],
            end_char=m["end_char"],
            matched_source=m["matched_source"],
            similarity_score=m["similarity_score"],
            match_type=m["match_type"],
        )
        for m in reportable
    ]

    score, confidence = _compute_score(reportable, len(chunks))
    flagged = bool(reportable)

    # ── Human-readable summary ──────────────────────────────────────────────
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    n_matches = len(reportable)
    n_exact = sum(1 for m in reportable if m["match_type"] == "exact")
    n_paraphrase = sum(1 for m in reportable if m["match_type"] == "paraphrase")
    n_mosaic = sum(1 for m in reportable if m["match_type"] == "mosaic")
    n_self = sum(1 for m in reportable if m["match_type"] == "self")

    if n_matches == 0:
        summary = (
            f"No significant similarity found across {len(chunks)} chunks "
            f"(checked against Semantic Scholar). "
            f"Document appears original."
        )
    else:
        parts = [
            f"{n_matches} plagiarism flag{'s' if n_matches != 1 else ''} "
            f"across {len(chunks)} chunks."
        ]
        breakdown: list[str] = []
        if n_exact:
            breakdown.append(f"{n_exact} exact/near-verbatim")
        if n_paraphrase:
            breakdown.append(f"{n_paraphrase} paraphrase")
        if n_mosaic:
            breakdown.append(f"{n_mosaic} mosaic")
        if n_self:
            breakdown.append(f"{n_self} self-plagiarism")
        if breakdown:
            parts.append("Breakdown: " + ", ".join(breakdown) + ".")
        summary = " ".join(parts)

    logger.info(
        "plagiarism_engine: done in %dms — %d matches (score=%.2f)",
        elapsed_ms,
        n_matches,
        score,
    )

    return CheckResult(
        score=score,
        flagged=flagged,
        flagged_sections=flagged_sections[:30],
        plagiarism_matches=plagiarism_matches[:30],
        confidence=confidence,
        summary=summary,
        method="embedding+semantic_scholar",
    ).model_dump()
