"""ORM models. Tables are added slice by slice."""

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    LargeBinary,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

__all__ = [
    "Base",
    "CouncilRun",
    "CouncilStep",
    "DocState",
    "File",
    "FileKind",
    "FileVersion",
    "Folder",
    "Membership",
    "Provider",
    "ProviderKey",
    "Role",
    "RunStatus",
    "Stage",
    "User",
    "Workspace",
]


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Role(enum.StrEnum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


class FileKind(enum.StrEnum):
    doc = "doc"
    sheet = "sheet"
    blob = "blob"


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(Text)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created_at()


class Membership(Base):
    __tablename__ = "memberships"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)
    role: Mapped[Role] = mapped_column(Enum(Role, name="member_role"))
    created_at: Mapped[datetime] = _created_at()


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "parent_id",
            "name",
            name="uq_folders_workspace_parent_name",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class File(Base):
    __tablename__ = "files"

    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[FileKind] = mapped_column(Enum(FileKind, name="file_kind"))
    current_version: Mapped[int | None]
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocState(Base):
    """Yjs state of a doc or sheet. Written only by the sync sidecar; the API never edits it."""

    __tablename__ = "doc_states"

    file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("files.id", ondelete="CASCADE"), primary_key=True
    )
    state: Mapped[bytes] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FileVersion(Base):
    """One uploaded revision of a blob file; `storage_key` is the sha256 of its bytes."""

    __tablename__ = "file_versions"
    __table_args__ = (
        UniqueConstraint("file_id", "version_no", name="uq_file_versions_file_version"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    version_no: Mapped[int]
    storage_key: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    mime: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created_at()


class Provider(enum.StrEnum):
    anthropic = "anthropic"
    openai = "openai"
    google = "google"


class RunStatus(enum.StrEnum):
    queued = "queued"
    drafting = "drafting"
    critiquing = "critiquing"
    synthesizing = "synthesizing"
    done = "done"
    failed = "failed"
    capped = "capped"


class Stage(enum.StrEnum):
    draft = "draft"
    critique = "critique"
    synthesis = "synthesis"


class ProviderKey(Base):
    """A user's API key for one LLM provider, AES-256-GCM encrypted (see services/crypto.py)."""

    __tablename__ = "provider_keys"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_provider_keys_user_provider"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[Provider] = mapped_column(Enum(Provider, name="llm_provider"))
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    last4: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class CouncilRun(Base):
    __tablename__ = "council_runs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    output_folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    brief: Mapped[str] = mapped_column(Text)
    synth_provider: Mapped[str] = mapped_column(Text)  # seat id: a Provider value or a custom id
    status: Mapped[RunStatus] = mapped_column(
        Enum(RunStatus, name="council_run_status"), default=RunStatus.queued
    )
    token_cap: Mapped[int]
    cost_cap_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    tokens_used: Mapped[int] = mapped_column(default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CouncilStep(Base):
    """One model call. `error` holds an error class or HTTP status only, never provider text."""

    __tablename__ = "council_steps"

    id: Mapped[uuid.UUID] = _uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("council_runs.id", ondelete="CASCADE"), index=True
    )
    stage: Mapped[Stage] = mapped_column(Enum(Stage, name="council_stage"))
    provider: Mapped[str] = mapped_column(Text)  # seat id: a Provider value or a custom seat id
    model: Mapped[str] = mapped_column(Text)
    input_tokens: Mapped[int] = mapped_column(default=0)
    output_tokens: Mapped[int] = mapped_column(default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0))
    output_text: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text)
    scores: Mapped[dict | None] = mapped_column(JSONB)  # critique stage: {draft seat: 0..10}
    created_at: Mapped[datetime] = _created_at()
