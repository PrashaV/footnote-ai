"""Shared pytest fixtures for the Footnote backend test suite.

Adds the backend package root to sys.path so that ``import models`` and
``import services`` resolve without a src-layout install.

Fixtures
--------
mock_env            (autouse) — injects a fake ANTHROPIC_API_KEY so every test
                     module can import claude_service without 500-ing on missing
                     config.
clear_scholar_cache (autouse) — wipes the in-memory Scholar LRU cache before
                     and after each test so tests never share state.
reset_claude_client (autouse) — clears the lazy AsyncAnthropic singleton so
                     each test starts with a fresh (mockable) client.
async_client                  — httpx.AsyncClient wired to the FastAPI ASGI app,
                     used by test_routes.py to exercise HTTP endpoints in-process.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Ensure `backend/` is on sys.path so top-level imports resolve in tests.
# ---------------------------------------------------------------------------

_BACKEND_DIR = Path(__file__).parent.parent  # …/backend/
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def mock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inject a dummy Anthropic API key so tests never need a real one."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-fake-key-for-testing")
    # Keep other env knobs sensible for tests.
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    monkeypatch.setenv("ANTHROPIC_MAX_TOKENS", "512")
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "1000")  # don't trip limiter in tests


@pytest.fixture(autouse=True)
def clear_scholar_cache() -> None:  # type: ignore[return]
    """Clear the module-level Scholar cache before and after each test."""
    # Import lazily so sys.path patch above has taken effect.
    from services import scholar_service  # noqa: PLC0415

    scholar_service._cache.clear()
    yield  # type: ignore[misc]
    scholar_service._cache.clear()


@pytest.fixture(autouse=True)
def reset_claude_client() -> None:  # type: ignore[return]
    """Reset the lazy AsyncAnthropic singleton between tests.

    claude_service caches a single AsyncAnthropic instance in ``_client``.
    Resetting it ensures each test gets a fresh object, preventing state bleed
    when tests patch the client or the API key.
    """
    from services import claude_service  # noqa: PLC0415

    claude_service._client = None
    yield  # type: ignore[misc]
    claude_service._client = None


@pytest_asyncio.fixture()
async def async_client() -> AsyncGenerator:
    """Yield an httpx.AsyncClient backed by the FastAPI ASGI app.

    Usage in test functions::

        async def test_something(async_client):
            response = await async_client.get("/health")
            assert response.status_code == 200
    """
    import httpx
    from main import app  # noqa: PLC0415

    transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        yield client
