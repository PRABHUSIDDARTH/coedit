import type { FileEntry, FolderEntry } from "../api/workspaces";

export interface FolderNode extends FolderEntry {
  folders: FolderNode[];
  files: FileEntry[];
}

export interface TreeRoot {
  folders: FolderNode[];
  files: FileEntry[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Nest the API's flat folder/file lists. Entries whose parent is missing surface at the root. */
export function buildTree(folders: FolderEntry[], files: FileEntry[]): TreeRoot {
  const nodes = new Map<string, FolderNode>();
  for (const f of folders) nodes.set(f.id, { ...f, folders: [], files: [] });

  const root: TreeRoot = { folders: [], files: [] };
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    (parent ?? root).folders.push(node);
  }
  for (const file of files) {
    const parent = file.folder_id ? nodes.get(file.folder_id) : undefined;
    (parent ?? root).files.push(file);
  }

  const sort = (level: TreeRoot) => {
    level.folders.sort(byName);
    level.files.sort(byName);
    level.folders.forEach(sort);
  };
  sort(root);
  return root;
}
