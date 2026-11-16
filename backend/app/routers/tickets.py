import uuid
import zlib
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.deps import CurrentUser, DbSession, require_role
from app.models import FileKind, Role
from app.routers.files import load_file

router = APIRouter(prefix="/api", tags=["tickets"])

TICKET_TTL = timedelta(seconds=60)
# Must match TICKET_AUDIENCE in sync/src/auth.ts. Keeps tickets and session JWTs from being
# interchangeable even if the two secrets were ever set to the same value.
TICKET_AUDIENCE = "coedit-sync"

# Caret colours: dark enough for white label text.
_COLORS = ("#b3261e", "#1f5f4a", "#1d4ed8", "#7c3aed", "#b45309", "#0e7490", "#be185d", "#4d7c0f")


class TicketOut(BaseModel):
    ticket: str
    url: str
    read_only: bool
    # Shown on this user's caret for others; the same values are inside the signed ticket.
    name: str
    color: str


def user_color(user_id: uuid.UUID) -> str:
    """Stable per-user colour, so a person keeps the same caret colour across files."""
    return _COLORS[zlib.crc32(user_id.bytes) % len(_COLORS)]


@router.post("/files/{file_id}/ws-ticket", response_model=TicketOut)
async def create_ws_ticket(file_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TicketOut:
    """Mint a 60-second ticket bound to one file. The sync server trusts the role in it,
    so membership and role are checked here, at mint time."""
    file = await load_file(db, user, file_id, Role.viewer)
    role = await require_role(db, user, file.workspace_id, Role.viewer)
    if file.kind is FileKind.blob:
        raise HTTPException(status.HTTP_409_CONFLICT, "Uploaded files cannot be co-edited")
    if file.kind is FileKind.canvas:
        raise HTTPException(status.HTTP_409_CONFLICT, "Canvases are not realtime yet")
    settings = get_settings()
    now = datetime.now(UTC)
    color = user_color(user.id)
    ticket = jwt.encode(
        {
            "sub": str(user.id),
            "file_id": str(file.id),
            "role": role.value,
            "name": user.display_name,
            "color": color,
            "aud": TICKET_AUDIENCE,
            "iat": now,
            "exp": now + TICKET_TTL,
        },
        settings.ws_ticket_secret,
        algorithm="HS256",
    )
    return TicketOut(
        ticket=ticket,
        url=settings.sync_public_url,
        read_only=role is Role.viewer,
        name=user.display_name,
        color=color,
    )
