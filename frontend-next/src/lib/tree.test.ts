import { expect, test } from "vitest";
import type { FileEntry, FolderEntry } from "../api/workspaces";
import { buildTree } from "./tree";

const folder = (id: string, parent_id: string | null, name = id): FolderEntry => ({ id, parent_id, name });
const file = (id: string, folder_id: string | null, name = id): FileEntry => ({
  id,
  folder_id,
  name,
  kind: "doc",
  current_version: null,
  updated_at: "2026-11-15T00:00:00Z",
});

test("nests folders and files and sorts by name", () => {
  const tree = buildTree(
    [folder("b", null), folder("a", null), folder("a2", "a"), folder("a10", "a")],
    [file("z", null), file("m", "a2"), file("c", null)],
  );
  expect(tree.folders.map((f) => f.id)).toEqual(["a", "b"]);
  expect(tree.folders[0].folders.map((f) => f.id)).toEqual(["a2", "a10"]); // numeric-aware
  expect(tree.folders[0].folders[0].files.map((f) => f.id)).toEqual(["m"]);
  expect(tree.files.map((f) => f.id)).toEqual(["c", "z"]);
});

test("orphans surface at the root instead of vanishing", () => {
  const tree = buildTree([folder("x", "gone")], [file("f", "gone")]);
  expect(tree.folders.map((f) => f.id)).toEqual(["x"]);
  expect(tree.files.map((f) => f.id)).toEqual(["f"]);
});

test("empty input", () => {
  expect(buildTree([], [])).toEqual({ folders: [], files: [] });
});
