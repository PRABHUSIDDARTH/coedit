import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, DbSession, require_role
from app.models import File, FileKind, Folder, Membership, Role, User, Workspace
from app.schemas import Name

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


class WorkspaceIn(BaseModel):
    name: Name


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    role: Role


class MemberIn(BaseModel):
    email: EmailStr
    role: Role


class MemberPatch(BaseModel):
    role: Role


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    role: Role


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    folder_id: uuid.UUID | None
    name: str
    kind: FileKind
    current_version: int | None
    updated_at: datetime


class TreeOut(BaseModel):
    role: Role
    folders: list[FolderOut]
    files: list[FileOut]


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(user: CurrentUser, db: DbSession) -> list[WorkspaceOut]:
    rows = await db.execute(
        select(Workspace, Membership.role)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .where(Membership.user_id == user.id)
        .order_by(Workspace.created_at)
    )
    return [WorkspaceOut(id=ws.id, name=ws.name, role=role) for ws, role in rows]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
async def create_workspace(body: WorkspaceIn, user: CurrentUser, db: DbSession) -> WorkspaceOut:
    ws = Workspace(id=uuid.uuid4(), name=body.name, owner_id=user.id)
    db.add(ws)
    await db.flush()
    db.add(Membership(workspace_id=ws.id, user_id=user.id, role=Role.owner))
    await db.commit()
    return WorkspaceOut(id=ws.id, name=ws.name, role=Role.owner)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession) -> WorkspaceOut:
    role = await require_role(db, user, workspace_id, Role.viewer)
    ws = await db.get_one(Workspace, workspace_id)
    return WorkspaceOut(id=ws.id, name=ws.name, role=role)


@router.get("/{workspace_id}/tree", response_model=TreeOut)
async def get_tree(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TreeOut:
    role = await require_role(db, user, workspace_id, Role.viewer)
    folders = await db.scalars(
        select(Folder).where(Folder.workspace_id == workspace_id).order_by(Folder.name)
    )
    files = await db.scalars(
        select(File)
        .where(File.workspace_id == workspace_id, File.deleted_at.is_(None))
        .order_by(File.name)
    )
    return TreeOut(
        role=role,
        folders=[FolderOut.model_validate(f) for f in folders],
        files=[FileOut.model_validate(f) for f in files],
    )


# --- members ---------------------------------------------------------------------------


def _member_out(user: User, role: Role) -> MemberOut:
    return MemberOut(user_id=user.id, email=user.email, display_name=user.display_name, role=role)


async def _get_membership(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> Membership:
    membership = await db.get(Membership, (workspace_id, user_id))
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return membership


async def _guard_last_owner(db: AsyncSession, membership: Membership) -> None:
    """Refuse to demote or remove the only owner: the workspace would become unmanageable."""
    if membership.role is not Role.owner:
        return
    owners = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.workspace_id == membership.workspace_id, Membership.role == Role.owner)
    )
    if owners <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A workspace needs at least one owner")


@router.get("/{workspace_id}/members", response_model=list[MemberOut])
async def list_members(
    workspace_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[MemberOut]:
    await require_role(db, user, workspace_id, Role.viewer)
    rows = await db.execute(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.workspace_id == workspace_id)
        .order_by(Membership.created_at)
    )
    return [_member_out(u, role) for u, role in rows]


@router.post(
    "/{workspace_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED
)
async def add_member(
    workspace_id: uuid.UUID, body: MemberIn, user: CurrentUser, db: DbSession
) -> MemberOut:
    await require_role(db, user, workspace_id, Role.owner)
    target = await db.scalar(select(User).where(User.email == body.email))
    if target is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No account with that email. Ask them to register first."
        )
    if await db.get(Membership, (workspace_id, target.id)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already a member")
    db.add(Membership(workspace_id=workspace_id, user_id=target.id, role=body.role))
    await db.commit()
    return _member_out(target, body.role)


@router.patch("/{workspace_id}/members/{user_id}", response_model=MemberOut)
async def update_member(
    workspace_id: uuid.UUID, user_id: uuid.UUID, body: MemberPatch, user: CurrentUser, db: DbSession
) -> MemberOut:
    await require_role(db, user, workspace_id, Role.owner)
    membership = await _get_membership(db, workspace_id, user_id)
    if body.role is not Role.owner:
        await _guard_last_owner(db, membership)
    membership.role = body.role
    await db.commit()
    return _member_out(await db.get_one(User, user_id), body.role)


@router.delete("/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    workspace_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    await require_role(db, user, workspace_id, Role.owner)
    membership = await _get_membership(db, workspace_id, user_id)
    await _guard_last_owner(db, membership)
    await db.delete(membership)
    await db.commit()
