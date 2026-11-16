import asyncio
import base64
import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient

# Test-only secrets, set before app modules import Settings.
os.environ.setdefault("APP_SECRET", "test-app-secret-0123456789abcdefghij")
os.environ.setdefault("WS_TICKET_SECRET", "test-ws-secret-0123456789abcdefghijk")
os.environ.setdefault("KEY_ENCRYPTION_KEY", base64.b64encode(b"k" * 32).decode())

# Every test shares one client address, so the suite runs with the limits effectively off;
# tests/test_ratelimit.py lowers them explicitly.
os.environ.setdefault("RATE_LIMIT_IP_MAX", "100000")
os.environ.setdefault("RATE_LIMIT_EMAIL_MAX", "100000")

os.environ["BLOB_DIR"] = tempfile.mkdtemp(prefix="coedit-test-blobs-")


# Tests run against a separate database (<name>_test) so they never touch dev/demo data.
def _base_database_url() -> str:
    # DATABASE_URL, else the POSTGRES_* parts, from the environment or the repo's .env (`make env`).
    from dotenv import dotenv_values

    from app.config import build_database_url

    env = {**dotenv_values(Path(__file__).resolve().parents[2] / ".env"), **os.environ}
    return env.get("DATABASE_URL") or build_database_url(env)


_BASE_URL = _base_database_url()
_PREFIX, _DB_NAME = _BASE_URL.rsplit("/", 1)
_TEST_DB = f"{_DB_NAME}_test"
os.environ["DATABASE_URL"] = f"{_PREFIX}/{_TEST_DB}"


async def _ensure_test_db() -> None:
    conn = await asyncpg.connect(_BASE_URL.replace("+asyncpg", ""))
    try:
        exists = await conn.fetchval("select 1 from pg_database where datname = $1", _TEST_DB)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{_TEST_DB}"')
    finally:
        await conn.close()


def _migrate() -> None:
    from alembic.config import Config

    from alembic import command

    backend = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "alembic"))
    command.upgrade(cfg, "head")


# Runs at import time, before pytest-asyncio starts its loop (alembic env uses asyncio.run).
asyncio.run(_ensure_test_db())
_migrate()

CSRF = {"X-Requested-With": "coedit"}
PASSWORD = "correct horse battery"


def new_client() -> AsyncClient:
    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=CSRF)


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    from app.ratelimit import limiter

    limiter.clear()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with new_client() as c:
        yield c


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid4().hex[:12]}@example.com"


async def register(c: AsyncClient, email: str | None = None, name: str = "Test User") -> dict:
    """Register a fresh user on client `c` (which then holds the session cookie)."""
    resp = await c.post(
        "/api/auth/register",
        json={"email": email or unique_email(), "password": PASSWORD, "display_name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class World:
    """A workspace with one client per role plus an outsider; ids of one folder and one file."""

    owner: AsyncClient
    editor: AsyncClient
    viewer: AsyncClient
    outsider: AsyncClient
    users: dict[str, dict]
    workspace_id: str
    folder_id: str
    file_id: str

    def ids(self) -> dict[str, str]:
        return {
            "workspace_id": self.workspace_id,
            "folder_id": self.folder_id,
            "file_id": self.file_id,
            "user_id": self.users["viewer"]["id"],
        }


async def make_world() -> World:
    w = World()
    w.users = {}
    for role in ("owner", "editor", "viewer", "outsider"):
        c = new_client()
        w.users[role] = await register(c, unique_email(role), role.title())
        setattr(w, role, c)
    resp = await w.owner.post("/api/workspaces", json={"name": "Team"})
    assert resp.status_code == 201, resp.text
    w.workspace_id = resp.json()["id"]
    for role in ("editor", "viewer"):
        resp = await w.owner.post(
            f"/api/workspaces/{w.workspace_id}/members",
            json={"email": w.users[role]["email"], "role": role},
        )
        assert resp.status_code == 201, resp.text
    resp = await w.owner.post(f"/api/workspaces/{w.workspace_id}/folders", json={"name": "Specs"})
    assert resp.status_code == 201, resp.text
    w.folder_id = resp.json()["id"]
    resp = await w.owner.post(
        f"/api/workspaces/{w.workspace_id}/files",
        json={"name": "Notes", "kind": "doc", "folder_id": w.folder_id},
    )
    assert resp.status_code == 201, resp.text
    w.file_id = resp.json()["id"]
    return w


@pytest.fixture
async def world() -> AsyncIterator[World]:
    w = await make_world()
    yield w
    for c in (w.owner, w.editor, w.viewer, w.outsider):
        await c.aclose()
