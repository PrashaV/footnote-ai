"""AI Writing Detection engine — Phase 4.2.

Method: Claude sentence scoring + Burstiness analysis.

Claude sentence scoring
-----------------------
Splits the document into sentences, then sends them to Claude in batches of 10.
Claude returns a JSON array of AI-likelihood scores (0.0–1.0) for each sentence.
Uses the same ANTHROPIC_API_KEY already in the stack — no new credentials needed.
The scoring model defaults to claude-haiku-4-5-20251001 (fast, cheap) but can be
overridden via the ANTHROPIC_SCORING_MODEL environment variable.

Burstiness
----------
AI text has low variance in sentence length and structure. We compute the
coefficient of variation (CV = stdev / mean) of character lengths across
all sentences. Low CV → likely AI.

  cv=0.0  → burstiness_score=1.0  (perfectly uniform / AI)
  cv≥0.70 → burstiness_score=0.0  (highly varied / human)

Combined score
--------------
  combined = 0.65 * claude_score + 0.35 * burstiness_score  (if API available)
  combined = burstiness_score                                  (fallback)

Flagged sections
----------------
Sentences scoring > SENTENCE_FLAG_THRESHOLD (0.75) are returned as
FlaggedSection objects with character offsets into the original content string.

Environment variables
---------------------
  ANTHROPIC_API_KEY        — required (already used by the rest of the backend)
  ANTHROPIC_SCORING_MODEL  — optional model override (default: claude-haiku-4-5-20251001)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import statistics
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SENTENCE_FLAG_THRESHOLD = 0.75
DEFAULT_SCORING_MODEL = "claude-haiku-4-5-20251001"

# Sentences to score per Claude call (keep prompts small → low latency + cost)
CLAUDE_BATCH_SIZE = 10
# Cap total sentences sent to Claude (cost control)
MAX_SENTENCES_TO_SCORE = 30


# ---------------------------------------------------------------------------
# Sentence splitting
# ---------------------------------------------------------------------------

# Matches end-punctuation + whitespace + start of next sentence.
# Skips common abbreviations so "Dr. Smith" or "et al. (2022)" don't split.
_SENT_BOUNDARY = re.compile(
    r"""
    (?<!\b(?:Mr|Ms|Dr|Prof|Sr|Jr|vs|etc|al|eg|ie|Fig|No|Vol|pp|cf)\.)
    (?<![A-Z]\.)        # not after single-letter initial
    (?<=[.!?])          # must follow end-punctuation
    \s+                 # the whitespace gap between sentences
    (?=[A-Z"'\u201c])  # followed by capital or opening quote
    """,
    re.VERBOSE,
)


def _split_sentences(text: str) -> list[tuple[str, int, int]]:
    """Split *text* into ``(sentence, start_char, end_char)`` tuples.

    Offsets are absolute positions in *text* — the same string sent to the
    backend — so the frontend can use them directly for editor decorations.
    """
    if not text or not text.strip():
        return []

    results: list[tuple[str, int, int]] = []
    seg_start = 0

    for match in _SENT_BOUNDARY.finditer(text):
        seg_end = match.start() + 1  # include the terminal punctuation
        segment = text[seg_start:seg_end]

        stripped = segment.lstrip()
        leading = len(segment) - len(stripped)
        actual_start = seg_start + leading
        actual_text = stripped.rstrip()
        actual_end = actual_start + len(actual_text)

        if actual_text:
            results.append((actual_text, actual_start, actual_end))

        seg_start = match.end()

    # Final segment
    segment = text[seg_start:]
    stripped = segment.lstrip()
    leading = len(segment) - len(stripped)
    actual_start = seg_start + leading
    actual_text = stripped.rstrip()
    actual_end = actual_start + len(actual_text)

    if actual_text:
        results.append((actual_text, actual_start, actual_end))

    return results


# ---------------------------------------------------------------------------
# Burstiness analysis
# ---------------------------------------------------------------------------


def _compute_burstiness_score(
    sentences: list[tuple[str, int, int]],
) -> tuple[float, float]:
    """Return ``(score, confidence)`` in ``[0, 1]``.

    score → 1.0 = uniform sentence lengths (AI-like)
    score → 0.0 = high length variance (human-like)
    """
    if len(sentences) < 5:
        return 0.5, 0.25

    lengths = [len(s[0]) for s in sentences]
    mean_len = statistics.mean(lengths)

    if mean_len < 1:
        return 0.5, 0.25

    stdev = statistics.stdev(lengths) if len(lengths) > 1 else 0.0
    cv = stdev / mean_len

    # cv=0.0 → score=1.0 (uniform/AI), cv≥0.70 → score=0.0 (varied/human)
    score = max(0.0, min(1.0, 1.0 - cv / 0.70))
    confidence = min(0.80, 0.25 + (len(sentences) / 30) * 0.55)

    return round(score, 3), round(confidence, 3)


# ---------------------------------------------------------------------------
# Claude sentence scoring
# ---------------------------------------------------------------------------

_SENTENCE_SCORING_SYSTEM = """\
You are an expert forensic linguist specialising in AI-generated text detection.

For each sentence in the JSON array provided, output an AI-likelihood score:
  0.0 = almost certainly human-written
  1.0 = almost certainly AI-generated

Indicators that push a score HIGHER (towards AI):
  • Unnaturally smooth, metronomic sentence rhythm
  • Generic hedging: "it is important to note", "it is worth mentioning"
  • Perfectly balanced, symmetrical sentence structure
  • Formulaic transitions: "Furthermore,", "Moreover,", "In conclusion,"
  • Absence of any personal voice, specificity, or genuine insight
  • Padding phrases that add length without substance

Indicators that push a score LOWER (towards human):
  • Irregular structure — fragments, asides, dashes
  • Field-specific jargon used correctly and naturally in context
  • Genuine specificity: named examples, dates, personal observations
  • Natural imperfections: hedged opinions, qualifications, self-corrections
  • Conversational register or rhetorical questions

Return ONLY a valid JSON array of numbers with exactly the same length as the input.
No prose, no markdown, no explanation. Example:
Input:  ["Sentence one.", "Sentence two."]
Output: [0.2, 0.8]\
"""


async def _score_sentences_with_claude(
    sentences: list[tuple[str, int, int]],
    api_key: str,
    model: str,
) -> list[Optional[float]]:
    """Return per-sentence AI-likelihood scores from Claude.

    Processes up to MAX_SENTENCES_TO_SCORE sentences in batches of CLAUDE_BATCH_SIZE.
    Returns None for any sentence that couldn't be scored.
    """
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=api_key, timeout=45.0)
    subset = sentences[:MAX_SENTENCES_TO_SCORE]
    all_scores: list[Optional[float]] = []

    for i in range(0, len(subset), CLAUDE_BATCH_SIZE):
        batch = subset[i : i + CLAUDE_BATCH_SIZE]
        batch_texts = [sent for sent, _, _ in batch]

        try:
            message = await client.messages.create(
                model=model,
                max_tokens=256,
                system=_SENTENCE_SCORING_SYSTEM,
                messages=[
                    {
                        "role": "user",
                        "content": json.dumps(batch_texts),
                    }
                ],
            )

            raw = "".join(
                getattr(block, "text", "")
                for block in (message.content or [])
            ).strip()

            # Strip accidental markdown fences
            if raw.startswith("```"):
                raw = raw.strip("`")
                if raw.lower().startswith("json"):
                    raw = raw[4:].lstrip()

            parsed = json.loads(raw)

            if not isinstance(parsed, list):
                raise ValueError(f"Expected list, got {type(parsed)}")

            for item in parsed:
                try:
                    all_scores.append(round(max(0.0, min(1.0, float(item))), 3))
                except (TypeError, ValueError):
                    all_scores.append(None)

            # Pad if Claude returned fewer scores than sentences in the batch
            while len(all_scores) < i + len(batch):
                all_scores.append(None)

        except Exception as exc:
            logger.warning(
                "ai_detection_engine: Claude scoring failed for batch %d: %s",
                i // CLAUDE_BATCH_SIZE,
                exc,
            )
            all_scores.extend([None] * len(batch))

    # Pad remaining sentences that weren't sent to Claude
    all_scores.extend([None] * (len(sentences) - len(all_scores)))
    return all_scores


# ---------------------------------------------------------------------------
# Per-sentence fallback (burstiness-based, no API)
# ---------------------------------------------------------------------------


def _fallback_sentence_score(
    sentence: str,
    mean_len: float,
    stdev_len: float,
) -> float:
    """Estimate AI likelihood from sentence length deviation.

    Sentences close to the mean are suspicious (uniform rhythm).
    Returns a score in [0, 1].
    """
    if stdev_len < 1:
        return 0.5
    z = abs(len(sentence) - mean_len) / stdev_len
    return round(max(0.0, 0.70 - z * 0.35), 3)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_ai_detection_engine(content: str) -> dict:
    """Run the full AI detection pipeline on *content*.

    Returns a dict matching ``CheckResult`` schema:
        score, flagged, flagged_sections, confidence, summary, method

    ``score`` = AI-likelihood (0.0 = human, 1.0 = AI).
    Note: this is INVERTED from citation/plagiarism/claim engines where 1.0 = good.

    Falls back gracefully to burstiness-only if ANTHROPIC_API_KEY is absent.
    """
    from models.integrity_analyze import CheckResult, FlaggedSection

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    model = os.getenv("ANTHROPIC_SCORING_MODEL", DEFAULT_SCORING_MODEL).strip()

    # ── Sentence splitting ───────────────────────────────────────────────────
    sentences = _split_sentences(content)

    if len(sentences) < 3:
        return CheckResult(
            score=0.5,
            flagged=False,
            flagged_sections=[],
            confidence=0.1,
            summary=(
                "Document is too short for reliable AI detection "
                "(fewer than 3 sentences detected)."
            ),
            method="none",
        ).model_dump()

    # ── Burstiness ───────────────────────────────────────────────────────────
    burstiness_score, burstiness_confidence = _compute_burstiness_score(sentences)

    # Pre-compute for fallback per-sentence scorer
    lengths = [len(s[0]) for s in sentences]
    mean_len = statistics.mean(lengths)
    stdev_len = statistics.stdev(lengths) if len(lengths) > 1 else 0.0

    # ── Claude sentence scoring ──────────────────────────────────────────────
    sentence_scores: list[Optional[float]] = [None] * len(sentences)
    claude_doc_score: Optional[float] = None
    method = "burstiness"

    if api_key:
        try:
            scored = await _score_sentences_with_claude(sentences, api_key, model)
            sentence_scores = scored
            valid = [s for s in scored if s is not None]
            if valid:
                claude_doc_score = statistics.mean(valid)
                method = "claude+burstiness"
        except Exception as exc:
            logger.warning("ai_detection_engine: Claude scoring pipeline failed: %s", exc)
    else:
        logger.info(
            "ai_detection_engine: ANTHROPIC_API_KEY not set — using burstiness only"
        )

    # ── Combined document score ───────────────────────────────────────────────
    if claude_doc_score is not None:
        combined_score = round(0.65 * claude_doc_score + 0.35 * burstiness_score, 3)
        confidence = round(min(0.90, burstiness_confidence + 0.20), 3)
    else:
        combined_score = burstiness_score
        confidence = burstiness_confidence

    # ── Per-sentence flagged sections ─────────────────────────────────────────
    flagged_sections: list[FlaggedSection] = []

    for i, (sent_text, start_char, end_char) in enumerate(sentences):
        per_score = sentence_scores[i]

        if per_score is None:
            per_score = _fallback_sentence_score(sent_text, mean_len, stdev_len)

        if per_score >= SENTENCE_FLAG_THRESHOLD:
            pct = round(per_score * 100)
            flagged_sections.append(
                FlaggedSection(
                    start_char=start_char,
                    end_char=end_char,
                    reason=f"High AI-likelihood ({pct}%) — uniform rhythm / pattern.",
                )
            )

    flagged_sections = flagged_sections[:50]

    # ── Human-readable summary ────────────────────────────────────────────────
    flagged = combined_score >= 0.40
    pct_score = round(combined_score * 100)

    if combined_score < 0.30:
        verdict = "likely human-written"
    elif combined_score < 0.60:
        verdict = "shows mixed AI and human signals"
    else:
        verdict = "likely AI-generated"

    summary_parts = [
        f"This document is {verdict} (AI-likelihood: {pct_score}%)."
    ]

    if method == "claude+burstiness":
        summary_parts.append(
            f"Analysed using Claude ({model.split('-')[1] if '-' in model else model}) "
            "sentence scoring and sentence-length burstiness."
        )
    else:
        summary_parts.append(
            "Result based on sentence-length burstiness only "
            "(ANTHROPIC_API_KEY not configured)."
        )

    n_flagged = len(flagged_sections)
    if n_flagged:
        summary_parts.append(
            f"{n_flagged} sentence{'s' if n_flagged != 1 else ''} "
            "flagged as high-confidence AI text."
        )

    return CheckResult(
        score=combined_score,
        flagged=flagged,
        flagged_sections=flagged_sections,
        confidence=confidence,
        summary=" ".join(summary_parts),
        method=method,
    ).model_dump()
