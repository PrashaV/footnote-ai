"""FastAPI app entry point for the Footnote backend.

Keeps the file thin: wiring only. Validation lives in `models/`, and the
actual Anthropic call lives in `services/claude_service.py`.
"""

import logging
import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from auth import get_current_user
from db import get_supabase
from models.research import ResearchRequest, ResearchResponse
from models.verify import IntegrityReport, VerifyRequest
from models.integrity_analyze import IntegrityAnalyzeRequest, IntegrityAnalyzeResponse
from services.claude_service import get_research
from services.export_service import generate_docx
from services.verify_service import run_verification
from services.citation_search_service import search_citations
from services.integrity_analyze_service import analyze_integrity

# Load .env before anything reads os.environ.
load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("footnote")


# ---------------------------------------------------------------------------
# CORS configuration
# ---------------------------------------------------------------------------

# Default origins: local Vite dev server + a placeholder Vercel URL that will
# be replaced once the frontend is deployed. In production, override via the
# ALLOWED_ORIGINS environment variable (comma-separated).
_DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://footnote-ai-app.vercel.app",  # production Vercel URL
    "https://footnote.vercel.app",
]


def _resolve_allowed_origins() -> list[str]:
    env_value = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not env_value:
        return _DEFAULT_ORIGINS
    origins = [o.strip() for o in env_value.split(",") if o.strip()]
    # Always include the hardcoded defaults so a partial override doesn't
    # accidentally lock out the production frontend.
    combined = list(dict.fromkeys(_DEFAULT_ORIGINS + origins))
    return combined


# ---------------------------------------------------------------------------
# App + middleware
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Footnote — Academic Integrity Engine",
    version="2.0.0",
    description=(
        "Footnote API v2.0.0 — AI that verifies your research before submission. "
        "POST /api/research for a source-backed research briefing. "
        "POST /api/verify to run a full Academic Integrity check on a draft "
        "(citation verification, AI writing detection, plagiarism-risk analysis)."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_allowed_origins(),
    allow_origin_regex=r"https://.*\.vercel\.app",  # all Vercel preview URLs
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)



# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    """Liveness check and version banner."""
    return {
        "service": "Footnote — Academic Integrity Engine",
        "version": app.version,
        "status": "ok",
    }


@app.post(
    "/api/verify",
    response_model=IntegrityReport,
    status_code=status.HTTP_200_OK,
    tags=["integrity"],
    summary="Run a full Academic Integrity check on a research draft.",
)
async def verify(
    request: Request,
    payload: VerifyRequest,
    _user: dict = Depends(get_current_user),
) -> IntegrityReport:
    """Verify a research draft for citation integrity, AI writing patterns,
    and plagiarism risk. Returns a structured IntegrityReport with scores,
    warnings, flagged passages, and recommended fixes."""
    logger.info(
        "verify request: user=%s title=%r checks=[citations=%s, ai=%s, plagiarism=%s] words=%d",
        _user.get("sub", "unknown"),
        payload.title,
        payload.check_citations,
        payload.check_ai_writing,
        payload.check_plagiarism_risk,
        len(payload.draft.split()),
    )
    return await run_verification(payload)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Lightweight health endpoint for uptime monitors."""
    return {"status": "ok"}


@app.post(
    "/api/research",
    response_model=ResearchResponse,
    status_code=status.HTTP_200_OK,
    tags=["research"],
    summary="Generate a source-backed research briefing for a topic.",
)
async def research(
    request: Request,
    payload: ResearchRequest,
    _user: dict = Depends(get_current_user),
) -> ResearchResponse:
    """Generate a ResearchResponse for the requested topic and depth."""
    logger.info(
        "research request: user=%s topic=%r depth=%s",
        _user.get("sub", "unknown"),
        payload.topic,
        payload.depth,
    )
    return await get_research(topic=payload.topic, depth=payload.depth)


@app.post(
    "/api/citations/search",
    status_code=status.HTTP_200_OK,
    tags=["citations"],
    summary="Search Semantic Scholar for papers matching a query string.",
)
async def citations_search(
    request: Request,
    _user: dict = Depends(get_current_user),
) -> list[dict]:
    """Proxy citation autocomplete queries to the Semantic Scholar API.

    Accepts a JSON body ``{"query": "..."}`` and returns up to 5 paper
    results with title, authors, year, doi, and externalIds.

    Proxied through the backend to avoid browser CORS restrictions.
    """
    body = await request.json()
    query: str = (body.get("query") or "").strip()

    if not query:
        return []

    logger.info(
        "citations search: user=%s query=%r",
        _user.get("sub", "unknown"),
        query[:60],
    )

    results = await search_citations(query)
    return [
        {
            "paperId":     r.paper_id,
            "title":       r.title,
            "authors":     r.authors,
            "year":        r.year,
            "doi":         r.doi,
            "externalIds": r.external_ids,
        }
        for r in results
    ]


@app.post(
    "/api/export",
    status_code=status.HTTP_200_OK,
    tags=["export"],
    summary="Export a ResearchResponse as a formatted Word document (.docx).",
    response_description="Binary .docx file attachment.",
)
async def export_docx(
    request: Request,
    payload: ResearchResponse,
    _user: dict = Depends(get_current_user),
) -> Response:
    """Accept a ResearchResponse and return a formatted .docx file download."""
    logger.info("export request: user=%s topic=%r", _user.get("sub", "unknown"), payload.topic)

    doc_bytes = generate_docx(payload)

    # Build a filesystem-safe filename from the topic.
    safe = "".join(
        c if c.isalnum() or c in (" ", "-", "_") else ""
        for c in payload.topic[:50]
    ).strip().replace(" ", "_")
    filename = f"footnote_{safe or 'research'}.docx"

    return Response(
        content=doc_bytes,
        media_type=(
            "application/vnd.openxmlformats-officedocument"
            ".wordprocessingml.document"
        ),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Integrity analyze — Phase 4 endpoint
# ---------------------------------------------------------------------------


@app.post(
    "/api/integrity/analyze",
    response_model=IntegrityAnalyzeResponse,
    status_code=status.HTTP_200_OK,
    tags=["integrity"],
    summary="Run four integrity checks on a document in parallel.",
)
async def integrity_analyze(
    payload: IntegrityAnalyzeRequest,
    _user: dict = Depends(get_current_user),
) -> IntegrityAnalyzeResponse:
    """Run ai_detection, citation_check, plagiarism_check, and claim_match
    concurrently for the given document.

    Each check result is persisted to the ``integrity_results`` Supabase table
    before the combined response is returned to the client.

    Phase 4.1: skeleton. Phase 4.2: AI detection live. Phase 4.3: citations live.
    Phase 4.4: plagiarism live (embedding + Semantic Scholar + self-plagiarism).
    Phase 4.5: claim matching — pending.
    """
    user_id = _user.get("sub", "unknown")
    word_count = len(payload.content.split())

    logger.info(
        "integrity/analyze: user=%s document_id=%s citations=%d words=%d",
        user_id,
        payload.document_id,
        len(payload.citations),
        word_count,
    )

    # Run all four checks in parallel.
    # user_id + document_id are threaded through for plagiarism self-check.
    ai_result, citation_result, plagiarism_result, claim_result = await analyze_integrity(
        payload.content,
        payload.citations,
        user_id=user_id,
        document_id=payload.document_id,
    )

    # Persist each result to Supabase (best-effort — don't fail the request if this errors).
    sb = get_supabase()
    if sb:
        rows = [
            {
                "document_id": payload.document_id,
                "user_id": user_id,
                "check_type": "ai_detection",
                "result": ai_result.model_dump(),
                "confidence_score": ai_result.confidence,
                "flagged_sections": [fs.model_dump() for fs in ai_result.flagged_sections],
            },
            {
                "document_id": payload.document_id,
                "user_id": user_id,
                "check_type": "citation",
                "result": citation_result.model_dump(),
                "confidence_score": citation_result.confidence,
                "flagged_sections": [fs.model_dump() for fs in citation_result.flagged_sections],
            },
            {
                "document_id": payload.document_id,
                "user_id": user_id,
                "check_type": "plagiarism",
                "result": plagiarism_result.model_dump(),
                "confidence_score": plagiarism_result.confidence,
                "flagged_sections": [fs.model_dump() for fs in plagiarism_result.flagged_sections],
            },
            {
                "document_id": payload.document_id,
                "user_id": user_id,
                "check_type": "claim_match",
                "result": claim_result.model_dump(),
                "confidence_score": claim_result.confidence,
                "flagged_sections": [fs.model_dump() for fs in claim_result.flagged_sections],
            },
        ]
        try:
            sb.table("integrity_results").insert(rows).execute()
            logger.info(
                "integrity/analyze: saved 4 results to Supabase for document_id=%s",
                payload.document_id,
            )
        except Exception as exc:
            logger.warning(
                "integrity/analyze: failed to persist results to Supabase: %s", exc
            )

    return IntegrityAnalyzeResponse(
        document_id=payload.document_id,
        ai_detection=ai_result,
        citation_check=citation_result,
        plagiarism_check=plagiarism_result,
        claim_match=claim_result,
    )


# ---------------------------------------------------------------------------
# Fallback error handler — ensures uncaught exceptions produce JSON, not HTML.
# ---------------------------------------------------------------------------


@app.exception_handler(Exception)
async def _unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:  # pragma: no cover — defensive
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error."},
    )
