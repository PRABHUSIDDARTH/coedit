"""council seats: provider columns become text (custom OpenAI-compatible seat ids), step scores

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `llm_provider` stays for provider_keys; steps and runs now hold a seat id (a native
    # provider name or the id of a custom seat).
    op.execute("ALTER TABLE council_steps ALTER COLUMN provider TYPE text USING provider::text")
    op.execute(
        "ALTER TABLE council_runs ALTER COLUMN synth_provider TYPE text USING synth_provider::text"
    )
    op.add_column("council_steps", sa.Column("scores", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("council_steps", "scores")
    op.execute(
        "ALTER TABLE council_runs ALTER COLUMN synth_provider "
        "TYPE llm_provider USING synth_provider::llm_provider"
    )
    op.execute(
        "ALTER TABLE council_steps ALTER COLUMN provider TYPE llm_provider "
        "USING provider::llm_provider"
    )
