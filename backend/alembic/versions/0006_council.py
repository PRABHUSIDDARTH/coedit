"""provider_keys, council_runs, council_steps

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def _ts(name: str = "created_at") -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())


def upgrade() -> None:
    provider = postgresql.ENUM("anthropic", "openai", "google", name="llm_provider")
    provider.create(op.get_bind())
    provider_col = postgresql.ENUM(name="llm_provider", create_type=False)

    op.create_table(
        "provider_keys",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", provider_col, nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("last4", sa.Text(), nullable=False),
        _ts(),
        sa.UniqueConstraint("user_id", "provider", name="uq_provider_keys_user_provider"),
    )
    op.create_table(
        "council_runs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("workspace_id", UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("output_folder_id", UUID, sa.ForeignKey("folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("brief", sa.Text(), nullable=False),
        sa.Column("synth_provider", provider_col, nullable=False),
        sa.Column(
            "status",
            sa.Enum("queued", "drafting", "critiquing", "synthesizing", "done", "failed", "capped",
                    name="council_run_status"),
            nullable=False,
        ),
        sa.Column("token_cap", sa.Integer(), nullable=False),
        sa.Column("cost_cap_usd", sa.Numeric(12, 6), nullable=False),
        sa.Column("tokens_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        _ts(),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_council_runs_workspace_id", "council_runs", ["workspace_id"])
    op.create_table(
        "council_steps",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("run_id", UUID, sa.ForeignKey("council_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stage", sa.Enum("draft", "critique", "synthesis", name="council_stage"), nullable=False),
        sa.Column("provider", provider_col, nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("output_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        _ts(),
    )
    op.create_index("ix_council_steps_run_id", "council_steps", ["run_id"])


def downgrade() -> None:
    op.drop_table("council_steps")
    op.drop_table("council_runs")
    op.drop_table("provider_keys")
    for name in ("council_stage", "council_run_status", "llm_provider"):
        op.execute(f"DROP TYPE {name}")
