from tests.conftest import World, new_client, register, unique_email


async def tree(w: World) -> dict:
    resp = await w.viewer.get(f"/api/workspaces/{w.workspace_id}/tree")
    assert resp.status_code == 200
    return resp.json()


async def test_workspace_list_shows_role(world: World) -> None:
    for role in ("owner", "editor", "viewer"):
        rows = (await getattr(world, role).get("/api/workspaces")).json()
        assert [(r["id"], r["role"]) for r in rows] == [(world.workspace_id, role)]
    assert (await world.outsider.get("/api/workspaces")).json() == []


async def test_tree_contents(world: World) -> None:
    t = await tree(world)
    assert t["role"] == "viewer"
    assert t["folders"] == [{"id": world.folder_id, "parent_id": None, "name": "Specs"}]
    (f,) = t["files"]
    assert (f["id"], f["folder_id"], f["name"], f["kind"]) == (
        world.file_id,
        world.folder_id,
        "Notes",
        "doc",
    )
    assert f["current_version"] is None


async def test_editor_folder_lifecycle(world: World) -> None:
    ws = f"/api/workspaces/{world.workspace_id}"
    child = await world.editor.post(
        f"{ws}/folders", json={"name": "Drafts", "parent_id": world.folder_id}
    )
    assert child.status_code == 201
    child_id = child.json()["id"]

    dup = await world.editor.post(
        f"{ws}/folders", json={"name": "Drafts", "parent_id": world.folder_id}
    )
    assert dup.status_code == 409
    dup_root = await world.editor.post(f"{ws}/folders", json={"name": "Specs"})
    assert dup_root.status_code == 409

    renamed = await world.editor.patch(f"/api/folders/{child_id}", json={"name": "Old drafts"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Old drafts"

    # A folder cannot be moved into itself or its own descendant.
    for target in (world.folder_id, child_id):
        cyc = await world.editor.patch(
            f"/api/folders/{world.folder_id}", json={"parent_id": target}
        )
        assert cyc.status_code == 409

    to_root = await world.editor.patch(f"/api/folders/{child_id}", json={"parent_id": None})
    assert to_root.status_code == 200 and to_root.json()["parent_id"] is None
    back = await world.editor.patch(f"/api/folders/{child_id}", json={"parent_id": world.folder_id})
    assert back.status_code == 200

    # Deleting the parent removes the subtree and its files from the tree.
    assert (await world.editor.delete(f"/api/folders/{world.folder_id}")).status_code == 204
    t = await tree(world)
    assert t["folders"] == [] and t["files"] == []


async def test_editor_file_lifecycle(world: World) -> None:
    ws = f"/api/workspaces/{world.workspace_id}"
    sheet = await world.editor.post(f"{ws}/files", json={"name": "Budget", "kind": "sheet"})
    assert sheet.status_code == 201
    sheet_id = sheet.json()["id"]
    assert sheet.json()["folder_id"] is None

    # Blob files only come from upload (slice 6), never from this endpoint.
    assert (
        await world.editor.post(f"{ws}/files", json={"name": "x", "kind": "blob"})
    ).status_code == 422
    assert (
        await world.editor.post(f"{ws}/files", json={"name": "  ", "kind": "doc"})
    ).status_code == 422

    moved = await world.editor.patch(
        f"/api/files/{sheet_id}", json={"name": "Budget 2026", "folder_id": world.folder_id}
    )
    assert moved.status_code == 200
    assert (moved.json()["name"], moved.json()["folder_id"]) == ("Budget 2026", world.folder_id)
    rename_only = await world.editor.patch(f"/api/files/{sheet_id}", json={"name": "B"})
    assert rename_only.json()["folder_id"] == world.folder_id  # omitted field = unchanged

    assert (await world.editor.delete(f"/api/files/{sheet_id}")).status_code == 204
    assert sheet_id not in [f["id"] for f in (await tree(world))["files"]]
    assert (
        await world.editor.patch(f"/api/files/{sheet_id}", json={"name": "z"})
    ).status_code == 404


async def test_folder_from_other_workspace_rejected(world: World) -> None:
    other = (await world.outsider.post("/api/workspaces", json={"name": "Other"})).json()
    foreign = await world.outsider.post(
        f"/api/workspaces/{other['id']}/folders", json={"name": "Theirs"}
    )
    foreign_id = foreign.json()["id"]
    ws = f"/api/workspaces/{world.workspace_id}"
    for resp in (
        await world.editor.post(
            f"{ws}/files", json={"name": "n", "kind": "doc", "folder_id": foreign_id}
        ),
        await world.editor.post(f"{ws}/folders", json={"name": "n", "parent_id": foreign_id}),
        await world.editor.patch(f"/api/files/{world.file_id}", json={"folder_id": foreign_id}),
        await world.editor.patch(f"/api/folders/{world.folder_id}", json={"parent_id": foreign_id}),
    ):
        assert resp.status_code == 422, resp.text


async def test_member_management(world: World) -> None:
    members = f"/api/workspaces/{world.workspace_id}/members"
    async with new_client() as newbie:
        user = await register(newbie, unique_email("newbie"), "Newbie")
        assert (await newbie.get(f"/api/workspaces/{world.workspace_id}/tree")).status_code == 404

        added = await world.owner.post(
            members, json={"email": user["email"].upper(), "role": "viewer"}
        )
        assert added.status_code == 201
        assert added.json() == {
            "user_id": user["id"],
            "email": user["email"],
            "display_name": "Newbie",
            "role": "viewer",
        }
        assert (
            await world.owner.post(members, json={"email": user["email"], "role": "editor"})
        ).status_code == 409
        assert (
            await world.owner.post(
                members, json={"email": unique_email("nobody"), "role": "viewer"}
            )
        ).status_code == 404

        folders = f"/api/workspaces/{world.workspace_id}/folders"
        assert (await newbie.post(folders, json={"name": "A"})).status_code == 403
        promoted = await world.owner.patch(f"{members}/{user['id']}", json={"role": "editor"})
        assert promoted.status_code == 200 and promoted.json()["role"] == "editor"
        assert (await newbie.post(folders, json={"name": "A"})).status_code == 201

        assert (await world.owner.delete(f"{members}/{user['id']}")).status_code == 204
        assert (await newbie.post(folders, json={"name": "B"})).status_code == 404


async def test_last_owner_cannot_leave_or_be_demoted(world: World) -> None:
    me = f"/api/workspaces/{world.workspace_id}/members/{world.users['owner']['id']}"
    assert (await world.owner.patch(me, json={"role": "editor"})).status_code == 409
    assert (await world.owner.delete(me)).status_code == 409
    # With a second owner the first may step down.
    other = f"/api/workspaces/{world.workspace_id}/members/{world.users['editor']['id']}"
    assert (await world.owner.patch(other, json={"role": "owner"})).status_code == 200
    assert (await world.owner.patch(me, json={"role": "viewer"})).status_code == 200
