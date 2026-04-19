# Contributing to Footnote

Thank you for your interest in contributing to Footnote! This guide covers everything you need to get up and running locally, submit quality pull requests, and keep the codebase healthy.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup](#local-setup)
3. [Running the Backend](#running-the-backend)
4. [Running the Frontend](#running-the-frontend)
5. [Running Tests](#running-tests)
6. [Code Style](#code-style)
7. [Pull Request Checklist](#pull-request-checklist)

---

## Prerequisites

Make sure you have the following installed before cloning the repo:

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Python | 3.11+ | Backend runtime |
| Node.js | 18+ | Frontend runtime |
| npm | 9+ | Frontend package management |
| Git | 2.40+ | Version control |
| uvicorn | latest | ASGI server for FastAPI |

Optional but recommended:

- **Docker** — for running services (e.g. a local vector DB) in isolation
- **pyenv** — to manage Python versions cleanly
- **nvm** — to manage Node versions cleanly

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-org/footnote.git
cd footnote
```

### 2. Set up the Python environment

```bash
python -m venv .venv
source .venv/bin/activate        # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

### 3. Configure environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Key variables to set:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=sqlite:///./footnote.db
```

### 4. Set up the frontend

```bash
cd frontend
npm install
cd ..
```

---

## Running the Backend

From the project root (with your virtual environment activated):

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- `--reload` enables hot-reloading on file changes (development only)
- The API will be available at `http://localhost:8000`
- Interactive API docs (Swagger UI) at `http://localhost:8000/docs`
- Alternative docs (ReDoc) at `http://localhost:8000/redoc`

To run with a specific environment file:

```bash
uvicorn app.main:app --reload --env-file .env.local
```

---

## Running the Frontend

From the `frontend/` directory:

```bash
cd frontend
npm run dev
```

The frontend dev server will start at `http://localhost:5173` (Vite default) or `http://localhost:3000` depending on your configuration. Check the terminal output for the exact URL.

To build for production:

```bash
npm run build
npm run preview   # previews the production build locally
```

---

## Running Tests

### Backend tests (pytest)

From the project root with your virtual environment activated:

```bash
pytest
```

Run with verbose output and coverage:

```bash
pytest -v --cov=app --cov-report=term-missing
```

Run a specific test file or test:

```bash
pytest tests/test_search.py
pytest tests/test_search.py::test_query_returns_results
```

### Frontend tests

```bash
cd frontend
npm run test          # runs Vitest unit tests
npm run test:watch    # watch mode during development
```

### End-to-end tests (if configured)

```bash
cd frontend
npx playwright test
```

---

## Code Style

Consistent code style keeps the codebase readable and makes reviews faster. Automated checks run in CI — please run them locally before pushing.

### Python — ruff

We use [ruff](https://docs.astral.sh/ruff/) for both linting and formatting.

```bash
# Lint
ruff check .

# Auto-fix lint issues
ruff check . --fix

# Format
ruff format .

# Check formatting without modifying files
ruff format . --check
```

Ruff is configured in `pyproject.toml`. Key rules enabled: `E`, `F`, `I` (isort), `UP` (pyupgrade), `B` (flake8-bugbear).

### TypeScript — ESLint + Prettier

```bash
cd frontend

# Lint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format (if Prettier is configured separately)
npm run format
```

ESLint is configured in `frontend/.eslintrc.cjs` (or `eslint.config.js`). We extend the recommended TypeScript and React rules.

### General style guidelines

- Write self-documenting code; add comments only when the *why* isn't obvious
- Keep functions small and focused on a single responsibility
- Prefer explicit over implicit — avoid overly clever one-liners
- Use descriptive variable and function names
- Add type annotations to all Python function signatures
- Use TypeScript strictly — avoid `any` unless genuinely unavoidable

---

## Pull Request Checklist

Before opening a PR, confirm all of the following:

- [ ] **Tests pass** — `pytest` exits with zero failures; `npm run test` passes
- [ ] **No lint errors** — `ruff check .` and `npm run lint` report no issues
- [ ] **No formatting issues** — `ruff format . --check` and `npm run format --check` are clean
- [ ] **README updated** — if your change introduces a new feature, flag, or environment variable, update the relevant section of `README.md`
- [ ] **Type annotations added** — new Python functions include type hints; TypeScript code is fully typed
- [ ] **No secrets committed** — double-check that API keys, tokens, or credentials haven't snuck into the diff
- [ ] **Small, focused commits** — each commit should represent one logical change; squash WIP commits before merging
- [ ] **PR description filled out** — explain *what* changed and *why*; link to any related issues
- [ ] **Self-review done** — read your own diff before requesting review; catch typos, debug logs, and dead code yourself first

---

## Getting Help

If you're stuck, open a [Discussion](https://github.com/your-org/footnote/discussions) or drop a note in the relevant GitHub Issue. We're happy to help.

Happy contributing!
