"""List the models an OpenAI-compatible endpoint offers (also serves as "Test connection").

GET {base}/models first; if that is unavailable and the base ends in /v1, Ollama's own
GET {root}/api/tags. Goes through the SSRF-guarded client; provider response bodies are never
passed on (only model ids), and failures are reduced to a generic reason."""

from dataclasses import dataclass

import httpx

from app.council import netguard

MAX_BYTES = 2_000_000
MAX_MODELS = 500


@dataclass(frozen=True)
class ModelList:
    ok: bool
    models: list[str]
    source: str  # "models" | "ollama-tags" | "none"
    error: str | None = None


def _ids(payload: object, source: str) -> list[str]:
    if not isinstance(payload, dict):
        return []
    rows = payload.get("data" if source == "models" else "models")
    out: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        value = row.get("id" if source == "models" else "name") if isinstance(row, dict) else None
        if isinstance(value, str) and 0 < len(value) <= 200:
            out.append(value)
    return sorted(set(out))[:MAX_MODELS]


async def list_models(
    base_url: str,
    api_key: str | None,
    *,
    allow_local: bool,
    preset_hosts: frozenset[str],
    resolver: netguard.Resolver | None = None,
    inner: httpx.AsyncBaseTransport | None = None,
) -> ModelList:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    attempts = [(f"{base_url}/models", "models")]
    if base_url.endswith("/v1"):
        attempts.append((f"{base_url[: -len('/v1')]}/api/tags", "ollama-tags"))
    reason: str | None = None  # why the primary /models attempt failed (the fallback's is noise)
    async with netguard.guarded_client(
        allow_local=allow_local,
        preset_hosts=preset_hosts,
        resolver=resolver or netguard.system_resolver,
        inner=inner,
        timeout=10.0,
    ) as client:
        for url, source in attempts:
            try:
                response = await client.get(url, headers=headers)
            except httpx.HTTPError:  # includes the SSRF guard's refusals
                reason = reason or "The provider could not be reached."
                continue
            if response.status_code != 200 or len(response.content) > MAX_BYTES:
                reason = reason or f"The provider answered HTTP {response.status_code}."
                continue
            try:
                models = _ids(response.json(), source)
            except ValueError:
                models = []
            if models:
                return ModelList(True, models, source)
            reason = reason or "The provider returned no model list."
    return ModelList(False, [], "none", f"{reason} Enter the model id by hand.")
