import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.council import pipeline
from app.council.adapters import AdapterFactory, get_adapter_factory, provider_modes
from app.deps import CurrentUser, DbSession, require_role
from app.models import CouncilRun, CouncilStep, Provider, ProviderKey, Role, RunStatus, Stage, User
from app.routers.folders import folder_in_workspace
from app.services import crypto

router = APIRouter(prefix="/api", tags=["council"])


class RunIn(BaseModel):
    brief: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]
    output_folder_id: uuid.UUID | None = None
    synth_provider: Provider
    # Larger values are accepted and clamped to the server maximum (200k tokens / $5).
    token_cap: int = Field(gt=0)
    cost_cap_usd: Decimal = Field(gt=0)


class StepOut(BaseModel):
    stage: Stage
    provider: Provider
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    ok: bool
    error: str | None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    output_folder_id: uuid.UUID | None
    synth_provider: Provider
    status: RunStatus
    token_cap: int
    cost_cap_usd: Decimal
    tokens_used: int
    cost_usd: Decimal
    error: str | None
    created_at: datetime
    finished_at: datetime | None
    steps: list[StepOut] = []


class ProviderInfo(BaseModel):
    provider: Provider
    mode: str  # "live" | "demo" | "missing"
    model: str


class ConfigOut(BaseModel):
    providers: list[ProviderInfo]
    max_token_cap: int
    max_cost_cap_usd: Decimal


@router.get("/council/config", response_model=ConfigOut)
async def council_config(user: CurrentUser, db: DbSession) -> ConfigOut:
    """What a run started by this user would use (no secrets)."""
    have = set(await db.scalars(select(ProviderKey.provider).where(ProviderKey.user_id == user.id)))
    settings = get_settings()
    live_model = {
        Provider.anthropic: settings.council_model_anthropic,
        Provider.openai: settings.council_model_openai,
        Provider.google: settings.council_model_google,
    }
    return ConfigOut(
        providers=[
            ProviderInfo(
                provider=p,
                mode=mode,
                model=live_model.get(p, "")
                if mode == "live"
                else ("canned text" if mode == "demo" else ""),
            )
            for p, mode in provider_modes(have).items()
        ],
        max_token_cap=pipeline.HARD_TOKEN_CAP,
        max_cost_cap_usd=pipeline.HARD_COST_CAP_USD,
    )


async def _decrypted_keys(db: AsyncSession, user: User) -> dict[Provider, str]:
    rows = await db.scalars(select(ProviderKey).where(ProviderKey.user_id == user.id))
    keys: dict[Provider, str] = {}
    for row in rows:
        try:
            keys[row.provider] = crypto.decrypt(row.ciphertext, row.nonce, user.id, row.provider)
        except crypto.DecryptionError:
            continue  # stored under another master key: treated as "no key"
    return keys


@router.post(
    "/workspaces/{workspace_id}/council/runs",
    response_model=RunOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_run(
    workspace_id: uuid.UUID,
    body: RunIn,
    user: CurrentUser,
    db: DbSession,
    factory: Annotated[AdapterFactory, Depends(get_adapter_factory)],
) -> CouncilRun:
    await require_role(db, user, workspace_id, Role.owner)
    await folder_in_workspace(db, body.output_folder_id, workspace_id)
    adapters = factory(await _decrypted_keys(db, user))
    if len(adapters) < 2 or body.synth_provider not in adapters:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The council needs at least one provider API key (Anthropic, OpenAI or Google). "
            "Providers without a key take part as demo seats. Add a key under Settings.",
        )
    run = CouncilRun(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        output_folder_id=body.output_folder_id,
        created_by=user.id,
        brief=body.brief,
        synth_provider=body.synth_provider,
        status=RunStatus.queued,
        token_cap=min(body.token_cap, pipeline.HARD_TOKEN_CAP),
        cost_cap_usd=min(body.cost_cap_usd, pipeline.HARD_COST_CAP_USD),
        tokens_used=0,
        cost_usd=Decimal(0),
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    pipeline.launch(run.id, adapters)  # the decrypted keys live only inside these adapters
    return run


async def _run_out(db: AsyncSession, run: CouncilRun) -> RunOut:
    steps = await db.scalars(
        select(CouncilStep).where(CouncilStep.run_id == run.id).order_by(CouncilStep.created_at)
    )
    out = RunOut.model_validate(run)
    out.steps = [
        StepOut(
            stage=s.stage,
            provider=s.provider,
            model=s.model,
            input_tokens=s.input_tokens,
            output_tokens=s.output_tokens,
            cost_usd=s.cost_usd,
            ok=s.error is None,
            error=s.error,
        )
        for s in steps
    ]
    return out


@router.get("/workspaces/{workspace_id}/council/runs", response_model=list[RunOut])
async def list_runs(workspace_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[RunOut]:
    await require_role(db, user, workspace_id, Role.owner)
    runs = await db.scalars(
        select(CouncilRun)
        .where(CouncilRun.workspace_id == workspace_id)
        .order_by(CouncilRun.created_at.desc())
        .limit(10)
    )
    return [RunOut.model_validate(run) for run in runs]


@router.get("/council/runs/{run_id}", response_model=RunOut)
async def get_run(run_id: uuid.UUID, user: CurrentUser, db: DbSession) -> RunOut:
    run = await db.get(CouncilRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await require_role(db, user, run.workspace_id, Role.owner)
    return await _run_out(db, run)
