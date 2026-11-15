"use client";

import { useQueries } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/api/client";
import { useWorkspaces, type FileEntry, type Tree, type Workspace } from "@/api/workspaces";
import { useUi } from "@/stores/ui";

/** Find a file by id across the user's workspaces, and switch the sidebar to the one it lives in. */
export function useFileLookup(fileId: string): { loading: boolean; file?: FileEntry; workspace?: Workspace; role?: Tree["role"] } {
  const workspaces = useWorkspaces();
  const setWorkspaceId = useUi((s) => s.setWorkspaceId);
  const current = useUi((s) => s.workspaceId);
  const trees = useQueries({
    queries: (workspaces.data ?? []).map((w) => ({ queryKey: ["tree", w.id], queryFn: () => api<Tree>(`/workspaces/${w.id}/tree`), retry: false })),
  });
  let file: FileEntry | undefined; let workspace: Workspace | undefined; let role: Tree["role"] | undefined;
  (workspaces.data ?? []).forEach((w, i) => {
    const hit = trees[i]?.data?.files.find((f) => f.id === fileId);
    if (hit && !file) { file = hit; workspace = w; role = trees[i].data?.role; }
  });
  const loading = workspaces.isPending || (!file && trees.some((t) => t.isPending));
  useEffect(() => { if (workspace && workspace.id !== current) setWorkspaceId(workspace.id); }, [workspace, current, setWorkspaceId]);
  return { loading, file, workspace, role };
}
