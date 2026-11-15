"""OpenAI-compatible seats in the council pipeline: tolerant critique parsing, per-seat price and
token caps, SSRF refusal through the API, key hygiene, model listing. No network."""

import json
import logging
from collections.abc import Iterator
from decimal import Decimal

import httpx
import pytest

from app.council import netguard
from app.council.adapters import get_adapter_factory
from app.council.adapters.base import Completion
from app.council.adapters.fake import FakeAdapter
from app.council.models_list import ModelList, list_models
from app.council.prices import Price
from app.council.prompts import parse_scores
from app.main import app
from app.models import Provider
from app.routers import council as council_router
from app.routers.council import get_seat_factory
from tests.conftest import World
from tests.test_council import finished

SECRET = "gsk_" + "TESTKEYTESTKEYTESTKEY1234567890"


# --- tolerant parsing ----------------------------------------------------------------------

EXPECTED = ("a", "b")


@pytest.mark.parametrize(
    ("text", "want"),
    [
        ('Good.\nSCORES: {"a": 7, "b": 4}', {"a": 7, "b": 4}),
        ('**Scores**:\n```json\n{\'a\': "8/10", "b": 3,}\n```\nthanks', {"a": 8, "b": 3}),
        ("SCORES:\n- a: 6/10\n- **b**: 9", {"a": 6, "b": 9}),
        ("SCORES: {“a”: 5, “b”: 2}", {"a": 5, "b": 2}),
        ('SCORES: {"draft-a": 5}', {"a": 5}),  # prefix tolerated, partial accepted
        ('SCORES: {"a": 7.6, "zzz": 3}', {"a": 8}),  # rounded; unknown names ignored
        ('SCORES: {"a": 2, "b": 3}\nThe score reflects effort.', {"a": 2, "b": 3}),
        ('first SCORES: {"a": 1}\nrevised\nSCORES: {"a": 9, "b": 9}', {"a": 9, "b": 9}),
    ],
)
def test_parse_scores_tolerates_real_world_output(text: str, want: dict) -> None:
    assert parse_scores(text, EXPECTED) == want


@pytest.mark.parametrize(
    "text",
    [
        "",
        "no scores anywhere",
        "SCORES: great drafts!",
        'SCORES: {"a": 99, "b": -4}',
        'SCORES: {"a": "high"}',
        'SCORES: {"a": true}',
        "SCORES: null",
        "SCORES: {{{{[[[",
        'SCORES: {"other": 7}',
        "\x00\ud800 SCORES: \udfff",
    ],
)
def test_parse_scores_gives_up_without_raising(text: str) -> None:
    assert parse_scores(text, EXPECTED) is None


def test_parse_scores_without_expected_names() -> None:
    assert parse_scores('SCORES: {"a": 7}', ()) is None


# --- pipeline ------------------------------------------------------------------------------


@pytest.fixture
def seat_world() -> Iterator[dict[str, FakeAdapter]]:
    """Native providers exist but have no keys; custom seats are fakes that carry the price and
    token cap the real adapter would."""
    made: dict[str, FakeAdapter] = {}

    def make(seat) -> FakeAdapter:
        adapter = FakeAdapter(seat.seat_id, seat.model)
        adapter.price = Price(seat.price_in, seat.price_out)  # type: ignore[attr-defined]
        adapter.token_cap = seat.token_cap  # type: ignore[attr-defined]
        adapter.api_key = seat.api_key  # type: ignore[attr-defined]
        adapter.base_url = seat.base_url  # type: ignore[attr-defined]
        made[seat.seat_id] = adapter
        return adapter

    natives = {p: FakeAdapter(p.value) for p in Provider}
    app.dependency_overrides[get_adapter_factory] = lambda: lambda keys: dict(natives)
    app.dependency_overrides[get_seat_factory] = lambda: make
    yield made
    app.dependency_overrides.pop(get_adapter_factory, None)
    app.dependency_overrides.pop(get_seat_factory, None)


def seat(seat_id: str, **kw) -> dict:
    return {
        "id": seat_id,
        "base_url": "https://api.groq.com/openai/v1",
        "model": "any-model",
        "price_in": "0",
        "price_out": "0",
        "token_cap": 50_000,
        "api_key": SECRET,
        **kw,
    }


@pytest.fixture
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    async def resolve(host: str, port: int) -> list[str]:
        return {"host.docker.internal": ["172.17.0.1"], "evil.example": ["8.8.8.8"]}.get(
            host, ["8.8.8.8"]
        )

    monkeypatch.setattr(netguard, "system_resolver", resolve)


async def post_run(world: World, **overrides):
    body = {
        "brief": "Build a todo app",
        "output_folder_id": world.folder_id,
        "synth_provider": "seat-a",
        "token_cap": 100_000,
        "cost_cap_usd": "2.00",
        "seats": [seat("seat-a"), seat("seat-b")],
        **overrides,
    }
    return await world.owner.post(f"/api/workspaces/{world.workspace_id}/council/runs", json=body)


async def test_custom_seats_run_without_native_demo_seats(
    world: World, seat_world, public_dns, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        resp = await post_run(world)
        assert resp.status_code == 202, resp.text
        run = await finished(world, resp.json()["id"])
    assert run["status"] == "done", run
    assert {s["provider"] for s in run["steps"]} == {"seat-a", "seat-b"}  # natives (no key) absent
    assert run["cost_usd"] == "0.000000"  # both seats are priced 0
    assert all(s["scores"] for s in run["steps"] if s["stage"] == "critique")
    assert run["report"] == []
    # the key reached the adapter, and nowhere else
    assert seat_world["seat-a"].api_key == SECRET  # type: ignore[attr-defined]
    assert SECRET not in resp.text + json.dumps(run) + caplog.text


async def test_unparseable_critique_fails_that_seat_only(
    world: World, seat_world, public_dns
) -> None:
    """Seat b answers its critique with prose and no scores: its critique is marked failed and
    listed in the report, the others count, and the run still finishes."""

    class Garbled(FakeAdapter):
        async def complete(self, system: str, user: str, max_tokens: int) -> Completion:
            out = await super().complete(system, user, max_tokens)
            if self.calls and "Stage: critique" in system:
                return Completion(
                    "Looks fine to me, 7ish!", out.input_tokens, out.output_tokens, out.model
                )
            return out

    resp = await post_run(world, seats=[seat("seat-a"), seat("seat-b"), seat("seat-c")])
    assert resp.status_code == 202
    # replace seat-b's adapter by a garbling one before the run reaches the critique stage
    seat_world["seat-b"].__class__ = Garbled
    run = await finished(world, resp.json()["id"])
    assert run["status"] == "done", run
    critiques = {s["provider"]: s for s in run["steps"] if s["stage"] == "critique"}
    assert critiques["seat-b"]["ok"] is False
    assert critiques["seat-b"]["error"] == "critique scores could not be parsed"
    assert critiques["seat-b"]["scores"] is None
    assert critiques["seat-a"]["ok"] and critiques["seat-c"]["ok"]
    assert run["report"] == ["critique by seat-b: critique scores could not be parsed"]
    assert critiques["seat-b"]["input_tokens"] > 0  # the call was paid for, so it is counted


async def test_run_survives_every_critique_being_garbage(
    world: World, seat_world, public_dns
) -> None:
    class Garbled(FakeAdapter):
        async def complete(self, system: str, user: str, max_tokens: int) -> Completion:
            out = await super().complete(system, user, max_tokens)
            if "Stage: critique" in system:
                return Completion("{{{ SCORES: ???", out.input_tokens, out.output_tokens, out.model)
            return out

    resp = await post_run(world)
    for adapter in seat_world.values():
        adapter.__class__ = Garbled
    run = await finished(world, resp.json()["id"])
    assert run["status"] == "done", run
    assert len(run["report"]) == 2


async def test_missing_price_refuses_the_run(world: World, seat_world, public_dns) -> None:
    resp = await post_run(world, seats=[seat("seat-a", price_in=None), seat("seat-b")])
    assert resp.status_code == 422
    assert "no price" in resp.json()["detail"] and "0 for a free" in resp.json()["detail"]
    assert SECRET not in resp.text


async def test_priced_seat_is_charged_and_cost_cap_applies(
    world: World, seat_world, public_dns
) -> None:
    prices = {"seat-a": "100", "seat-b": "0"}  # $100 / Mtok
    seats = [seat(i, price_in=p, price_out=p) for i, p in prices.items()]
    resp = await post_run(world, seats=seats, cost_cap_usd="0.01")
    run = await finished(world, resp.json()["id"])
    assert run["status"] == "capped"  # the worst-case estimate of seat-a alone exceeds $0.01
    ok = await post_run(world, seats=seats, cost_cap_usd="5")
    done = await finished(world, ok.json()["id"])
    assert done["status"] == "done" and Decimal(done["cost_usd"]) > 0
    by_seat = {s["provider"]: Decimal(s["cost_usd"]) for s in done["steps"]}
    assert by_seat["seat-b"] == 0 and by_seat["seat-a"] > 0


async def test_per_seat_token_cap_sidelines_only_that_seat(
    world: World, seat_world, public_dns
) -> None:
    seats = [seat("seat-a"), seat("seat-b", token_cap=700), seat("seat-c")]
    resp = await post_run(world, seats=seats)
    assert resp.status_code == 202
    seat_world["seat-b"].tokens = (100, 450)  # draft uses 550 of 700 -> 150 left < minimum
    run = await finished(world, resp.json()["id"])
    assert run["status"] == "done", run
    steps = {(s["stage"], s["provider"]): s for s in run["steps"]}
    assert steps[("draft", "seat-b")]["ok"]
    assert steps[("critique", "seat-b")]["error"] == "seat token cap reached"
    assert steps[("critique", "seat-a")]["ok"] and steps[("critique", "seat-c")]["ok"]
    assert "critique by seat-b: seat token cap reached" in run["report"]


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"base_url": "http://localhost:11434/v1"}, "not an allowed provider"),
        ({"base_url": "http://127.0.0.1:8000/v1"}, "not an allowed provider"),
        ({"base_url": "http://169.254.169.254/latest"}, "not an allowed provider"),
        ({"base_url": "https://evil.example/v1"}, "not an allowed provider"),
        ({"base_url": "file:///etc/passwd"}, "http"),
        ({"base_url": "https://u:p@api.groq.com/v1"}, "credentials"),
        ({"base_url": None, "preset": "ollama", "api_key": None}, "private or local"),
        ({"base_url": None, "preset": "nope"}, "unknown preset"),
        ({"base_url": None, "preset": None}, "preset or enter a base URL"),
    ],
)
async def test_ssrf_policy_through_the_api(
    world: World, seat_world, public_dns, overrides: dict, fragment: str
) -> None:
    resp = await post_run(world, seats=[seat("seat-a", **overrides), seat("seat-b")])
    assert resp.status_code == 422, resp.text
    assert fragment in resp.json()["detail"], resp.text
    assert SECRET not in resp.text
    assert seat_world == {}  # no adapter was built for a refused request


async def test_local_flag_allows_ollama_and_arbitrary_hosts(
    world: World, seat_world, public_dns, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "council_allow_local_providers", True)
    seats = [
        seat("seat-a", base_url=None, preset="ollama", api_key=None),
        seat("seat-b", base_url="http://127.0.0.1:8000/v1"),
    ]
    resp = await post_run(world, seats=seats)
    assert resp.status_code == 202, resp.text
    assert seat_world["seat-a"].base_url == "http://host.docker.internal:11434/v1"  # type: ignore[attr-defined]
    await finished(world, resp.json()["id"])


async def test_preset_needing_a_key_and_id_rules(world: World, seat_world, public_dns) -> None:
    resp = await post_run(world, seats=[seat("seat-a", api_key=None), seat("seat-b")])
    assert resp.status_code == 202  # custom URL: key optional
    bad = await post_run(
        world, seats=[seat("seat-a", base_url=None, preset="groq", api_key=None), seat("seat-b")]
    )
    assert bad.status_code == 422 and "needs an API key" in bad.json()["detail"]
    dup = await post_run(world, seats=[seat("seat-a"), seat("seat-a")])
    assert dup.status_code == 422
    clash = await post_run(world, seats=[seat("openai"), seat("seat-b")])
    assert clash.status_code == 422


async def test_config_lists_presets(world: World, seat_world) -> None:
    config = (await world.owner.get("/api/council/config")).json()
    assert {"groq", "nvidia-nim", "ollama"} <= {p["id"] for p in config["presets"]}
    assert config["allow_local_providers"] is False


# --- model list / test connection ----------------------------------------------------------


def transport(routes: dict[str, tuple[int, object]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        status, payload = routes.get(request.url.path, (404, {}))
        return httpx.Response(status, json=payload)

    return httpx.MockTransport(handler)


async def lister(base: str, routes: dict, *, key: str | None = None, allow_local=False):
    async def resolve(host: str, port: int) -> list[str]:
        return ["8.8.8.8"] if not allow_local else ["172.17.0.1"]

    return await list_models(
        base,
        key,
        allow_local=allow_local,
        preset_hosts=frozenset({"api.groq.com", "host.docker.internal"}),
        resolver=resolve,
        inner=transport(routes),
    )


async def test_model_list_from_v1_models() -> None:
    routes = {"/openai/v1/models": (200, {"data": [{"id": "m-b"}, {"id": "m-a"}, {"nope": 1}]})}
    result = await lister("https://api.groq.com/openai/v1", routes, key=SECRET)
    assert (result.ok, result.models, result.source) == (True, ["m-a", "m-b"], "models")


async def test_model_list_falls_back_to_ollama_tags() -> None:
    routes = {"/api/tags": (200, {"models": [{"name": "llama:8b"}, {"name": "qwen:7b"}]})}
    result = await lister("http://host.docker.internal:11434/v1", routes, allow_local=True)
    assert (result.ok, result.models, result.source) == (
        True,
        ["llama:8b", "qwen:7b"],
        "ollama-tags",
    )


async def test_model_list_failure_means_manual_entry_and_leaks_nothing() -> None:
    routes = {"/openai/v1/models": (401, {"error": f"bad key {SECRET}"})}
    result = await lister("https://api.groq.com/openai/v1", routes, key=SECRET)
    assert not result.ok and result.models == [] and "by hand" in (result.error or "")
    assert SECRET not in repr(result) and "HTTP 401" in (result.error or "")


async def test_model_list_refuses_private_hosts() -> None:
    result = await list_models(
        "https://api.groq.com/openai/v1",
        None,
        allow_local=False,
        preset_hosts=frozenset({"api.groq.com"}),
        resolver=lambda h, p: _private(),
        inner=transport({"/openai/v1/models": (200, {"data": [{"id": "x"}]})}),
    )
    assert not result.ok  # resolved to a private address: never contacted


async def _private() -> list[str]:
    return ["10.0.0.9"]


async def test_models_endpoint_rejects_ssrf_and_wires_through(
    world: World, public_dns, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = f"/api/workspaces/{world.workspace_id}/council/models"
    bad = await world.owner.post(url, json={"base_url": "http://169.254.169.254/v1"})
    assert bad.status_code == 422

    async def fake_list(base, key, **kw):
        assert base == "https://api.groq.com/openai/v1" and key == SECRET
        return ModelList(True, ["m1"], "models")

    monkeypatch.setattr(council_router, "list_models", fake_list)
    ok = await world.owner.post(url, json={"preset": "groq", "api_key": SECRET})
    assert ok.status_code == 200 and ok.json()["models"] == ["m1"]
    assert SECRET not in ok.text
