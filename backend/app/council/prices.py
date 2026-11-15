"""USD per million tokens, by model id. A model without a price cannot be run: the cost cap
would be meaningless, so the pipeline refuses instead of assuming zero."""

import json
from dataclasses import dataclass
from decimal import Decimal

from app.config import get_settings
from app.council.adapters.fake import FAKE_MODEL

_MILLION = Decimal(1_000_000)


class UnknownModelPrice(Exception):
    def __init__(self, model: str) -> None:
        super().__init__(model)
        self.model = model


@dataclass(frozen=True)
class Price:
    input_per_mtok: Decimal
    output_per_mtok: Decimal

    def cost(self, input_tokens: int, output_tokens: int) -> Decimal:
        return (
            self.input_per_mtok * input_tokens + self.output_per_mtok * output_tokens
        ) / _MILLION


# (input, output) USD per 1M tokens.
PRICES: dict[str, tuple[str, str]] = {
    FAKE_MODEL: ("1.00", "2.00"),  # pretend prices so fake runs show a realistic spend
    # Anthropic first-party API list prices (as of 2026-11-03; check before relying on them).
    "claude-fable-5-2": ("8.00", "40.00"),
    "claude-opus-5-5": ("4.00", "20.00"),
    "claude-sonnet-5-5": ("2.00", "10.00"),
    "claude-haiku-5-5": ("0.10", "0.50"),
    # OpenAI list prices, standard tier, <=272K input (read from the pricing page 2026-11-15).
    "gpt-6.1-terra": ("1.00", "5.00"),
    "gpt-6.1-sol": ("2.00", "10.00"),
    "gpt-6-luna": ("0.10", "0.50"),
    # Google: the pricing page announces increases (Gemini 3.8 Flash on 2027-01-01, the 4-series
    # on 2026-12-01); the NEW prices are listed so the cost cap never under-counts.
    "gemini-3.8-flash": ("1.50", "7.50"),
    "gemini-3.5-flash-lite": ("0.30", "2.50"),
}


def price_for(model: str) -> Price:
    """Price for `model`. COUNCIL_PRICES (JSON: {"model-id": [input, output]}) overrides and
    extends the built-in table, so a newly configured model can be priced without a code change."""
    table = dict(PRICES)
    overrides = get_settings().council_prices
    if overrides:
        table.update({k: (str(v[0]), str(v[1])) for k, v in json.loads(overrides).items()})
    if model not in table:
        raise UnknownModelPrice(model)
    price_in, price_out = table[model]
    return Price(Decimal(price_in), Decimal(price_out))
