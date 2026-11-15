"""Gate for the AGENTS.md rule: every mutating resource route rejects viewers (403) and
non-members (404). `test_every_mutating_route_is_listed` fails when a new route is added
without a row here, so the table cannot silently fall behind."""

import pytest

from app.main import app
from tests.conftest import World, new_client

_UPLOAD = {"_files": {"file": ("a.txt", b"a", "text/plain")}}

# (method, path template, body, minimum role that may call it). A body with "_files" is sent
# as multipart (remaining keys are form fields; values are formatted with the world's ids).
MUTATING: list[tuple[str, str, dict | None, str]] = [
    (
        "POST",
        "/api/workspaces/{workspace_id}/members",
        {"email": "x@example.com", "role": "viewer"},
        "owner",
    ),
    ("PATCH", "/api/workspaces/{workspace_id}/members/{user_id}", {"role": "editor"}, "owner"),
    ("DELETE", "/api/workspaces/{workspace_id}/members/{user_id}", None, "owner"),
    ("POST", "/api/workspaces/{workspace_id}/folders", {"name": "New"}, "editor"),
    ("PATCH", "/api/folders/{folder_id}", {"name": "Renamed"}, "editor"),
    ("DELETE", "/api/folders/{folder_id}", None, "editor"),
    ("POST", "/api/workspaces/{workspace_id}/files", {"name": "New", "kind": "doc"}, "editor"),
    ("PATCH", "/api/files/{file_id}", {"name": "Renamed"}, "editor"),
    ("DELETE", "/api/files/{file_id}", None, "editor"),
    ("POST", "/api/files/upload", {"workspace_id": "{workspace_id}", **_UPLOAD}, "editor"),
    ("POST", "/api/files/{file_id}/versions", _UPLOAD, "editor"),
    (
        "POST",
        "/api/workspaces/{workspace_id}/council/runs",
        {"brief": "x", "synth_provider": "anthropic", "token_cap": 1000, "cost_cap_usd": "1"},
        "owner",
    ),
    ("POST", "/api/workspaces/{workspace_id}/council/models", {"preset": "groq"}, "owner"),
]


def _kwargs(body: dict | None, ids: dict[str, str]) -> dict:
    if body is None or "_files" not in body:
        return {"json": body}
    data = {k: v.format(**ids) for k, v in body.items() if k != "_files"}
    return {"files": body["_files"], "data": data}


# Mutating routes with no workspace resource behind them, and why they are exempt.
EXEMPT = {
    ("POST", "/api/auth/register"),  # public
    ("POST", "/api/auth/login"),  # public
    ("POST", "/api/auth/logout"),  # own session only
    ("POST", "/api/workspaces"),  # creates a new workspace owned by the caller
    # Read-level: viewers may open files (read-only ticket). Covered by tests/test_tickets.py.
    ("POST", "/api/files/{file_id}/ws-ticket"),
    # The caller's own provider keys; no workspace involved. Covered by tests/test_council.py.
    ("PUT", "/api/settings/keys/{provider}"),
    ("DELETE", "/api/settings/keys/{provider}"),
}

READS = [
    "/api/workspaces/{workspace_id}",
    "/api/workspaces/{workspace_id}/members",
    "/api/workspaces/{workspace_id}/tree",
]

_IDS = [f"{m} {p}" for m, p, _, _ in MUTATING]


def test_every_mutating_route_is_listed() -> None:
    actual = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
    }
    assert len(actual) > len(EXEMPT)  # the introspection itself still works
    listed = {(m, p) for m, p, _, _ in MUTATING}
    assert actual - EXEMPT == listed


@pytest.mark.parametrize(("method", "path", "body", "min_role"), MUTATING, ids=_IDS)
async def test_viewer_403_nonmember_404(
    world: World, method: str, path: str, body: dict, min_role: str
) -> None:
    url = path.format(**world.ids())
    body = _kwargs(body, world.ids())
    viewer = await world.viewer.request(method, url, **body)
    assert viewer.status_code == 403, viewer.text
    outsider = await world.outsider.request(method, url, **body)
    assert outsider.status_code == 404, outsider.text
    if min_role == "owner":
        editor = await world.editor.request(method, url, **body)
        assert editor.status_code == 403, editor.text
    async with new_client() as anon:
        assert (await anon.request(method, url, **body)).status_code == 401

    # Nothing was changed by the rejected calls.
    tree = (await world.owner.get(f"/api/workspaces/{world.workspace_id}/tree")).json()
    assert [f["name"] for f in tree["folders"]] == ["Specs"]
    assert [f["name"] for f in tree["files"]] == ["Notes"]
    members = (await world.owner.get(f"/api/workspaces/{world.workspace_id}/members")).json()
    assert {m["role"] for m in members} == {"owner", "editor", "viewer"}
    assert len(members) == 3


@pytest.mark.parametrize("path", READS)
async def test_reads_viewer_ok_nonmember_404(world: World, path: str) -> None:
    url = path.format(**world.ids())
    assert (await world.viewer.get(url)).status_code == 200
    assert (await world.outsider.get(url)).status_code == 404
    async with new_client() as anon:
        assert (await anon.get(url)).status_code == 401


async def test_unknown_ids_are_404(world: World) -> None:
    missing = "00000000-0000-4000-8000-000000000000"
    assert (await world.owner.get(f"/api/workspaces/{missing}/tree")).status_code == 404
    assert (
        await world.owner.patch(f"/api/folders/{missing}", json={"name": "x"})
    ).status_code == 404
    assert (await world.owner.delete(f"/api/files/{missing}")).status_code == 404
