"""Canvas scenes: one stored scene per `canvas` file, saved as a whole with optimistic concurrency."""

import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.deps import CurrentUser, DbSession
from app.models import CanvasScene, File, FileKind, Role
from app.routers.files import load_file
from app.services.canvas import MAX_SCENE_BYTES, SceneError, validate_scene

router = APIRouter(prefix="/api", tags=["canvas"])

EMPTY_SCENE: dict[str, Any] = {
    "elements": [],
    "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None, "gridModeEnabled": False},
}


class SceneOut(BaseModel):
    scene: dict[str, Any]
    revision: int
    updated_at: datetime | None


class SavedOut(BaseModel):
    revision: int
    updated_at: datetime
    links_removed: int


async def _canvas(db: DbSession, user: CurrentUser, file_id: uuid.UUID, min_role: Role) -> File:
    file = await load_file(db, user, file_id, min_role)  # 404 non-member / 403 low role first
    if file.kind is not FileKind.canvas:
        raise HTTPException(status.HTTP_409_CONFLICT, "This file is not a canvas")
    return file


@router.get("/files/{file_id}/scene", response_model=SceneOut)
async def get_scene(file_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SceneOut:
    await _canvas(db, user, file_id, Role.viewer)
    row = await db.get(CanvasScene, file_id)
    if row is None:
        return SceneOut(scene=EMPTY_SCENE, revision=0, updated_at=None)
    return SceneOut(scene=row.scene, revision=row.revision, updated_at=row.updated_at)


async def _read_body(request: Request) -> bytes:
    """Read the body, stopping as soon as it is over the cap (the global limit is much larger)."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_SCENE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Canvas is too large")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_SCENE_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Canvas is too large")
        chunks.append(chunk)
    return b"".join(chunks)


def _bad(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


@router.put("/files/{file_id}/scene", response_model=SavedOut)
async def save_scene(
    file_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession
) -> SavedOut | JSONResponse:
    """Body: `{"base_revision": int, "scene": {...}}`. `base_revision` must equal the stored
    revision (0 for a canvas never saved), otherwise 409 with the current revision."""
    await _canvas(db, user, file_id, Role.editor)
    raw = await _read_body(request)
    try:
        body = json.loads(raw)
    except ValueError:  # includes UnicodeDecodeError
        raise _bad("Body is not valid JSON") from None
    if not isinstance(body, dict):
        raise _bad("Body must be an object with base_revision and scene")
    base = body.get("base_revision")
    if isinstance(base, bool) or not isinstance(base, int) or base < 0:
        raise _bad("base_revision must be a non-negative integer")
    try:
        scene, links_removed = validate_scene(body.get("scene"))
    except SceneError as e:
        raise _bad(str(e)) from None

    stored = json.dumps(scene, separators=(",", ":"))
    size = len(stored.encode())
    if size > MAX_SCENE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Canvas is too large")

    row = await db.scalar(
        select(CanvasScene).where(CanvasScene.file_id == file_id).with_for_update()
    )
    current = row.revision if row else 0
    if base != current:
        return JSONResponse(
            {"detail": "This canvas changed since you opened it", "revision": current},
            status_code=status.HTTP_409_CONFLICT,
        )
    if row is None:
        row = CanvasScene(
            file_id=file_id, scene=scene, revision=1, size_bytes=size, updated_by=user.id
        )
        db.add(row)
    else:
        row.scene, row.revision, row.size_bytes, row.updated_by = scene, current + 1, size, user.id
    try:
        await db.commit()
    except IntegrityError:  # two first saves raced; the other one won
        await db.rollback()
        return JSONResponse(
            {"detail": "This canvas changed since you opened it", "revision": 1},
            status_code=status.HTTP_409_CONFLICT,
        )
    await db.refresh(row)
    return SavedOut(revision=row.revision, updated_at=row.updated_at, links_removed=links_removed)
