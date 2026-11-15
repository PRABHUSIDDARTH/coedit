from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+asyncpg://coedit:coedit@localhost:5433/coedit"
    # Required, no defaults: the app must not start with guessable secrets.
    app_secret: str = Field(min_length=32)
    ws_ticket_secret: str = Field(min_length=32)
    key_encryption_key: str = Field(min_length=40)  # base64 of 32 bytes
    web_origin: str = "http://localhost:5173"
    # Where the browser reaches the sync server; a path is resolved against the page origin
    # (the web container proxies /sync to the sidecar).
    sync_public_url: str = "/sync"
    blob_dir: str = "./data/blobs"
    max_upload_bytes: int = 50 * 1024 * 1024
    # Where new blob versions are written. "local" (default) is the volume above; "nexuscloud"
    # uses a NexusCloud service token to get presigned URLs (see docs/ARCHITECTURE.md).
    storage_backend: Literal["local", "nexuscloud"] = "local"
    nexuscloud_base_url: str = ""
    nexuscloud_token: SecretStr = SecretStr("")
    # Lets the NexusCloud API and the presigned URLs it returns be plain http / private or
    # loopback addresses (a compose network, a stub). MUST stay off in any hosted deployment.
    nexuscloud_allow_private: bool = False

    council_fake: bool = False
    council_model_anthropic: str = "claude-sonnet-5-5"
    anthropic_base_url: str | None = None  # tests point this at a local stub
    openai_base_url: str | None = None
    google_base_url: str | None = None
    council_model_openai: str = "gpt-6.1-terra"
    council_model_google: str = "gemini-3.8-flash"
    # Optional JSON {"model-id": [input_usd_per_mtok, output_usd_per_mtok]} added to prices.py
    council_prices: str = ""
    # Extra OpenAI-compatible presets: JSON {"id": {"label": "...", "base_url": "https://...",
    # "needs_key": true}}. Their hosts are allowed like the built-in ones (Groq, NVIDIA NIM, Ollama).
    council_provider_presets: str = ""
    # Lets seats point at private / loopback / link-local addresses and at hosts that are not a
    # preset (Ollama on this machine, a LAN vLLM). MUST stay off in any hosted deployment:
    # with it on, a user can make the API server call internal services.
    council_allow_local_providers: bool = False

    @model_validator(mode="after")
    def _nexuscloud_needs_settings(self) -> "Settings":
        if self.storage_backend == "nexuscloud" and not (
            self.nexuscloud_base_url.strip() and self.nexuscloud_token.get_secret_value()
        ):
            raise ValueError(
                "STORAGE_BACKEND=nexuscloud needs NEXUSCLOUD_BASE_URL and NEXUSCLOUD_TOKEN"
            )
        return self

    @field_validator(
        "council_model_anthropic", "council_model_openai", "council_model_google", mode="before"
    )
    @classmethod
    def _empty_means_default(cls, value: object, info) -> object:
        """`COUNCIL_MODEL_X=` (as in an old .env copied from the template) keeps the default."""
        if isinstance(value, str) and not value.strip():
            return cls.model_fields[info.field_name].default
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
