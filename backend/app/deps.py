"""Shared request dependencies: CSRF guard and current_user, require_role."""

import uuid
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Membership, Role, User
from app.security import SESSION_COOKIE, read_session_token

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def csrf_guard(request: Request) -> None:
    """Mutating requests must carry X-Requested-With (browsers can't add it cross-site
    without a CORS preflight, which only the web origin passes)."""
    if request.method in _MUTATING and "x-requested-with" not in request.headers:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing X-Requested-With header")


async def current_user(
    db: DbSession,
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    user_id = read_session_token(token) if token else None
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


CurrentUser = Annotated[User, Depends(current_user)]

_RANK = {Role.viewer: 0, Role.editor: 1, Role.owner: 2}


async def require_role(
    db: AsyncSession, user: User, workspace_id: uuid.UUID, min_role: Role
) -> Role:
    """Return the caller's role in the workspace.

    Non-members get 404 (the workspace's existence is not revealed); members whose role
    is below `min_role` get 403. Every resource endpoint must call this.
    """
    role = await db.scalar(
        select(Membership.role).where(
            Membership.workspace_id == workspace_id, Membership.user_id == user.id
        )
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if _RANK[role] < _RANK[min_role]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires the {min_role.value} role")
    return role
