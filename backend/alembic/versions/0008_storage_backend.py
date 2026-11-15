"""file_versions: record which storage backend holds each version, and its sha256

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "file_versions",
        sa.Column("storage_backend", sa.Text(), nullable=False, server_default="local"),
    )
    op.add_column("file_versions", sa.Column("sha256", sa.Text(), nullable=True))
    # Every existing version is local, where the key is the sha256 of the bytes.
    op.execute("UPDATE file_versions SET sha256 = storage_key")
    op.alter_column("file_versions", "sha256", nullable=False)


def downgrade() -> None:
    op.drop_column("file_versions", "sha256")
    op.drop_column("file_versions", "storage_backend")
