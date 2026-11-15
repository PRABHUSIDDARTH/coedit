"""Contract suite: the same behavioural tests run against every provider adapter. The real SDKs
make real HTTP requests to a local stub of each provider's API (no network, no real keys); the
Fake adapter takes part through its in-process interface. (anthropic 1.x+ is built on httpx2, so
respx cannot intercept it, hence the stub server.)"""

import json
import logging
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from app.config import get_settings
from app.council.adapters import build_adapters, provider_modes
from app.council.adapters.anthropic import AnthropicAdapter
from app.council.adapters.base import LLMAdapter, ProviderError
from app.council.adapters.fake import FakeAdapter
from app.council.adapters.google import GoogleAdapter
from app.council.adapters.openai import OpenAIAdapter
from app.council.adapters.openai_compat import OpenAICompatAdapter
from app.council.pipeline import safe_error
from app.council.seats import SeatConfig
from app.models import Provider

KEY = "sk-" + "ant-api03-STUBKEYSTUBKEYSTUBKEYSTUBKEY"  # fake-secret-ok


class Stub:
    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.responses: list[tuple[int, dict]] = []
        self.default: dict | None = None
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                stub.requests.append(
                    {
                        "path": self.path,
                        "headers": {k.lower(): v for k, v in self.headers.items()},
                        "body": body,
                    }
                )
                status, payload = stub.responses.pop(0) if stub.responses else (200, stub.default)
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@pytest.fixture
def stub() -> Iterator[Stub]:
    s = Stub()
    yield s
    s.server.shutdown()


@dataclass(frozen=True)
class Spec:
    """Everything provider-specific the contract tests need."""

    name: str
    model: str
    make: Callable[[str], LLMAdapter]  # base url -> adapter
    ok: dict  # reply for "Hello world", input 20 tokens, output 7 tokens
    error: Callable[[int], dict]  # error body that quotes the key
    refusal: dict
    no_usage: dict
    request: Callable[[dict], dict[str, Any]]  # stub request -> {model, system, user, max_tokens}
    path: str
    key_header: str


ANTHROPIC = Spec(
    name="anthropic",
    model="claude-sonnet-5-5",
    make=lambda url: AnthropicAdapter(KEY, "claude-sonnet-5-5", base_url=url),
    ok={
        "id": "msg_01",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": [
            {"type": "thinking", "thinking": "", "signature": "sig"},
            {"type": "text", "text": "Hello "},
            {"type": "text", "text": "world"},
        ],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        # cached input still counts: 12 + 3 + 5
        "usage": {
            "input_tokens": 12,
            "cache_creation_input_tokens": 3,
            "cache_read_input_tokens": 5,
            "output_tokens": 7,
        },
    },
    error=lambda status: {
        "type": "error",
        "error": {"type": "x", "message": f"bad key {KEY} ({status})"},
    },
    refusal={
        "id": "m",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": [],
        "stop_reason": "refusal",
        "stop_sequence": None,
        "usage": {"input_tokens": 1, "output_tokens": 0},
    },
    no_usage={},  # the SDK requires usage; covered by SDK validation, see test below
    request=lambda r: {
        "model": r["body"]["model"],
        "system": r["body"]["system"],
        "user": r["body"]["messages"][0]["content"],
        "max_tokens": r["body"]["max_tokens"],
    },
    path="/v1/messages",
    key_header="authorization",
)

_CHAT = {
    "id": "chatcmpl-1",
    "object": "chat.completion",
    "created": 1,
    "model": "gpt-6.1-terra",
    "choices": [
        {
            "index": 0,
            "finish_reason": "stop",
            "message": {"role": "assistant", "content": "Hello world", "refusal": None},
        }
    ],
    "usage": {"prompt_tokens": 20, "completion_tokens": 7, "total_tokens": 27},
}
OPENAI = Spec(
    name="openai",
    model="gpt-6.1-terra",
    make=lambda url: OpenAIAdapter(KEY, "gpt-6.1-terra", base_url=url + "/v1"),
    ok=_CHAT,
    error=lambda status: {
        "error": {"message": f"Incorrect API key provided: {KEY}", "type": "x", "code": status}
    },
    refusal={
        **_CHAT,
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": None, "refusal": "I can't."},
            }
        ],
    },
    no_usage={k: v for k, v in _CHAT.items() if k != "usage"},
    request=lambda r: {
        "model": r["body"]["model"],
        "system": r["body"]["messages"][0]["content"],
        "user": r["body"]["messages"][1]["content"],
        "max_tokens": r["body"]["max_completion_tokens"],
    },
    path="/v1/chat/completions",
    key_header="authorization",
)

_GEMINI = {
    "candidates": [
        {"content": {"role": "model", "parts": [{"text": "Hello world"}]}, "finishReason": "STOP"}
    ],
    # thinking tokens are billed as output: 5 + 2
    "usageMetadata": {
        "promptTokenCount": 20,
        "candidatesTokenCount": 5,
        "thoughtsTokenCount": 2,
        "totalTokenCount": 27,
    },
    "modelVersion": "gemini-3.8-flash",
}
GOOGLE = Spec(
    name="google",
    model="gemini-3.8-flash",
    make=lambda url: GoogleAdapter(KEY, "gemini-3.8-flash", base_url=url),
    ok=_GEMINI,
    error=lambda status: {
        "error": {"code": status, "message": f"API key not valid: {KEY}", "status": "X"}
    },
    refusal={
        "promptFeedback": {"blockReason": "SAFETY"},
        "usageMetadata": {"promptTokenCount": 3, "totalTokenCount": 3},
    },
    no_usage={k: v for k, v in _GEMINI.items() if k != "usageMetadata"},
    request=lambda r: {
        "model": r["path"].split("/models/")[1].split(":")[0],
        "system": r["body"]["systemInstruction"]["parts"][0]["text"],
        "user": r["body"]["contents"][0]["parts"][0]["text"],
        "max_tokens": r["body"]["generationConfig"]["maxOutputTokens"],
    },
    path=":generateContent",
    key_header="x-goog-api-key",
)


def _compat(
    name: str, model: str, ok: dict, refusal: dict, no_usage: dict, error_shape: str
) -> Spec:
    """OpenAI-compatible seat behind the guarded client (the stub is on loopback, so the local
    flag is on here; the guard itself is covered in test_netguard.py)."""
    return Spec(
        name=name,
        model=model,
        make=lambda url: OpenAICompatAdapter(
            SeatConfig(name, url + "/v1", model, Decimal(0), Decimal(0), 10_000, KEY),
            allow_local=True,
        ),
        ok=ok,
        error=lambda status: {"error": {"message": error_shape.format(key=KEY, status=status)}},
        refusal=refusal,
        no_usage=no_usage,
        request=lambda r: {
            "model": r["body"]["model"],
            "system": r["body"]["messages"][0]["content"],
            "user": r["body"]["messages"][1]["content"],
            "max_tokens": r["body"]["max_tokens"],
        },
        path="/v1/chat/completions",
        key_header="authorization",
    )


def _choice(message: dict, finish: str = "stop") -> list[dict]:
    return [{"index": 0, "finish_reason": finish, "message": {"role": "assistant", **message}}]


# Reply shapes as the three servers send them (extra vendor fields included on purpose).
_GROQ_OK = {
    "id": "chatcmpl-g1",
    "object": "chat.completion",
    "created": 1,
    "model": "groq-model-a",
    "system_fingerprint": "fp_1",
    "choices": _choice({"content": "Hello world"}),
    "usage": {"queue_time": 0.1, "prompt_tokens": 20, "completion_tokens": 7, "total_tokens": 27},
    "x_groq": {"id": "req_1"},
}
_NIM_OK = {
    "id": "cmpl-n1",
    "object": "chat.completion",
    "created": 1,
    "model": "nim-model-b",
    "choices": _choice({"content": "Hello world", "tool_calls": []}),
    "usage": {
        "prompt_tokens": 20,
        "completion_tokens": 7,
        "total_tokens": 27,
        "prompt_tokens_details": None,
    },
}
_OLLAMA_OK = {
    "id": "chatcmpl-123",
    "object": "chat.completion",
    "created": 1,
    "model": "llama-local:8b",
    "system_fingerprint": "fp_ollama",
    "choices": _choice({"content": "Hello world"}),
    "usage": {"prompt_tokens": 20, "completion_tokens": 7, "total_tokens": 27},
}
GROQ = _compat(
    "groq",
    "groq-model-a",
    _GROQ_OK,
    {**_GROQ_OK, "choices": _choice({"content": None, "refusal": "I can't."})},
    {k: v for k, v in _GROQ_OK.items() if k != "usage"},
    "Invalid API Key {key} ({status})",
)
NIM = _compat(
    "nvidia-nim",
    "nim-model-b",
    _NIM_OK,
    {**_NIM_OK, "choices": _choice({"content": ""}, "content_filter")},
    {k: v for k, v in _NIM_OK.items() if k != "usage"},
    "Authorization failed for {key} ({status})",
)
OLLAMA = _compat(
    "ollama",
    "llama-local:8b",
    _OLLAMA_OK,
    {**_OLLAMA_OK, "choices": _choice({"content": ""}, "content_filter")},
    {k: v for k, v in _OLLAMA_OK.items() if k != "usage"},
    "model error {status} {key}",
)

SPECS = [ANTHROPIC, OPENAI, GOOGLE, GROQ, NIM, OLLAMA]
ids = [s.name for s in SPECS]


@pytest.mark.parametrize("spec", SPECS, ids=ids)
async def test_request_shape_and_usage(stub: Stub, spec: Spec) -> None:
    stub.default = spec.ok
    result = await spec.make(stub.url).complete("SYSTEM RULES", "user text", 321)
    assert result.text == "Hello world" and result.model == spec.model
    assert (result.input_tokens, result.output_tokens) == (20, 7)

    (req,) = stub.requests
    assert spec.path in req["path"]
    assert KEY in req["headers"].get(spec.key_header, "")  # sent as the provider expects
    assert spec.request(req) == {
        "model": spec.model,
        "system": "SYSTEM RULES",
        "user": "user text",
        "max_tokens": 321,
    }
    assert "tools" not in req["body"] and "temperature" not in req["body"]


@pytest.mark.parametrize("spec", SPECS, ids=ids)
@pytest.mark.parametrize(("status", "attempts"), [(400, 1), (401, 1), (429, 2), (503, 2)])
async def test_http_errors_are_status_only_and_retried_once(
    stub: Stub, spec: Spec, status: int, attempts: int, caplog: pytest.LogCaptureFixture
) -> None:
    stub.responses = [(status, spec.error(status))] * 3
    with caplog.at_level(logging.DEBUG), pytest.raises(ProviderError) as caught:
        await spec.make(stub.url).complete("s", "u", 10)
    exc = caught.value
    assert exc.status == status and exc.provider == spec.name
    assert KEY not in str(exc) and KEY not in repr(exc) and KEY not in caplog.text
    assert exc.__cause__ is None and exc.__suppress_context__  # no chained SDK error
    assert safe_error(exc) == f"provider returned HTTP {status}"
    assert len(stub.requests) == attempts  # transient errors: exactly one retry; others: none


@pytest.mark.parametrize("spec", SPECS, ids=ids)
async def test_transient_error_then_success(stub: Stub, spec: Spec) -> None:
    stub.responses = [(429, spec.error(429)), (200, spec.ok)]
    result = await spec.make(stub.url).complete("s", "u", 10)
    assert result.text == "Hello world" and len(stub.requests) == 2


@pytest.mark.parametrize("spec", SPECS, ids=ids)
async def test_refusal_is_a_failure(stub: Stub, spec: Spec) -> None:
    stub.responses = [(200, spec.refusal)]
    with pytest.raises(ProviderError):
        await spec.make(stub.url).complete("s", "u", 10)


@pytest.mark.parametrize(
    "spec", [OPENAI, GOOGLE, GROQ, NIM, OLLAMA], ids=["openai", "google", "groq", "nim", "ollama"]
)
async def test_missing_usage_fails_closed(stub: Stub, spec: Spec) -> None:
    """A reply that cannot be priced must not be treated as free."""
    stub.responses = [(200, spec.no_usage)]
    with pytest.raises(ProviderError):
        await spec.make(stub.url).complete("s", "u", 10)


@pytest.mark.parametrize("spec", SPECS, ids=ids)
async def test_unreachable_host(spec: Spec) -> None:
    with pytest.raises(ProviderError) as caught:
        await spec.make("http://127.0.0.1:9").complete("s", "u", 10)
    assert caught.value.status is None and safe_error(caught.value) == "provider call failed"
    assert KEY not in repr(caught.value) and caught.value.__cause__ is None


async def test_fake_adapter_honours_the_same_contract() -> None:
    fake = FakeAdapter("openai")
    result = await fake.complete("SYSTEM", "user text", 321)
    assert result.model == fake.model and result.input_tokens > 0
    assert 0 < result.output_tokens <= 321
    fake.error = ProviderError("openai", 429)
    with pytest.raises(ProviderError) as caught:
        await fake.complete("s", "u", 10)
    assert safe_error(caught.value) == "provider returned HTTP 429"


def test_factory_modes(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    assert build_adapters({}) == {}
    assert set(provider_modes(set()).values()) == {"missing"}

    only_openai = build_adapters({Provider.openai: "sk-" + "openai-xxxxxxxx"})  # fake-secret-ok
    assert isinstance(only_openai[Provider.openai], OpenAIAdapter)
    assert only_openai[Provider.openai].model == settings.council_model_openai
    assert isinstance(only_openai[Provider.anthropic], FakeAdapter)  # no key -> demo seat

    adapters = build_adapters(
        {
            Provider.anthropic: KEY,
            Provider.openai: "sk-x",
            Provider.google: "AI" + "zaSyXXXXXXXXXXXXXX",
        }
    )
    assert isinstance(adapters[Provider.anthropic], AnthropicAdapter)
    assert isinstance(adapters[Provider.openai], OpenAIAdapter)
    assert isinstance(adapters[Provider.google], GoogleAdapter)
    assert adapters[Provider.google].model == settings.council_model_google
    assert provider_modes({Provider.anthropic, Provider.google}) == {
        Provider.anthropic: "live",
        Provider.openai: "demo",
        Provider.google: "live",
    }

    monkeypatch.setattr(settings, "council_fake", True)
    assert all(isinstance(a, FakeAdapter) for a in build_adapters({}).values())
    assert len(build_adapters({})) == 3


def test_empty_model_setting_falls_back_to_default() -> None:
    from app.config import Settings

    s = Settings(council_model_openai="", council_model_google="  ")
    assert (
        s.council_model_openai == "gpt-6.1-terra" and s.council_model_google == "gemini-3.8-flash"
    )
