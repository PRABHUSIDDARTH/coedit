"""workspaces, memberships, folders, files

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def _ts(name: str = "created_at") -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("owner_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        _ts(),
    )
    op.create_table(
        "memberships",
        sa.Column("workspace_id", UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.Enum("owner", "editor", "viewer", name="member_role"), nullable=False),
        _ts(),
    )
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])
    op.create_table(
        "folders",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("workspace_id", UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", UUID, sa.ForeignKey("folders.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        _ts(),
        sa.UniqueConstraint(
            "workspace_id", "parent_id", "name",
            name="uq_folders_workspace_parent_name",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_table(
        "files",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("workspace_id", UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("folder_id", UUID, sa.ForeignKey("folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Enum("doc", "sheet", "blob", name="file_kind"), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=True),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        _ts(),
        _ts("updated_at"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_files_workspace_id", "files", ["workspace_id"])


def downgrade() -> None:
    op.drop_table("files")
    op.drop_table("folders")
    op.drop_table("memberships")
    op.drop_table("workspaces")
    op.execute("DROP TYPE file_kind")
    op.execute("DROP TYPE member_role")
