import os
import uuid

import jwt
from sqlalchemy import update

from app.db import SessionLocal
from app.models import File, FileKind
from tests.conftest import World, new_client


def decode(ticket: str) -> dict:
    return jwt.decode(
        ticket, os.environ["WS_TICKET_SECRET"], algorithms=["HS256"], audience="coedit-sync"
    )


async def test_ticket_claims_per_role(world: World) -> None:
    for role, read_only in (("owner", False), ("editor", False), ("viewer", True)):
        resp = await getattr(world, role).post(f"/api/files/{world.file_id}/ws-ticket")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["read_only"] is read_only
        assert body["url"] == "/sync"
        claims = decode(body["ticket"])
        assert claims["sub"] == world.users[role]["id"]
        assert claims["file_id"] == world.file_id
        assert claims["role"] == role
        assert claims["name"] == role.title()
        assert claims["color"].startswith("#") and len(claims["color"]) == 7
        assert claims["exp"] - claims["iat"] == 60
        assert (body["name"], body["color"]) == (claims["name"], claims["color"])


async def test_ticket_is_not_a_session_and_session_is_not_a_ticket(world: World) -> None:
    ticket = (await world.owner.post(f"/api/files/{world.file_id}/ws-ticket")).json()["ticket"]
    async with new_client() as c:
        c.cookies.set("coedit_session", ticket)
        assert (await c.get("/api/auth/me")).status_code == 401


async def test_ticket_requires_membership(world: World) -> None:
    url = f"/api/files/{world.file_id}/ws-ticket"
    assert (await world.outsider.post(url)).status_code == 404
    async with new_client() as anon:
        assert (await anon.post(url)).status_code == 401
    assert (await world.owner.post(f"/api/files/{uuid.uuid4()}/ws-ticket")).status_code == 404


async def test_removed_member_gets_no_ticket(world: World) -> None:
    url = f"/api/files/{world.file_id}/ws-ticket"
    assert (await world.editor.post(url)).status_code == 200
    members = f"/api/workspaces/{world.workspace_id}/members"
    assert (await world.owner.delete(f"{members}/{world.users['editor']['id']}")).status_code == 204
    assert (await world.editor.post(url)).status_code == 404


async def test_no_ticket_for_deleted_or_blob_files(world: World) -> None:
    ws = f"/api/workspaces/{world.workspace_id}"
    sheet = (await world.owner.post(f"{ws}/files", json={"name": "S", "kind": "sheet"})).json()
    assert (await world.owner.post(f"/api/files/{sheet['id']}/ws-ticket")).status_code == 200

    async with SessionLocal() as db:  # blob files only exist via upload (slice 6)
        await db.execute(
            update(File).where(File.id == uuid.UUID(sheet["id"])).values(kind=FileKind.blob)
        )
        await db.commit()
    assert (await world.owner.post(f"/api/files/{sheet['id']}/ws-ticket")).status_code == 409

    assert (await world.owner.delete(f"/api/files/{world.file_id}")).status_code == 204
    assert (await world.owner.post(f"/api/files/{world.file_id}/ws-ticket")).status_code == 404
