import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, DbSession, require_role
from app.models import File, FileKind, Role, User
from app.routers.folders import folder_in_workspace
from app.routers.workspaces import FileOut
from app.schemas import Name

router = APIRouter(prefix="/api", tags=["files"])


class FileIn(BaseModel):
    name: Name
    kind: Literal[FileKind.doc, FileKind.sheet, FileKind.canvas]  # blobs are created by upload only
    folder_id: uuid.UUID | None = None


class FilePatch(BaseModel):
    """Omitted fields are left unchanged; `folder_id: null` moves the file to the root."""

    name: Name | None = None
    folder_id: uuid.UUID | None = None


async def load_file(db: AsyncSession, user: User, file_id: uuid.UUID, min_role: Role) -> File:
    """Fetch a live file and check the caller's role in its workspace (404 before 403)."""
    file = await db.get(File, file_id)
    if file is None or file.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await require_role(db, user, file.workspace_id, min_role)
    return file


@router.post(
    "/workspaces/{workspace_id}/files", response_model=FileOut, status_code=status.HTTP_201_CREATED
)
async def create_file(
    workspace_id: uuid.UUID, body: FileIn, user: CurrentUser, db: DbSession
) -> File:
    await require_role(db, user, workspace_id, Role.editor)
    await folder_in_workspace(db, body.folder_id, workspace_id)
    file = File(
        workspace_id=workspace_id,
        folder_id=body.folder_id,
        name=body.name,
        kind=body.kind,
        created_by=user.id,
    )
    db.add(file)
    await db.commit()
    await db.refresh(file)
    return file


@router.patch("/files/{file_id}", response_model=FileOut)
async def update_file(
    file_id: uuid.UUID, body: FilePatch, user: CurrentUser, db: DbSession
) -> File:
    file = await load_file(db, user, file_id, Role.editor)
    if body.name is not None:
        file.name = body.name
    if "folder_id" in body.model_fields_set:
        await folder_in_workspace(db, body.folder_id, file.workspace_id)
        file.folder_id = body.folder_id
    await db.commit()
    await db.refresh(file)
    return file


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(file_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    file = await load_file(db, user, file_id, Role.editor)
    file.deleted_at = func.now()
    await db.commit()
