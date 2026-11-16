import pytest
from pydantic import ValidationError

from app.config import Settings, build_database_url

SECRETS = {
    "app_secret": "a" * 32,
    "ws_ticket_secret": "b" * 32,
    "key_encryption_key": "c" * 44,
}
# Built from pieces so no password-looking literal sits in this file.
PW = "pw" + "-with/special:chars@" + "x"


def _clean(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "DATABASE_URL",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "DB_PORT",
        "POSTGRES_DB",
    ):
        monkeypatch.delenv(name, raising=False)


def test_url_is_built_from_parts_and_quotes_the_password() -> None:
    url = build_database_url(
        {
            "POSTGRES_USER": "u",
            "POSTGRES_PASSWORD": PW,
            "POSTGRES_HOST": "db",
            "POSTGRES_PORT": "5432",
            "POSTGRES_DB": "d",
        }
    )
    assert url == "postgresql+asyncpg://u:pw-with%2Fspecial%3Achars%40x@db:5432/d"


def test_defaults_except_the_password() -> None:
    url = build_database_url({"POSTGRES_PASSWORD": "x"})
    assert url.endswith("@localhost:5433/coedit") and url.startswith("postgresql+asyncpg://coedit:")
    assert build_database_url({"POSTGRES_PASSWORD": "x", "DB_PORT": "6000"}).endswith(
        ":6000/coedit"
    )


def test_missing_password_fails_with_a_clear_message() -> None:
    for env in ({}, {"POSTGRES_PASSWORD": ""}, {"POSTGRES_USER": "u"}):
        with pytest.raises(ValueError, match="POSTGRES_PASSWORD is not set"):
            build_database_url(env)


def test_settings_build_url_from_env_parts(monkeypatch: pytest.MonkeyPatch) -> None:
    _clean(monkeypatch)
    monkeypatch.setenv("POSTGRES_PASSWORD", "x")
    monkeypatch.setenv("DB_PORT", "6001")
    s = Settings(_env_file=None, **SECRETS)
    assert s.database_url == "postgresql+asyncpg://coedit:x@localhost:6001/coedit"


def test_settings_explicit_database_url_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    _clean(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:1/d")
    assert Settings(_env_file=None, **SECRETS).database_url == "postgresql+asyncpg://u:p@h:1/d"


def test_settings_without_any_password_refuse_to_start(monkeypatch: pytest.MonkeyPatch) -> None:
    _clean(monkeypatch)
    with pytest.raises(ValidationError, match="POSTGRES_PASSWORD is not set"):
        Settings(_env_file=None, **SECRETS)
