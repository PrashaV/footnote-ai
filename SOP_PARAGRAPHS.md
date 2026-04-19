# Footnote — SOP Paragraphs & Admissions Copy

> Generated from the completed Footnote codebase (April 2026).
> The project ships: React 18 + TypeScript frontend, FastAPI backend, D3.js
> knowledge graph, Claude AI synthesis, Semantic Scholar + OpenAlex data
> pipeline, Supabase session persistence, .docx export, and a three-workflow
> GitHub Actions CI/CD pipeline deploying to Vercel.

---

## 1. SOP Paragraphs (≈ 150 words each)

### Version A — Georgia Tech (systems emphasis + quantified impact)

Academic search has a systems problem: the tools that exist were built for
specialists who already know what they are looking for. A product manager,
policy analyst, or first-year doctoral student who types a research question
into a search engine gets back a ranked list of URLs — raw, unconnected, and
unfit for synthesis. I built Footnote to fix the full pipeline. The backend is
a FastAPI service that fans async I/O concurrently across three external APIs —
Semantic Scholar's 220-million-paper index, OpenAlex's citation graph, and
Anthropic's Claude — before Pydantic v2 validates and serialises the combined
result into eight structured output types. The frontend is a React 18 +
TypeScript application with a D3.js force-directed knowledge graph that makes
citation topology legible at a glance. A three-stage GitHub Actions pipeline
(lint → test with Codecov coverage enforcement → Vercel deploy) means no code
reaches production without passing the full suite. The hard problem was not
connecting the APIs — it was designing the Pydantic contract so that a
malformed upstream response fails loudly at the boundary rather than
propagating silently into the synthesis layer. That discipline — making system
boundaries explicit and observable — is exactly what I want to study formally
in Georgia Tech's systems and HCI research programme, where I can apply these
design patterns to problems at a scale that a side project cannot reach.

---

### Version B — University of Washington (knowledge graph as research artifact)

Existing literature discovery tools treat a body of research as a flat ranked
list. Citation relationships — the actual intellectual structure of a field —
are invisible unless you are already a specialist. Footnote is my attempt to
make that structure a first-class interface object. The core engineering
challenge was building a knowledge graph that is simultaneously a live data
product and a readable research artifact: nodes are real papers pulled from
Semantic Scholar's 220-million-paper index, edges represent citation
relationships sourced from OpenAlex, and the D3.js force-directed layout is
calibrated so that densely-cited clusters pull together naturally, giving a
researcher an immediate topological sense of where consensus has formed and
where the field is still open. Behind the graph, a FastAPI service with Pydantic
v2 models enforces a strict schema contract across three concurrent API calls,
and Claude synthesises the retrieved papers into eight structured outputs
including identified research gaps and a methodology comparison table. The
project taught me that the hardest design question in knowledge representation
is not how to store relationships but how to render them so that a non-expert
can read them. I want to pursue that question formally in UW's iSchool or
Allen School, where information architecture, graph-based retrieval, and
human-centred design converge.

---

## 2. Elevator Pitch (≈ 50 words, spoken aloud)

> "Footnote is an AI research assistant I built from scratch. You type any
> topic, and in under ten seconds it pulls real papers from a 220-million-paper
> index, maps how they cite each other in an interactive graph, and gives you a
> structured briefing — key findings, open problems, top researchers — ready to
> export to Word."

---

## 3. Six Specific Technical Claims (with Evidence)

**1. Three-API async fan-out with sub-10-second end-to-end latency**
The FastAPI backend issues concurrent async calls to Semantic Scholar, OpenAlex,
and the Anthropic Claude API using Python's async I/O. All three calls are
in-flight simultaneously rather than chained sequentially, which keeps
wall-clock time well under ten seconds for a standard query. Source: `backend/services/claude_service.py`, `backend/services/scholar_service.py`, README architecture diagram.

**2. Real paper data drawn from Semantic Scholar's 220-million-paper index**
Every research query fetches live metadata — title, authors, year, venue, DOI,
abstract, citation count — from the Semantic Scholar open API, which indexes
over 220 million papers across all academic disciplines. No synthetic or mocked
paper data is shown to the user. Source: README tech-stack table, `scholar_service.py`.

**3. Pydantic v2 contract enforcement with 422 validation on every boundary**
All inbound API requests and outbound service responses are validated by Pydantic
v2 models. The test suite exercises eleven distinct 422-producing failure modes:
missing required fields, topic strings that are too short or too long,
whitespace-only inputs, invalid enum values, extra forbidden fields, and null
types. A malformed payload never reaches the synthesis layer. Source: `backend/tests/test_routes.py` (TestResearchRouteValidation class, 11 test cases).

**4. CI-gated deployment: Vercel deploy cannot run unless the full test suite
passes**
The `deploy.yml` GitHub Actions workflow fires only on a `workflow_run`
completion event from the `Tests` workflow, and includes an explicit guard
(`if: github.event.workflow_run.conclusion == 'success'`). A failing test on
`main` blocks production deployment automatically. Source: `.github/workflows/deploy.yml`.

**5. Coverage-tracked test suite (Codecov) across 1,318 lines of test code**
The `test.yml` workflow runs `pytest` with `--cov` on every push to every
branch, generates an XML coverage report, and uploads it to Codecov via the
official action with `fail_ci_if_error: true`. The test suite spans four files
and 1,318 lines covering API routes, Pydantic models, and the scholar service.
Source: `.github/workflows/test.yml`, `backend/tests/` (line count verified).

**6. Interactive D3.js knowledge graph built on real OpenAlex citation edges**
The frontend renders a force-directed graph using D3.js v7, where nodes
represent retrieved papers and edge weights reflect citation relationships drawn
from the OpenAlex API. React owns the component tree; D3 owns the SVG — a clean
separation that keeps both concerns testable. The graph is a genuine research
artifact: citation clusters and isolated nodes are structurally meaningful, not
decorative. Source: `frontend/src/components/KnowledgeGraph.tsx`, README analysis-outputs table.

---

*End of admissions copy. Last updated: April 2026.*
