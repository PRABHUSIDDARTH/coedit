"""Deterministic stand-in for a provider: used by every test and by COUNCIL_FAKE=1."""

import hashlib

from app.council import prompts
from app.council.adapters.base import Completion

FAKE_MODEL = "fake-model"


class FakeAdapter:
    def __init__(self, name: str, model: str = FAKE_MODEL) -> None:
        self.name = name
        self.model = model
        #: every (system, user) pair received, in order
        self.calls: list[tuple[str, str]] = []
        #: raised instead of answering; limited to `fail_stages` when that is set
        self.error: Exception | None = None
        self.fail_stages: set[str] | None = None
        #: replaces the generated synthesis output
        self.synthesis_text: str | None = None
        #: (input, output) token counts to report instead of chars/4
        self.tokens: tuple[int, int] | None = None

    async def complete(self, system: str, user: str, max_tokens: int) -> Completion:
        self.calls.append((system, user))
        stage = prompts.stage_of(system)
        if self.error is not None and (self.fail_stages is None or stage in self.fail_stages):
            raise self.error
        digest = hashlib.sha256(user.encode()).hexdigest()[:8]
        if stage == "synthesis":
            text = self.synthesis_text or "".join(
                f"=== FILE: {name} ===\n# {name}\n\nDemo output from the fake provider "
                f"({self.name}, input {digest}).\n\n"
                for name in prompts.ALLOWED_FILES
            )
        else:
            text = (
                f"[{self.name}] {stage} of input {digest}: looks reasonable; keep the scope small."
            )
        tokens_in, tokens_out = self.tokens or (
            (len(system) + len(user)) // 4,
            min(len(text) // 4, max_tokens),
        )
        return Completion(text, tokens_in, tokens_out, self.model)
