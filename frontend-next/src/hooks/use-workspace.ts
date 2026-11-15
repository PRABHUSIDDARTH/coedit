"use client";

import { useTree, useWorkspaces } from "@/api/workspaces";
import { useUi } from "@/stores/ui";

/** The workspace the user picked, falling back to their first one. */
export function useCurrentWorkspace() {
  const workspaces = useWorkspaces();
  const stored = useUi((s) => s.workspaceId);
  const current = workspaces.data?.find((w) => w.id === stored) ?? workspaces.data?.[0];
  const tree = useTree(current?.id ?? "");
  return { workspaces, current, tree };
}
