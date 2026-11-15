"""Uploaded files: upload, versions, download."""

import re
import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.deps import CurrentUser, DbSession, require_role
from app.models import File, FileKind, FileVersion, Role, User
from app.routers.files import load_file
from app.routers.folders import folder_in_workspace
from app.routers.workspaces import FileOut
from app.services import storage

router = APIRouter(prefix="/api/files", tags=["blobs"])

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class VersionOut(BaseModel):
    version_no: int
    size_bytes: int
    mime: str
    sha256: str
    created_by_name: str
    created_at: datetime


def display_name(filename: str | None) -> str:
    """Reduce a client-supplied filename to a safe label. It is never used as a path."""
    name = _CONTROL.sub("", filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    return "upload" if name in ("", ".", "..") else name[:200]


async def _store(upload: UploadFile) -> storage.Stored:
    limit = get_settings().max_upload_bytes
    try:
        return await storage.save_stream(upload, limit)
    except storage.TooLarge:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"File is too large (limit {limit // (1024 * 1024)} MB)",
        ) from None
    except storage.StorageError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Storage is unavailable") from None


async def add_version(
    db: AsyncSession, file: File, user_id: uuid.UUID, stored: storage.Stored, mime: str
) -> FileVersion:
    """Append the next version to a blob file. The caller commits.
    The row lock serializes concurrent uploads to one file so version numbers never collide."""
    await db.execute(select(File.id).where(File.id == file.id).with_for_update())
    latest = await db.scalar(
        select(func.max(FileVersion.version_no)).where(FileVersion.file_id == file.id)
    )
    version = FileVersion(
        file_id=file.id,
        version_no=(latest or 0) + 1,
        storage_key=stored.key,
        storage_backend=stored.backend,
        sha256=stored.sha256,
        size_bytes=stored.size,
        mime=mime,
        created_by=user_id,
    )
    db.add(version)
    file.current_version = version.version_no
    file.updated_at = func.now()
    return version


def _version_out(version: FileVersion, author: str) -> VersionOut:
    return VersionOut(
        version_no=version.version_no,
        size_bytes=version.size_bytes,
        mime=version.mime,
        sha256=version.sha256,
        created_by_name=author,
        created_at=version.created_at,
    )


@router.post("/upload", response_model=FileOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    user: CurrentUser,
    db: DbSession,
    file: UploadFile,
    workspace_id: Annotated[uuid.UUID, Form()],
    folder_id: Annotated[uuid.UUID | None, Form()] = None,
) -> File:
    await require_role(db, user, workspace_id, Role.editor)
    await folder_in_workspace(db, folder_id, workspace_id)
    stored = await _store(file)
    row = File(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        folder_id=folder_id,
        name=display_name(file.filename),
        kind=FileKind.blob,
        created_by=user.id,
    )
    try:
        db.add(row)
        await db.flush()
        await add_version(db, row, user.id, stored, file.content_type or "application/octet-stream")
        await db.commit()
    except BaseException:
        await storage.discard(stored)
        raise
    await db.refresh(row)
    return row


@router.post("/{file_id}/versions", response_model=VersionOut, status_code=status.HTTP_201_CREATED)
async def upload_version(
    file_id: uuid.UUID, user: CurrentUser, db: DbSession, file: UploadFile
) -> VersionOut:
    row = await load_file(db, user, file_id, Role.editor)
    if row.kind is not FileKind.blob:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only uploaded files have versions")
    stored = await _store(file)
    try:
        version = await add_version(
            db, row, user.id, stored, file.content_type or "application/octet-stream"
        )
        await db.commit()
    except BaseException:
        await storage.discard(stored)
        raise
    await db.refresh(version)
    return _version_out(version, user.display_name)


@router.get("/{file_id}/versions", response_model=list[VersionOut])
async def list_versions(file_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[VersionOut]:
    row = await load_file(db, user, file_id, Role.viewer)
    rows = await db.execute(
        select(FileVersion, User.display_name)
        .join(User, User.id == FileVersion.created_by)
        .where(FileVersion.file_id == row.id)
        .order_by(FileVersion.version_no.desc())
    )
    return [_version_out(version, author) for version, author in rows]


@router.get("/{file_id}/versions/{version_no}/download")
async def download_version(
    file_id: uuid.UUID, version_no: int, user: CurrentUser, db: DbSession
) -> Response:
    row = await load_file(db, user, file_id, Role.viewer)
    version = await db.scalar(
        select(FileVersion).where(
            FileVersion.file_id == row.id, FileVersion.version_no == version_no
        )
    )
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
    }
    try:
        backend = storage.backend_named(version.storage_backend)
        if isinstance(backend, storage.LocalBackend):
            path = storage.blob_path(version.storage_key)
            if not path.is_file():
                raise storage.StorageMissing
            # Uploaded bytes are never rendered by the browser on our origin: always a download,
            # a generic type, no sniffing, and a sandbox in case something opens it anyway.
            return FileResponse(
                path,
                media_type="application/octet-stream",
                filename=row.name,
                content_disposition_type="attachment",
                headers=headers,
            )
        chunks = await backend.get(version.storage_key)
    except storage.StorageMissing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The stored file is missing") from None
    except storage.StorageError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Storage is unavailable") from None
    quoted = quote(row.name)
    disposition = (
        f"attachment; filename*=utf-8''{quoted}"
        if quoted != row.name
        else f'attachment; filename="{row.name}"'
    )
    return StreamingResponse(
        chunks,
        media_type="application/octet-stream",
        headers={
            **headers,
            "Content-Disposition": disposition,
            "Content-Length": str(version.size_bytes),
        },
    )
