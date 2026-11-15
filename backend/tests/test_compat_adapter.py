"""OpenAI-compatible seat specifics, on top of the shared contract suite in test_adapters.py."""

import logging
from decimal import Decimal

import pytest

from app.council.adapters.base import ProviderError
from app.council.adapters.openai_compat import NO_KEY, OpenAICompatAdapter
from app.council.presets import get_presets, preset_hosts
from app.council.seats import SeatConfig
from tests.test_adapters import _OLLAMA_OK, Stub, stub  # noqa: F401  (stub is a fixture)


def seat(url: str, key: str | None = None, **kw) -> SeatConfig:
    base = {
        "seat_id": "ollama",
        "base_url": url + "/v1",
        "model": "llama-local:8b",
        "price_in": Decimal(0),
        "price_out": Decimal(0),
        "token_cap": 5000,
        "api_key": key,
    }
    return SeatConfig(**(base | kw))


async def test_keyless_server_gets_a_placeholder_and_free_price(stub: Stub) -> None:  # noqa: F811
    stub.default = _OLLAMA_OK
    adapter = OpenAICompatAdapter(seat(stub.url), allow_local=True)
    result = await adapter.complete("s", "u", 50)
    assert result.input_tokens == 20 and adapter.price.cost(1_000_000, 1_000_000) == 0
    assert stub.requests[0]["headers"]["authorization"] == f"Bearer {NO_KEY}"
    body = stub.requests[0]["body"]
    assert body["max_tokens"] == 50 and "max_completion_tokens" not in body
    assert "reasoning_effort" not in body


async def test_seat_repr_hides_the_key() -> None:
    assert "sk-secret" not in repr(seat("http://x", "sk-secret"))


async def test_loopback_seat_is_refused_without_the_flag(
    stub: Stub,  # noqa: F811
    caplog: pytest.LogCaptureFixture,
) -> None:
    stub.default = _OLLAMA_OK
    adapter = OpenAICompatAdapter(seat(stub.url, "sk-secret-123456"), allow_local=False)
    with caplog.at_level(logging.DEBUG), pytest.raises(ProviderError) as caught:
        await adapter.complete("s", "u", 10)
    assert caught.value.status is None and caught.value.__cause__ is None
    assert stub.requests == []  # nothing was sent to the loopback server
    assert "sk-secret-123456" not in caplog.text + repr(caught.value)


async def test_redirect_from_provider_is_not_followed_to_private_host(
    stub: Stub,  # noqa: F811
) -> None:
    """A provider answering 302 -> loopback must not be followed (flag off)."""
    adapter = OpenAICompatAdapter(
        seat("https://api.groq.com/openai", "k"),
        allow_local=False,
        preset_hosts=preset_hosts(),
        resolver=_public_then_redirect,
    )
    with pytest.raises(ProviderError):
        await adapter.complete("s", "u", 10)


async def _public_then_redirect(host: str, port: int) -> list[str]:
    return ["10.0.0.5"]  # the "preset" name now points inside the network


def test_builtin_presets_and_config_presets(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    presets = get_presets()
    assert presets["groq"].base_url == "https://api.groq.com/openai/v1"
    assert presets["nvidia-nim"].base_url == "https://integrate.api.nvidia.com/v1"
    assert presets["ollama"].base_url == "http://host.docker.internal:11434/v1"
    assert presets["ollama"].needs_key is False
    monkeypatch.setattr(
        get_settings(),
        "council_provider_presets",
        '{"together": {"label": "Together", "base_url": "https://api.together.xyz/v1/"}}',
    )
    assert get_presets()["together"].base_url == "https://api.together.xyz/v1"
    assert "api.together.xyz" in preset_hosts()
