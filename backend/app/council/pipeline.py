"""Council run: drafts in parallel -> each critiques the others -> one synthesis -> files.

Runs as an in-process asyncio task. All database writes happen here in the orchestrator, one
short session at a time; the parallel provider calls never touch the database.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select, update

from app.council import prompts
from app.council.adapters.base import Completion, LLMAdapter, ProviderError
from app.council.prices import UnknownModelPrice, price_for
from app.db import SessionLocal
from app.models import CouncilRun, CouncilStep, File, FileKind, Folder, Provider, RunStatus, Stage
from app.services import storage

logger = logging.getLogger(__name__)

HARD_TOKEN_CAP = 200_000
HARD_COST_CAP_USD = Decimal(5)
CALL_TIMEOUT_SECONDS = 120
# Output allowance per call (for Claude this includes thinking tokens).
MAX_TOKENS = {Stage.draft: 4000, Stage.critique: 3000, Stage.synthesis: 12000}
ACTIVE = (RunStatus.queued, RunStatus.drafting, RunStatus.critiquing, RunStatus.synthesizing)

_tasks: set[asyncio.Task[None]] = set()  # strong references so running tasks are not collected


@dataclass(frozen=True)
class Call:
    provider: Provider
    adapter: LLMAdapter
    stage: Stage
    system: str
    user: str

    @property
    def max_tokens(self) -> int:
        return MAX_TOKENS[self.stage]

    def estimate(self) -> tuple[int, Decimal]:
        """Worst-case (tokens, cost): input at ~4 chars per token plus the full output allowance."""
        input_tokens = (len(self.system) + len(self.user)) // 4 + 1
        cost = price_for(self.adapter.model).cost(input_tokens, self.max_tokens)
        return input_tokens + self.max_tokens, cost


@dataclass
class Budget:
    token_cap: int
    cost_cap: Decimal
    tokens: int = 0
    cost: Decimal = Decimal(0)

    def affordable(self, calls: list[Call]) -> bool:
        """Would this whole stage fit? Checked once for all its parallel calls together, so
        three calls cannot each pass the same check and overshoot between them."""
        estimates = [call.estimate() for call in calls]
        return (
            self.tokens + sum(t for t, _ in estimates) <= self.token_cap
            and self.cost + sum(c for _, c in estimates) <= self.cost_cap
        )

    def charge(self, model: str, completion: Completion) -> Decimal:
        cost = price_for(model).cost(completion.input_tokens, completion.output_tokens)
        self.tokens += completion.input_tokens + completion.output_tokens
        self.cost += cost
        return cost


def stage_estimate_tokens(adapters: list[LLMAdapter], brief: str) -> int:
    """Token reservation for the draft stage with these adapters (used to size caps)."""
    user = prompts.draft_user(brief)
    return sum(
        Call(Provider.anthropic, a, Stage.draft, prompts.DRAFT_SYSTEM, user).estimate()[0]
        for a in adapters
    )


def safe_error(exc: BaseException) -> str:
    """A description that is safe to store and show: never the exception's own message, which
    can quote request details such as an API key."""
    if isinstance(exc, ProviderError):
        return f"provider returned HTTP {exc.status}" if exc.status else "provider call failed"
    if isinstance(exc, TimeoutError):
        return "timed out"
    return type(exc).__name__


async def _invoke(call: Call) -> Completion | BaseException:
    try:
        return await asyncio.wait_for(
            call.adapter.complete(call.system, call.user, call.max_tokens), CALL_TIMEOUT_SECONDS
        )
    except Exception as exc:  # noqa: BLE001  (any provider failure is recorded, not raised)
        logger.warning(
            "council call failed: provider=%s stage=%s error=%s",
            call.provider.value,
            call.stage.value,
            safe_error(exc),
        )
        return exc


async def _set_status(run_id: uuid.UUID, status: RunStatus, error: str | None = None) -> None:
    values: dict = {"status": status}
    if status not in ACTIVE:
        values |= {"error": error, "finished_at": func.now()}
    async with SessionLocal() as db:
        await db.execute(update(CouncilRun).where(CouncilRun.id == run_id).values(**values))
        await db.commit()


async def _run_stage(
    run_id: uuid.UUID, budget: Budget, status: RunStatus, calls: list[Call]
) -> dict[Provider, str] | None:
    """Run one stage's calls in parallel and record them. Returns the successful outputs by
    provider, or None if the stage did not fit in the budget (the run is then `capped`)."""
    if not budget.affordable(calls):
        await _set_status(run_id, RunStatus.capped)
        return None
    await _set_status(run_id, status)
    results = await asyncio.gather(*(_invoke(call) for call in calls))

    outputs: dict[Provider, str] = {}
    async with SessionLocal() as db:
        for call, result in zip(calls, results, strict=True):
            step = CouncilStep(
                run_id=run_id, stage=call.stage, provider=call.provider, model=call.adapter.model
            )
            if isinstance(result, BaseException):
                step.error = safe_error(result)
            else:
                step.input_tokens = result.input_tokens
                step.output_tokens = result.output_tokens
                step.cost_usd = budget.charge(call.adapter.model, result)
                step.output_text = result.text
                outputs[call.provider] = result.text
            db.add(step)
        await db.execute(
            update(CouncilRun)
            .where(CouncilRun.id == run_id)
            .values(tokens_used=budget.tokens, cost_usd=budget.cost)
        )
        await db.commit()
    return outputs


async def _save_files(run: CouncilRun, files: dict[str, str]) -> None:
    from app.routers.blobs import add_version  # local import: routers import this module

    async with SessionLocal() as db:
        folder_id = run.output_folder_id
        if folder_id is not None and await db.get(Folder, folder_id) is None:
            folder_id = None  # the folder was deleted while the run was in flight
        for name in prompts.ALLOWED_FILES:
            if name not in files:
                continue
            key, size = await storage.save_bytes(files[name].encode())
            row = File(
                id=uuid.uuid4(),
                workspace_id=run.workspace_id,
                folder_id=folder_id,
                name=name,
                kind=FileKind.blob,
                created_by=run.created_by,
            )
            db.add(row)
            await db.flush()
            await add_version(db, row, run.created_by, key, size, "text/markdown")
        await db.commit()


async def _run(run_id: uuid.UUID, adapters: dict[Provider, LLMAdapter]) -> None:
    async with SessionLocal() as db:
        run = await db.get_one(CouncilRun, run_id)
    try:
        for adapter in adapters.values():
            price_for(adapter.model)
    except UnknownModelPrice as exc:
        await _set_status(
            run_id,
            RunStatus.failed,
            f"No price is configured for model '{exc.model}', so the cost cap cannot be "
            "enforced. Add it to COUNCIL_PRICES and try again.",
        )
        return

    budget = Budget(run.token_cap, run.cost_cap_usd)
    brief = run.brief

    drafts = await _run_stage(
        run_id,
        budget,
        RunStatus.drafting,
        [
            Call(p, a, Stage.draft, prompts.DRAFT_SYSTEM, prompts.draft_user(brief))
            for p, a in adapters.items()
        ],
    )
    if drafts is None:
        return
    if len(drafts) < 2:
        await _set_status(run_id, RunStatus.failed, "Fewer than two providers produced a draft.")
        return

    critiques = await _run_stage(
        run_id,
        budget,
        RunStatus.critiquing,
        [
            Call(
                p,
                adapters[p],
                Stage.critique,
                prompts.CRITIQUE_SYSTEM,
                prompts.critique_user(brief, {q.value: d for q, d in drafts.items() if q != p}),
            )
            for p in drafts
        ],
    )
    if critiques is None:
        return

    synth = run.synth_provider
    named = lambda outputs: {p.value: text for p, text in outputs.items()}
    synthesis = await _run_stage(
        run_id,
        budget,
        RunStatus.synthesizing,
        [
            Call(
                synth,
                adapters[synth],
                Stage.synthesis,
                prompts.SYNTHESIS_SYSTEM,
                prompts.synthesis_user(brief, named(drafts), named(critiques)),
            )
        ],
    )
    if synthesis is None:
        return
    if synth not in synthesis:
        await _set_status(run_id, RunStatus.failed, "The synthesis call failed.")
        return

    files = prompts.parse_files(synthesis[synth])
    missing = [name for name in prompts.REQUIRED_FILES if name not in files]
    if missing:
        await _set_status(
            run_id, RunStatus.failed, f"The synthesis output is missing {' and '.join(missing)}."
        )
        return
    await _save_files(run, files)
    await _set_status(run_id, RunStatus.done)


async def run_council(run_id: uuid.UUID, adapters: dict[Provider, LLMAdapter]) -> None:
    try:
        await _run(run_id, adapters)
    except Exception as exc:  # noqa: BLE001
        logger.error("council run %s crashed: %s", run_id, type(exc).__name__)
        await _set_status(run_id, RunStatus.failed, f"Internal error ({type(exc).__name__}).")


def launch(run_id: uuid.UUID, adapters: dict[Provider, LLMAdapter]) -> None:
    task = asyncio.create_task(run_council(run_id, adapters), name=f"council-{run_id}")
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def fail_interrupted_runs() -> int:
    """Runs are in-process tasks, so any run still active at startup died with the last process."""
    async with SessionLocal() as db:
        ids = (await db.scalars(select(CouncilRun.id).where(CouncilRun.status.in_(ACTIVE)))).all()
        if ids:
            await db.execute(
                update(CouncilRun)
                .where(CouncilRun.id.in_(ids))
                .values(
                    status=RunStatus.failed,
                    error="Interrupted by a server restart.",
                    finished_at=func.now(),
                )
            )
            await db.commit()
        return len(ids)
