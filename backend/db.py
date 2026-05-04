"""Supabase service-role client for server-side database operations.

The service role key bypasses RLS, so this client is ONLY for use on the
backend (never sent to the frontend). Use it when you need to write to the
database on behalf of a user (e.g. persisting integrity_results after a
/api/verify call) without being blocked by per-user RLS policies.

Usage
-----
from db import get_supabase

@app.post("/api/verify")
async def verify(payload: VerifyRequest, user: dict = Depends(get_current_user)):
    report = await run_verification(payload)
    sb = get_supabase()
    if sb:
        sb.table("integrity_results").insert({...}).execute()
    return report

Environment variable required
------------------------------
SUPABASE_URL             — your project URL
SUPABASE_SERVICE_ROLE_KEY — service role key (Settings → API → service_role)
"""

import logging
import os
from typing import Optional

logger = logging.getLogger("footnote.db")

_supabase_client = None


def get_supabase():
    """Return a cached Supabase service-role client, or None if not configured.

    Importing supabase is deferred so the app still boots if the package is
    not installed or the env vars are missing.
    """
    global _supabase_client

    if _supabase_client is not None:
        return _supabase_client

    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not url or not key:
        logger.warning(
            "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set — "
            "server-side database writes are disabled. "
            "Set both variables in Railway / .env to enable persistence."
        )
        return None

    try:
        from supabase import create_client  # type: ignore
        _supabase_client = create_client(url, key)
        logger.info("Supabase service-role client initialised for %s", url)
        return _supabase_client
    except ImportError:
        logger.warning(
            "supabase-py is not installed — add `supabase` to requirements.txt "
            "to enable server-side database writes."
        )
        return None
    except Exception as exc:
        logger.error("Failed to initialise Supabase client: %s", exc)
        return None
