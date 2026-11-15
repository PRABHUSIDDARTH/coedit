from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Completion:
    text: str
    input_tokens: int
    output_tokens: int
    model: str


class ProviderError(Exception):
    """A provider call failed. Carries the HTTP status only; the provider's message may quote
    the request (including credentials), so it must never be stored, returned or logged."""

    def __init__(self, provider: str, status: int | None, message: str = "") -> None:
        super().__init__(message)
        self.provider = provider
        self.status = status


class LLMAdapter(Protocol):
    """One provider behind a single call shape. No tools, no streaming."""

    name: str
    model: str

    async def complete(self, system: str, user: str, max_tokens: int) -> Completion: ...
