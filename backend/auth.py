"""JWT authentication dependency for FastAPI routes.

Validates Supabase-issued JWTs (HS256) using the project's JWT secret so that
only authenticated users can reach protected endpoints.

Usage
-----
from auth import get_current_user
from fastapi import Depends

@app.post("/api/protected")
async def protected_route(
    payload: MyRequest,
    _user: dict = Depends(get_current_user),
):
    ...

The ``_user`` dict is the decoded JWT payload (keys: sub, email, role, exp, …).
Use ``_user["sub"]`` to get the Supabase user UUID.

Environment variable required
------------------------------
SUPABASE_JWT_SECRET  — found in Supabase dashboard →
                       Settings → API → JWT Settings → JWT Secret
"""

import logging
import os

import jwt
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("footnote.auth")

# ---------------------------------------------------------------------------
# Shared HTTPBearer extractor (auto_error=False so we can return a clear 401)
# ---------------------------------------------------------------------------
_bearer = HTTPBearer(auto_error=False)

# Read once at startup; Railway / local .env must set this.
_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

if not _JWT_SECRET:
    logger.warning(
        "SUPABASE_JWT_SECRET is not set — all protected routes will reject "
        "every request with 401. Set this variable in Railway / .env."
    )


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer),
) -> dict:
    """FastAPI Depends() guard — extracts and validates the Supabase Bearer JWT.

    Returns the decoded JWT payload on success.
    Raises HTTP 401 if:
      • No Authorization header is present
      • The token is invalid or expired
      • SUPABASE_JWT_SECRET is not configured
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not _JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Authentication is misconfigured on the server. "
                "SUPABASE_JWT_SECRET is not set."
            ),
        )

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            _JWT_SECRET,
            algorithms=["HS256"],
            # Supabase sets aud="authenticated" for logged-in users
            audience="authenticated",
            options={"verify_exp": True},
        )
        logger.debug("JWT validated for user %s", payload.get("sub"))
        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidAudienceError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token audience.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
