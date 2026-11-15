from collections.abc import Callable

from app.config import get_settings
from app.council.adapters.anthropic import AnthropicAdapter
from app.council.adapters.base import LLMAdapter
from app.council.adapters.fake import FakeAdapter
from app.council.adapters.google import GoogleAdapter
from app.council.adapters.openai import OpenAIAdapter
from app.models import Provider

#: decrypted keys by provider -> the adapters a run may use
AdapterFactory = Callable[[dict[Provider, str]], dict[Provider, LLMAdapter]]

# Providers with a real adapter. A provider without a key runs as FakeAdapter ("demo") as long
# as at least one live key is present.
LIVE_PROVIDERS = (Provider.anthropic, Provider.openai, Provider.google)


def provider_modes(have_keys: set[Provider]) -> dict[Provider, str]:
    """How each provider would take part in a run: "live" (own key, real adapter), "demo"
    (canned text, no key) or "missing" (no keys at all, so the run cannot start)."""
    if get_settings().council_fake:
        return dict.fromkeys(Provider, "demo")
    if not have_keys & set(LIVE_PROVIDERS):
        return dict.fromkeys(Provider, "missing")
    return {p: "live" if p in have_keys and p in LIVE_PROVIDERS else "demo" for p in Provider}


def build_adapters(keys: dict[Provider, str]) -> dict[Provider, LLMAdapter]:
    settings = get_settings()
    live = {
        Provider.anthropic: (
            AnthropicAdapter,
            settings.council_model_anthropic,
            settings.anthropic_base_url,
        ),
        Provider.openai: (OpenAIAdapter, settings.council_model_openai, settings.openai_base_url),
        Provider.google: (GoogleAdapter, settings.council_model_google, settings.google_base_url),
    }
    adapters: dict[Provider, LLMAdapter] = {}
    for provider, mode in provider_modes(set(keys)).items():
        if mode == "demo":
            adapters[provider] = FakeAdapter(provider.value)
        elif mode == "live":
            cls, model, base_url = live[provider]
            adapters[provider] = cls(keys[provider], model, base_url)
    return adapters


def get_adapter_factory() -> AdapterFactory:
    """FastAPI dependency; tests override it to inject scripted fakes."""
    return build_adapters
