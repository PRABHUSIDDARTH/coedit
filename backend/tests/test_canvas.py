import json

import pytest

from app.services.canvas import MAX_SCENE_BYTES, SceneError, sanitize_link, validate_scene
from tests.conftest import World, new_client


def el(i: int = 1, **kw) -> dict:
    return {"id": f"e{i}", "type": "rectangle", "x": 10, "y": 20, "width": 100, "height": 50, **kw}


def body(elements: list | None = None, base: int = 0, app_state: dict | None = None) -> dict:
    scene: dict = {"elements": elements if elements is not None else [el()]}
    if app_state is not None:
        scene["appState"] = app_state
    return {"base_revision": base, "scene": scene}


async def new_canvas(w: World, name: str = "Board") -> str:
    r = await w.owner.post(
        f"/api/workspaces/{w.workspace_id}/files", json={"name": name, "kind": "canvas"}
    )
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "canvas"
    return r.json()["id"]


# --- lifecycle -------------------------------------------------------------------------------


async def test_create_open_empty_save_read_rename_delete(world: World) -> None:
    fid = await new_canvas(world)
    empty = (await world.owner.get(f"/api/files/{fid}/scene")).json()
    assert (
        empty["revision"] == 0 and empty["scene"]["elements"] == [] and empty["updated_at"] is None
    )

    saved = await world.owner.put(
        f"/api/files/{fid}/scene", json=body([el(1), el(2, type="ellipse")])
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1 and saved.json()["links_removed"] == 0

    got = (await world.owner.get(f"/api/files/{fid}/scene")).json()
    assert [e["id"] for e in got["scene"]["elements"]] == ["e1", "e2"] and got["revision"] == 1

    again = await world.owner.put(f"/api/files/{fid}/scene", json=body([el(1)], base=1))
    assert again.json()["revision"] == 2

    assert (
        await world.owner.patch(f"/api/files/{fid}", json={"name": "Renamed"})
    ).status_code == 200
    tree = (await world.owner.get(f"/api/workspaces/{world.workspace_id}/tree")).json()
    assert {f["name"]: f["kind"] for f in tree["files"]}["Renamed"] == "canvas"

    assert (await world.owner.delete(f"/api/files/{fid}")).status_code == 204
    assert (await world.owner.get(f"/api/files/{fid}/scene")).status_code == 404
    assert (await world.owner.put(f"/api/files/{fid}/scene", json=body())).status_code == 404


async def test_stale_base_revision_is_409_with_current_revision(world: World) -> None:
    fid = await new_canvas(world)
    assert (await world.owner.put(f"/api/files/{fid}/scene", json=body(base=0))).status_code == 200
    stale = await world.editor.put(f"/api/files/{fid}/scene", json=body([el(9)], base=0))
    assert stale.status_code == 409 and stale.json()["revision"] == 1
    kept = (await world.owner.get(f"/api/files/{fid}/scene")).json()
    assert [e["id"] for e in kept["scene"]["elements"]] == [
        "e1"
    ]  # the rejected save changed nothing
    future = await world.owner.put(f"/api/files/{fid}/scene", json=body(base=5))
    assert future.status_code == 409


async def test_scene_routes_refuse_other_kinds_and_tickets_refuse_canvas(world: World) -> None:
    doc = world.file_id
    assert (await world.owner.get(f"/api/files/{doc}/scene")).status_code == 409
    assert (await world.owner.put(f"/api/files/{doc}/scene", json=body())).status_code == 409
    fid = await new_canvas(world)
    assert (await world.owner.post(f"/api/files/{fid}/ws-ticket")).status_code == 409


# --- permissions -----------------------------------------------------------------------------


async def test_permission_matrix(world: World) -> None:
    fid = await new_canvas(world)
    assert (await world.owner.put(f"/api/files/{fid}/scene", json=body())).status_code == 200
    url = f"/api/files/{fid}/scene"
    # read: viewer and up allowed, outsider 404, anonymous 401
    for c in (world.owner, world.editor, world.viewer):
        assert (await c.get(url)).status_code == 200
    assert (await world.outsider.get(url)).status_code == 404
    async with new_client() as anon:
        assert (await anon.get(url)).status_code == 401
        assert (await anon.put(url, json=body(base=1))).status_code == 401
    # write: editor and owner allowed, viewer 403 (the API, not just the UI), outsider 404
    assert (await world.viewer.put(url, json=body([el(7)], base=1))).status_code == 403
    assert (await world.outsider.put(url, json=body([el(7)], base=1))).status_code == 404
    assert (await world.editor.put(url, json=body([el(3)], base=1))).status_code == 200
    # the rejected writes changed nothing
    ids = [e["id"] for e in (await world.owner.get(url)).json()["scene"]["elements"]]
    assert ids == ["e3"]


async def test_viewer_cannot_create_canvas_and_removed_member_loses_access(world: World) -> None:
    r = await world.viewer.post(
        f"/api/workspaces/{world.workspace_id}/files", json={"name": "x", "kind": "canvas"}
    )
    assert r.status_code == 403
    fid = await new_canvas(world)
    editor_id = world.users["editor"]["id"]
    assert (await world.editor.put(f"/api/files/{fid}/scene", json=body())).status_code == 200
    removed = await world.owner.delete(f"/api/workspaces/{world.workspace_id}/members/{editor_id}")
    assert removed.status_code == 204
    assert (await world.editor.get(f"/api/files/{fid}/scene")).status_code == 404
    assert (await world.editor.put(f"/api/files/{fid}/scene", json=body(base=1))).status_code == 404


async def test_demoted_editor_cannot_write_but_can_read(world: World) -> None:
    fid = await new_canvas(world)
    editor_id = world.users["editor"]["id"]
    r = await world.owner.patch(
        f"/api/workspaces/{world.workspace_id}/members/{editor_id}", json={"role": "viewer"}
    )
    assert r.status_code == 200
    assert (await world.editor.get(f"/api/files/{fid}/scene")).status_code == 200
    assert (await world.editor.put(f"/api/files/{fid}/scene", json=body())).status_code == 403


# --- validation ------------------------------------------------------------------------------


async def test_invalid_json_and_wrong_shapes_are_422_without_echo(world: World) -> None:
    fid = await new_canvas(world)
    url = f"/api/files/{fid}/scene"
    secret = "CANARY-DO-NOT-ECHO"
    cases = [
        (b"{not json" + secret.encode(), "bad json"),
        (b"\xff\xfe\x00", "not utf-8"),
        (b'["a"]', "not an object"),
        (json.dumps({"scene": {"elements": []}}).encode(), "no base_revision"),
        (json.dumps({"base_revision": "0", "scene": {"elements": []}}).encode(), "string revision"),
        (
            json.dumps({"base_revision": 0, "scene": {"elements": "x" + secret}}).encode(),
            "elements not list",
        ),
        (
            json.dumps(
                {
                    "base_revision": 0,
                    "scene": {"elements": [{"id": "a", "type": secret, "x": 0, "y": 0}]},
                }
            ).encode(),
            "bad type",
        ),
        (
            json.dumps({"base_revision": 0, "scene": {"elements": [el(1, x="nope")]}}).encode(),
            "x not number",
        ),
        (
            json.dumps({"base_revision": 0, "scene": {"elements": [el(1), el(1)]}}).encode(),
            "duplicate id",
        ),
        (
            json.dumps(body(app_state={"viewBackgroundColor": "url(" + secret + ")"})).encode(),
            "bad colour",
        ),
        (json.dumps(body(app_state={"gridSize": 0})).encode(), "bad grid"),
    ]
    for raw, label in cases:
        r = await world.owner.put(url, content=raw, headers={"Content-Type": "application/json"})
        assert r.status_code == 422, (label, r.status_code, r.text)
        assert secret not in r.text, label
    assert (await world.owner.get(url)).json()["revision"] == 0


@pytest.mark.parametrize("kind", ["image", "embeddable", "iframe", "magicframe", "selection"])
async def test_images_and_embeds_are_rejected(world: World, kind: str) -> None:
    fid = await new_canvas(world)
    r = await world.owner.put(f"/api/files/{fid}/scene", json=body([el(1, type=kind)]))
    assert r.status_code == 422
    if kind == "image":
        assert "images are not supported" in r.json()["detail"]


async def test_size_cap_413_by_content_length_and_by_streaming(world: World) -> None:
    fid = await new_canvas(world)
    url = f"/api/files/{fid}/scene"
    big_text = "x" * 15_000  # under the per-text cap; many of them put the body over 5 MiB
    elements = [el(i, type="text", text=big_text) for i in range(MAX_SCENE_BYTES // 15_000 + 20)]
    raw = json.dumps(body(elements)).encode()
    assert len(raw) > MAX_SCENE_BYTES
    r = await world.owner.put(url, content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 413

    # a chunked body without Content-Length is stopped while streaming
    async def gen():
        for i in range(0, len(raw), 65536):
            yield raw[i : i + 65536]

    r2 = await world.owner.put(url, content=gen(), headers={"Content-Type": "application/json"})
    assert r2.status_code == 413
    assert (await world.owner.get(url)).json()["revision"] == 0
    ok = await world.owner.put(url, json=body([el(1, type="text", text=big_text)]))
    assert ok.status_code == 200  # a normal large-ish scene still saves


async def test_app_state_is_reduced_to_background_and_grid(world: World) -> None:
    fid = await new_canvas(world)
    app_state = {
        "viewBackgroundColor": "#112233",
        "gridSize": 20,
        "gridModeEnabled": True,
        "collaborators": {"u": {"username": "x"}},
        "selectedElementIds": {"e1": True},
        "scrollX": 5,
        "zoom": {"value": 2},
        "currentItemFontFamily": 1,
    }
    r = await world.owner.put(f"/api/files/{fid}/scene", json=body(app_state=app_state))
    assert r.status_code == 200
    stored = (await world.owner.get(f"/api/files/{fid}/scene")).json()["scene"]["appState"]
    assert stored == {"viewBackgroundColor": "#112233", "gridSize": 20, "gridModeEnabled": True}


async def test_deleted_elements_are_not_stored(world: World) -> None:
    fid = await new_canvas(world)
    r = await world.owner.put(f"/api/files/{fid}/scene", json=body([el(1), el(2, isDeleted=True)]))
    assert r.status_code == 200
    ids = [
        e["id"]
        for e in (await world.owner.get(f"/api/files/{fid}/scene")).json()["scene"]["elements"]
    ]
    assert ids == ["e1"]


# --- link sanitising -------------------------------------------------------------------------

BAD_LINKS = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "blob:https://example.com/x",
    "//example.com/x",
    "example.com",
    "https://",
    "mailto:",
    "x" * 3000,
    "",
]
GOOD_LINKS = [
    "http://example.com",
    "https://example.com/a?b=c#d",
    "HTTPS://EXAMPLE.COM",
    "mailto:someone@example.com",
]


@pytest.mark.parametrize("link", BAD_LINKS)
def test_sanitize_link_drops(link: str) -> None:
    assert sanitize_link(link) is None


@pytest.mark.parametrize("link", GOOD_LINKS)
def test_sanitize_link_keeps(link: str) -> None:
    assert sanitize_link(link) == link


def test_sanitize_link_non_strings() -> None:
    for v in (None, 5, ["https://example.com"], {"a": 1}, True):
        assert sanitize_link(v) is None


async def test_links_are_sanitised_on_save_and_counted(world: World) -> None:
    fid = await new_canvas(world)
    elements = [
        el(1, link="javascript:alert(1)"),
        el(2, link="https://example.com"),
        el(3, link="data:text/html,x"),
        el(4),
    ]
    r = await world.owner.put(f"/api/files/{fid}/scene", json=body(elements))
    assert r.status_code == 200 and r.json()["links_removed"] == 2
    stored = {
        e["id"]: e.get("link")
        for e in (await world.owner.get(f"/api/files/{fid}/scene")).json()["scene"]["elements"]
    }
    assert stored == {"e1": None, "e2": "https://example.com", "e3": None, "e4": None}


def test_validate_scene_unit() -> None:
    scene, removed = validate_scene({"elements": [el(1, link="javascript:x")], "junk": 1})
    assert removed == 1 and set(scene) == {"elements", "appState"}
    with pytest.raises(SceneError):
        validate_scene({"elements": [el(1, type="image")]})
    with pytest.raises(SceneError):
        validate_scene([])
