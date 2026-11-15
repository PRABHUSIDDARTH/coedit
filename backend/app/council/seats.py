from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(frozen=True)
class SeatConfig:
    """One OpenAI-compatible seat. The key lives only here (and in the SDK client), in memory,
    for the duration of one run; it is never stored, logged or echoed."""

    seat_id: str
    base_url: str
    model: str
    price_in: Decimal  # USD per million tokens; 0 = free / local
    price_out: Decimal
    token_cap: int  # per-seat cap on tokens (input + output) across the whole run
    api_key: str | None = field(default=None, repr=False)
