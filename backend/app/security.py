"""Password hashing (argon2id) and session JWTs."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError

from app.config import get_settings

SESSION_COOKIE = "coedit_session"
_ALGORITHM = "HS256"

_hasher = PasswordHasher()
# Verified against when the email is unknown, so both login failures cost the same time.
_DUMMY_HASH = _hasher.hash(uuid.uuid4().hex)


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


def _verify(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (Argon2Error, InvalidHashError):
        return False


async def verify_password(password_hash: str | None, password: str) -> bool:
    """Check `password`; a None hash (unknown user) still burns a verification and fails."""
    ok = await asyncio.to_thread(_verify, password_hash or _DUMMY_HASH, password)
    return ok and password_hash is not None


def session_ttl() -> timedelta:
    """Session lifetime from SESSION_TTL_HOURS (default 24). Logout does not revoke a token."""
    return timedelta(hours=get_settings().session_ttl_hours)


def create_session_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "iat": now, "exp": now + session_ttl()}
    return jwt.encode(payload, get_settings().app_secret, algorithm=_ALGORITHM)


def read_session_token(token: str) -> uuid.UUID | None:
    """Return the user id for a valid, unexpired token, else None."""
    try:
        payload = jwt.decode(
            token,
            get_settings().app_secret,
            algorithms=[_ALGORITHM],
            options={"require": ["sub", "exp"]},
        )
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError):
        return None
