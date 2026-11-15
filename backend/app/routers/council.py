import asyncio
import uuid
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.council import netguard, pipeline
from app.council.adapters import AdapterFactory, get_adapter_factory, provider_modes
from app.council.adapters.base import LLMAdapter
from app.council.adapters.openai_compat import OpenAICompatAdapter
from app.council.models_list import list_models
from app.council.presets import get_presets, preset_hosts
from app.council.seats import SeatConfig
from app.deps import CurrentUser, DbSession, require_role
from app.models import CouncilRun, CouncilStep, Provider, ProviderKey, Role, RunStatus, Stage, User
from app.routers.folders import folder_in_workspace
from app.services import crypto

router = APIRouter(prefix="/api", tags=["council"])


SeatFactory = Callable[[SeatConfig], LLMAdapter]


def get_seat_factory() -> SeatFactory:
    """FastAPI dependency (tests override it): builds the adapter for a custom seat."""
    settings = get_settings()
    return lambda seat: OpenAICompatAdapter(
        seat, allow_local=settings.council_allow_local_providers, preset_hosts=preset_hosts()
    )


class SeatIn(BaseModel):
    """An OpenAI-compatible seat: a preset (Groq, NVIDIA NIM, Ollama, ...) or a base URL, the
    model the user picked, its price and its own token cap. The key is used for this run only
    and is never stored."""

    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,30}$")]
    preset: str | None = None
    base_url: Annotated[str, StringConstraints(max_length=500)] | None = None
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    # Required: 0 means free/local. Left out = the run is refused with a clear message.
    price_in: Decimal | None = Field(default=None, ge=0, le=10_000)
    price_out: Decimal | None = Field(default=None, ge=0, le=10_000)
    token_cap: int = Field(gt=0)
    api_key: SecretStr | None = None


class RunIn(BaseModel):
    brief: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]
    output_folder_id: uuid.UUID | None = None
    synth_provider: str  # a native provider name or the id of a custom seat
    seats: list[SeatIn] = Field(default_factory=list, max_length=5)
    # Larger values are accepted and clamped to the server maximum (200k tokens / $5).
    token_cap: int = Field(gt=0)
    cost_cap_usd: Decimal = Field(gt=0)


class StepOut(BaseModel):
    stage: Stage
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    ok: bool
    error: str | None
    scores: dict[str, int] | None = None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    output_folder_id: uuid.UUID | None
    synth_provider: str
    status: RunStatus
    token_cap: int
    cost_cap_usd: Decimal
    tokens_used: int
    cost_usd: Decimal
    error: str | None
    created_at: datetime
    finished_at: datetime | None
    steps: list[StepOut] = []
    #: one line per failed step ("critique by groq: critique scores could not be parsed")
    report: list[str] = []


class ProviderInfo(BaseModel):
    provider: Provider
    mode: str  # "live" | "demo" | "missing"
    model: str


class PresetInfo(BaseModel):
    id: str
    label: str
    base_url: str
    needs_key: bool


class ConfigOut(BaseModel):
    providers: list[ProviderInfo]
    presets: list[PresetInfo]
    allow_local_providers: bool
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
        presets=[
            PresetInfo(id=p.id, label=p.label, base_url=p.base_url, needs_key=p.needs_key)
            for p in get_presets().values()
        ],
        allow_local_providers=settings.council_allow_local_providers,
        max_token_cap=pipeline.HARD_TOKEN_CAP,
        max_cost_cap_usd=pipeline.HARD_COST_CAP_USD,
    )


def _bad(message: str) -> HTTPException:
    return HTTPException(422, message)


async def _seat_url(seat: SeatIn) -> str:
    """The seat's base URL, validated against the SSRF policy."""
    presets = get_presets()
    preset = presets.get(seat.preset) if seat.preset else None
    if seat.preset and preset is None:
        raise _bad(f"Seat '{seat.id}': unknown preset.")
    url = seat.base_url or (preset.base_url if preset else None)
    if not url:
        raise _bad(f"Seat '{seat.id}': choose a preset or enter a base URL.")
    try:
        return await netguard.validate_base_url(
            url,
            allow_local=get_settings().council_allow_local_providers,
            preset_hosts=preset_hosts(),
        )
    except netguard.UnsafeURL as exc:
        raise _bad(f"Seat '{seat.id}': {exc}") from None


async def _validated_seats(seats: list[SeatIn]) -> list[SeatConfig]:
    if len({s.id for s in seats}) != len(seats) or any(s.id in Provider for s in seats):
        raise _bad("Seat ids must be unique and must not reuse a built-in provider name.")
    presets = get_presets()
    out: list[SeatConfig] = []
    for seat in seats:
        if seat.price_in is None or seat.price_out is None:
            raise _bad(
                f"Seat '{seat.id}' (model '{seat.model}') has no price set, so the cost cap "
                "cannot be enforced. Enter the input and output price per million tokens "
                "(0 for a free or local model)."
            )
        if seat.token_cap > pipeline.HARD_TOKEN_CAP:
            raise _bad(
                f"Seat '{seat.id}': the per-seat token cap is at most {pipeline.HARD_TOKEN_CAP}."
            )
        key = seat.api_key.get_secret_value().strip() if seat.api_key else None
        preset = presets.get(seat.preset) if seat.preset else None
        if preset is not None and preset.needs_key and not key:
            raise _bad(f"Seat '{seat.id}': {preset.label} needs an API key.")
        out.append(
            SeatConfig(
                seat.id,
                await _seat_url(seat),
                seat.model,
                seat.price_in,
                seat.price_out,
                seat.token_cap,
                key or None,
            )
        )
    return out


class ModelsIn(BaseModel):
    preset: str | None = None
    base_url: Annotated[str, StringConstraints(max_length=500)] | None = None
    api_key: SecretStr | None = None


class ModelsOut(BaseModel):
    ok: bool
    models: list[str]
    source: str
    error: str | None


@router.post("/workspaces/{workspace_id}/council/models", response_model=ModelsOut)
async def council_models(
    workspace_id: uuid.UUID, body: ModelsIn, user: CurrentUser, db: DbSession
) -> ModelsOut:
    """Models offered by a preset / base URL (GET {base}/models, Ollama's /api/tags as a
    fallback). Also the "Test connection" check. The key is used for this call only."""
    await require_role(db, user, workspace_id, Role.owner)
    settings = get_settings()
    seat = SeatIn(id="probe", preset=body.preset, base_url=body.base_url, model="-", token_cap=1)
    try:
        base_url = await _seat_url(seat)
    except HTTPException as exc:
        raise _bad(str(exc.detail).removeprefix("Seat 'probe': ")) from None
    result = await list_models(
        base_url,
        body.api_key.get_secret_value().strip() if body.api_key else None,
        allow_local=settings.council_allow_local_providers,
        preset_hosts=preset_hosts(),
        resolver=netguard.system_resolver,
    )
    return ModelsOut(ok=result.ok, models=result.models, source=result.source, error=result.error)


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
    seat_factory: Annotated[SeatFactory, Depends(get_seat_factory)],
) -> CouncilRun:
    await require_role(db, user, workspace_id, Role.owner)
    await folder_in_workspace(db, body.output_folder_id, workspace_id)
    keys = await _decrypted_keys(db, user)
    adapters: dict[str, LLMAdapter] = dict(factory(keys))
    if body.seats:
        # Custom seats make their own council: native providers take part only with a key of
        # their own (no demo seats next to real ones), unless the demo mode is switched on.
        if not get_settings().council_fake:
            adapters = {p: a for p, a in adapters.items() if Provider(p) in keys}
        for seat in await _validated_seats(body.seats):
            adapters[seat.seat_id] = seat_factory(seat)
    if len(adapters) < 2 or body.synth_provider not in adapters:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The council needs at least two seats, and the synthesis seat must be one of them. "
            "Add a provider API key under Settings or add an OpenAI-compatible seat.",
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
    steps = (
        await db.scalars(
            select(CouncilStep).where(CouncilStep.run_id == run.id).order_by(CouncilStep.created_at)
        )
    ).all()
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
            scores=s.scores,
        )
        for s in steps
    ]
    out.report = [f"{s.stage.value} by {s.provider}: {s.error}" for s in steps if s.error]
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


@router.post("/council/runs/{run_id}/cancel", response_model=RunOut)
async def cancel_run(run_id: uuid.UUID, user: CurrentUser, db: DbSession) -> RunOut:
    """Stop a running council. Steps that already finished keep their cost; the run ends as
    `failed` with the message STOPPED_MESSAGE."""
    run = await db.get(CouncilRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await require_role(db, user, run.workspace_id, Role.owner)
    if run.status not in pipeline.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, "This run has already finished.")
    task = pipeline.cancel(run_id)
    if task is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This run cannot be stopped now: it is saving its files or is not running.",
        )
    await asyncio.wait({task}, timeout=5)
    await db.refresh(run)
    return await _run_out(db, run)


@router.get("/council/runs/{run_id}", response_model=RunOut)
async def get_run(run_id: uuid.UUID, user: CurrentUser, db: DbSession) -> RunOut:
    run = await db.get(CouncilRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await require_role(db, user, run.workspace_id, Role.owner)
    return await _run_out(db, run)
