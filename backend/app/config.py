import ipaddress
from collections.abc import Mapping
from functools import lru_cache
from typing import Literal
from urllib.parse import quote

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def build_database_url(env: Mapping[str, str | None]) -> str:
    """asyncpg URL from POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT (or DB_PORT) /
    POSTGRES_DB. There is deliberately no password default."""

    def get(*names: str, default: str = "") -> str:
        for name in names:
            if env.get(name):
                return str(env[name])
        return default

    password = get("POSTGRES_PASSWORD")
    if not password:
        raise ValueError(
            "POSTGRES_PASSWORD is not set (and DATABASE_URL is not set). Run `make env` to create "
            ".env with generated secrets, or set DATABASE_URL."
        )
    user = quote(get("POSTGRES_USER", default="coedit"), safe="")
    host = get("POSTGRES_HOST", default="localhost")
    port = get("POSTGRES_PORT", "DB_PORT", default="5433")
    db = get("POSTGRES_DB", default="coedit")
    return f"postgresql+asyncpg://{user}:{quote(password, safe='')}@{host}:{port}/{db}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # Full URL, or leave empty and set the POSTGRES_* parts below (no password default).
    database_url: str = ""
    postgres_user: str = "coedit"
    postgres_password: SecretStr = SecretStr("")
    postgres_host: str = "localhost"
    postgres_port: int = Field(
        default=5433, validation_alias=AliasChoices("POSTGRES_PORT", "DB_PORT")
    )
    postgres_db: str = "coedit"
    # Required, no defaults: the app must not start with guessable secrets.
    app_secret: str = Field(min_length=32)
    ws_ticket_secret: str = Field(min_length=32)
    key_encryption_key: str = Field(min_length=40)  # base64 of 32 bytes
    web_origin: str = "http://localhost:5173"
    # Where the browser reaches the sync server; a path is resolved against the page origin
    # (the web container proxies /sync to the sidecar).
    sync_public_url: str = "/sync"
    # Session JWT and cookie lifetime. Logout only clears the cookie; a copied token stays valid
    # until it expires (no server-side revocation list).
    session_ttl_hours: int = Field(default=24, ge=1)
    # Login/register rate limits (in-memory, per process; 0 disables a limit). See app/ratelimit.py.
    rate_limit_window_seconds: int = Field(default=900, ge=1)
    rate_limit_ip_max: int = Field(default=30, ge=0)
    rate_limit_email_max: int = Field(default=8, ge=0)
    # Comma-separated CIDRs of proxies whose X-Forwarded-For may be believed (the last entry is the
    # client). Empty = never trust the header. See app/ratelimit.py for what this does and does not protect.
    rate_limit_trusted_proxies: str = ""
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
    def _database_url_from_parts(self) -> "Settings":
        if not self.database_url.strip():
            self.database_url = build_database_url(
                {
                    "POSTGRES_USER": self.postgres_user,
                    "POSTGRES_PASSWORD": self.postgres_password.get_secret_value(),
                    "POSTGRES_HOST": self.postgres_host,
                    "POSTGRES_PORT": str(self.postgres_port),
                    "POSTGRES_DB": self.postgres_db,
                }
            )
        return self

    @field_validator("rate_limit_trusted_proxies")
    @classmethod
    def _trusted_proxies_are_cidrs(cls, value: str) -> str:
        for part in (p.strip() for p in value.split(",") if p.strip()):
            ipaddress.ip_network(part, strict=False)  # ValueError -> startup fails loudly
        return value

    @property
    def trusted_proxy_networks(self) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
        return [
            ipaddress.ip_network(p.strip(), strict=False)
            for p in self.rate_limit_trusted_proxies.split(",")
            if p.strip()
        ]

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
