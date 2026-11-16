"""canvas files: a `canvas` file kind and one stored scene per canvas

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'canvas'")
    op.create_table(
        "canvas_scenes",
        sa.Column(
            "file_id",
            sa.Uuid(),
            sa.ForeignKey("files.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("scene", postgresql.JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    """DESTRUCTIVE for canvases: Postgres cannot drop an enum value, so canvas files are deleted
    and the type is rebuilt without it."""
    op.drop_table("canvas_scenes")
    op.execute("DELETE FROM files WHERE kind = 'canvas'")
    op.execute("ALTER TYPE file_kind RENAME TO file_kind_old")
    op.execute("CREATE TYPE file_kind AS ENUM ('doc', 'sheet', 'blob')")
    op.execute(
        "ALTER TABLE files ALTER COLUMN kind TYPE file_kind USING kind::text::file_kind"
    )
    op.execute("DROP TYPE file_kind_old")
