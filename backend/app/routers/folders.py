import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, DbSession, require_role
from app.models import File, Folder, Role, User
from app.routers.workspaces import FolderOut
from app.schemas import Name

router = APIRouter(prefix="/api", tags=["folders"])

_DUPLICATE = "A folder with that name already exists here"


class FolderIn(BaseModel):
    name: Name
    parent_id: uuid.UUID | None = None


class FolderPatch(BaseModel):
    """Omitted fields are left unchanged; `parent_id: null` moves the folder to the root."""

    name: Name | None = None
    parent_id: uuid.UUID | None = None


async def folder_in_workspace(
    db: AsyncSession, folder_id: uuid.UUID | None, workspace_id: uuid.UUID
) -> Folder | None:
    """Validate a folder reference from a request body: it must belong to the workspace."""
    if folder_id is None:
        return None
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.workspace_id != workspace_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Folder does not exist in this workspace"
        )
    return folder


async def _commit_or_duplicate(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, _DUPLICATE) from None


@router.post(
    "/workspaces/{workspace_id}/folders",
    response_model=FolderOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_folder(
    workspace_id: uuid.UUID, body: FolderIn, user: CurrentUser, db: DbSession
) -> Folder:
    await require_role(db, user, workspace_id, Role.editor)
    await folder_in_workspace(db, body.parent_id, workspace_id)
    folder = Folder(workspace_id=workspace_id, parent_id=body.parent_id, name=body.name)
    db.add(folder)
    await _commit_or_duplicate(db)
    return folder


async def _load_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> Folder:
    folder = await db.get(Folder, folder_id)
    if folder is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await require_role(db, user, folder.workspace_id, Role.editor)
    return folder


@router.patch("/folders/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: uuid.UUID, body: FolderPatch, user: CurrentUser, db: DbSession
) -> Folder:
    folder = await _load_folder(db, user, folder_id)
    if body.name is not None:
        folder.name = body.name
    if "parent_id" in body.model_fields_set and body.parent_id != folder.parent_id:
        ancestor = await folder_in_workspace(db, body.parent_id, folder.workspace_id)
        while ancestor is not None:  # walk up from the target; meeting ourselves means a cycle
            if ancestor.id == folder.id:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "A folder cannot be moved inside itself"
                )
            ancestor = await db.get(Folder, ancestor.parent_id) if ancestor.parent_id else None
        folder.parent_id = body.parent_id
    await _commit_or_duplicate(db)
    return folder


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(folder_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    folder = await _load_folder(db, user, folder_id)
    # Soft-delete every file in the subtree first; the folder rows then cascade away
    # (files.folder_id is SET NULL, so without this the files would resurface at the root).
    subtree = select(Folder.id).where(Folder.id == folder.id).cte("subtree", recursive=True)
    subtree = subtree.union_all(select(Folder.id).where(Folder.parent_id == subtree.c.id))
    await db.execute(
        update(File)
        .where(File.folder_id.in_(select(subtree.c.id)), File.deleted_at.is_(None))
        .values(deleted_at=func.now())
    )
    await db.delete(folder)
    await db.commit()
