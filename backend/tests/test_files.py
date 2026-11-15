import hashlib
import uuid

import pytest

from app.config import get_settings
from app.routers.blobs import display_name
from tests.conftest import World, new_client

V1 = b"first version\n" * 100
V2 = b"second version, different bytes\n"


async def upload(client, world: World, content: bytes = V1, name: str = "report.txt", **form):
    return await client.post(
        "/api/files/upload",
        data={"workspace_id": world.workspace_id, **form},
        files={"file": (name, content, "text/plain")},
    )


async def add_version(client, file_id: str, content: bytes = V2, name: str = "report-v2.txt"):
    return await client.post(
        f"/api/files/{file_id}/versions", files={"file": (name, content, "text/plain")}
    )


async def test_upload_twice_lists_versions_and_downloads_each(world: World) -> None:
    created = await upload(world.editor, world, folder_id=world.folder_id)
    assert created.status_code == 201, created.text
    file = created.json()
    assert (file["name"], file["kind"], file["current_version"]) == ("report.txt", "blob", 1)
    assert file["folder_id"] == world.folder_id

    second = await add_version(world.editor, file["id"])
    assert second.status_code == 201, second.text
    assert second.json()["version_no"] == 2

    versions = (await world.viewer.get(f"/api/files/{file['id']}/versions")).json()
    assert [v["version_no"] for v in versions] == [2, 1]  # newest first
    assert [v["size_bytes"] for v in versions] == [len(V2), len(V1)]
    assert versions[0]["created_by_name"] == "Editor"
    assert versions[0]["sha256"] == hashlib.sha256(V2).hexdigest()

    for n, content in ((1, V1), (2, V2)):
        resp = await world.viewer.get(f"/api/files/{file['id']}/versions/{n}/download")
        assert resp.status_code == 200
        assert resp.content == content

    tree = (await world.viewer.get(f"/api/workspaces/{world.workspace_id}/tree")).json()
    assert {f["id"]: f["current_version"] for f in tree["files"]}[file["id"]] == 2


async def test_download_is_never_rendered_inline(world: World) -> None:
    html = b"<script>alert(document.cookie)</script>"
    file = (await upload(world.editor, world, html, "evil.html")).json()
    resp = await world.viewer.get(f"/api/files/{file['id']}/versions/1/download")
    assert resp.content == html
    assert resp.headers["content-disposition"].startswith("attachment")
    assert "evil.html" in resp.headers["content-disposition"]
    assert resp.headers["content-type"] == "application/octet-stream"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in resp.headers["content-security-policy"]


async def test_viewer_and_outsider_cannot_upload(world: World) -> None:
    file = (await upload(world.owner, world)).json()
    assert (await upload(world.viewer, world)).status_code == 403
    assert (await add_version(world.viewer, file["id"])).status_code == 403
    assert (await upload(world.outsider, world)).status_code == 404
    assert (await add_version(world.outsider, file["id"])).status_code == 404
    for path in ("versions", "versions/1/download"):
        assert (await world.outsider.get(f"/api/files/{file['id']}/{path}")).status_code == 404
    async with new_client() as anon:
        assert (await upload(anon, world)).status_code == 401
        assert (await anon.get(f"/api/files/{file['id']}/versions/1/download")).status_code == 401
    versions = (await world.owner.get(f"/api/files/{file['id']}/versions")).json()
    assert [v["version_no"] for v in versions] == [1]


async def test_size_limit(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1000)
    ok = await upload(world.editor, world, b"x" * 1000)
    assert ok.status_code == 201
    too_big = await upload(world.editor, world, b"x" * 1001)
    assert too_big.status_code == 413
    assert (await add_version(world.editor, ok.json()["id"], b"x" * 1001)).status_code == 413
    # Far over the limit: refused from the Content-Length header, before the body is read.
    huge = await upload(world.editor, world, b"x" * (3 * 1024 * 1024))
    assert huge.status_code == 413
    tree = (await world.owner.get(f"/api/workspaces/{world.workspace_id}/tree")).json()
    assert [f["name"] for f in tree["files"] if f["kind"] == "blob"] == ["report.txt"]
    versions = (await world.owner.get(f"/api/files/{ok.json()['id']}/versions")).json()
    assert len(versions) == 1


async def test_file_names_are_display_only(world: World) -> None:
    for sent, stored in (
        ("../../etc/passwd", "passwd"),
        ("C:\\Users\\me\\notes.md", "notes.md"),
        ("  spaced name.pdf ", "spaced name.pdf"),
        ("..", "upload"),
    ):
        resp = await upload(world.editor, world, b"data", sent)
        assert resp.status_code == 201, resp.text
        assert resp.json()["name"] == stored


def test_display_name_strips_paths_and_control_characters() -> None:
    assert display_name("bad\x00\r\nname.txt") == "badname.txt"
    assert display_name("a/b\\c/d.txt") == "d.txt"
    assert display_name(None) == "upload"
    assert display_name("   ") == "upload"
    assert len(display_name("x" * 500)) == 200


async def test_identical_content_is_stored_once_but_versioned_twice(world: World) -> None:
    file = (await upload(world.editor, world, V1)).json()
    assert (await add_version(world.editor, file["id"], V1)).status_code == 201
    versions = (await world.owner.get(f"/api/files/{file['id']}/versions")).json()
    assert [v["version_no"] for v in versions] == [2, 1]
    assert versions[0]["sha256"] == versions[1]["sha256"]


async def test_versions_only_for_live_uploaded_files(world: World) -> None:
    # world.file_id is a doc: it has no blob versions.
    assert (await add_version(world.editor, world.file_id)).status_code == 409
    assert (await world.viewer.get(f"/api/files/{world.file_id}/versions")).json() == []

    file = (await upload(world.editor, world)).json()
    assert (
        await world.viewer.get(f"/api/files/{file['id']}/versions/7/download")
    ).status_code == 404
    assert (await world.editor.delete(f"/api/files/{file['id']}")).status_code == 204
    assert (await world.viewer.get(f"/api/files/{file['id']}/versions")).status_code == 404
    assert (
        await world.viewer.get(f"/api/files/{file['id']}/versions/1/download")
    ).status_code == 404
    assert (await add_version(world.editor, file["id"])).status_code == 404


async def test_upload_validates_target(world: World) -> None:
    assert (await upload(world.editor, world, folder_id=str(uuid.uuid4()))).status_code == 422
    missing_ws = await world.editor.post(
        "/api/files/upload",
        data={"workspace_id": str(uuid.uuid4())},
        files={"file": ("a.txt", b"a", "text/plain")},
    )
    assert missing_ws.status_code == 404
    empty = await upload(world.editor, world, b"", "empty.txt")
    assert empty.status_code == 201
    got = await world.viewer.get(f"/api/files/{empty.json()['id']}/versions/1/download")
    assert got.status_code == 200 and got.content == b""
