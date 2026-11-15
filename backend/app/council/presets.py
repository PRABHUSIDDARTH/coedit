"""OpenAI-compatible provider presets. Only endpoints are listed here: model ids and prices are
never hardcoded for these providers, the user picks the model and sets the price per seat."""

import json
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.config import get_settings


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    base_url: str
    needs_key: bool = True

    @property
    def host(self) -> str:
        return (urlsplit(self.base_url).hostname or "").lower()


BUILTIN = (
    Preset("groq", "Groq", "https://api.groq.com/openai/v1"),
    Preset("nvidia-nim", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1"),
    # From inside the api container the host machine is host.docker.internal (compose maps it
    # with extra_hosts). It resolves to a private address, so using it needs the local flag.
    Preset("ollama", "Ollama (local)", "http://host.docker.internal:11434/v1", needs_key=False),
)


def get_presets() -> dict[str, Preset]:
    presets = {p.id: p for p in BUILTIN}
    raw = get_settings().council_provider_presets
    if raw.strip():
        for preset_id, cfg in json.loads(raw).items():
            presets[preset_id] = Preset(
                preset_id,
                str(cfg.get("label", preset_id)),
                str(cfg["base_url"]).rstrip("/"),
                bool(cfg.get("needs_key", True)),
            )
    return presets


def preset_hosts() -> frozenset[str]:
    return frozenset(p.host for p in get_presets().values())
