"""FastAPI app entry point for the Footnote backend.

Keeps the file thin: wiring only. Validation lives in `models/`, and the
actual Anthropic call lives in `services/claude_service.py`.
"""

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from models.research import ResearchRequest, ResearchResponse
from models.verify import IntegrityReport, VerifyRequest
from services.claude_service import get_research
from services.export_service import generate_docx
from services.verify_service import run_verification

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
async def verify(request: Request, payload: VerifyRequest) -> IntegrityReport:
    """Verify a research draft for citation integrity, AI writing patterns,
    and plagiarism risk. Returns a structured IntegrityReport with scores,
    warnings, flagged passages, and recommended fixes."""
    logger.info(
        "verify request: title=%r checks=[citations=%s, ai=%s, plagiarism=%s] words=%d",
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
async def research(request: Request, payload: ResearchRequest) -> ResearchResponse:
    """Generate a ResearchResponse for the requested topic and depth."""
    logger.info("research request: topic=%r depth=%s", payload.topic, payload.depth)
    return await get_research(topic=payload.topic, depth=payload.depth)


@app.post(
    "/api/export",
    status_code=status.HTTP_200_OK,
    tags=["export"],
    summary="Export a ResearchResponse as a formatted Word document (.docx).",
    response_description="Binary .docx file attachment.",
)
async def export_docx(request: Request, payload: ResearchResponse) -> Response:
    """Accept a ResearchResponse and return a formatted .docx file download."""
    logger.info("export request: topic=%r", payload.topic)

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
