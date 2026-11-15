import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type Role = "owner" | "editor" | "viewer";
export type FileKind = "doc" | "sheet" | "blob";

export interface Workspace {
  id: string;
  name: string;
  role: Role;
}

export interface FolderEntry {
  id: string;
  parent_id: string | null;
  name: string;
}

export interface FileEntry {
  id: string;
  folder_id: string | null;
  name: string;
  kind: FileKind;
  current_version: number | null;
  updated_at: string;
}

export interface Tree {
  role: Role;
  folders: FolderEntry[];
  files: FileEntry[];
}

export interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
}

export const canEdit = (role: Role | undefined) => role === "owner" || role === "editor";

export function useWorkspaces() {
  return useQuery({ queryKey: ["workspaces"], queryFn: () => api<Workspace[]>("/workspaces") });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Workspace>("/workspaces", { method: "POST", body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useTree(workspaceId: string) {
  return useQuery({
    queryKey: ["tree", workspaceId],
    queryFn: () => api<Tree>(`/workspaces/${workspaceId}/tree`),
    enabled: workspaceId !== "",
    retry: false,
  });
}

export type TreeChange =
  | { op: "createFolder"; name: string; parentId: string | null }
  | { op: "createFile"; name: string; kind: "doc" | "sheet"; folderId: string | null }
  | { op: "renameFolder"; id: string; name: string }
  | { op: "renameFile"; id: string; name: string }
  | { op: "deleteFolder"; id: string }
  | { op: "deleteFile"; id: string };

function applyTreeChange(workspaceId: string, c: TreeChange): Promise<unknown> {
  switch (c.op) {
    case "createFolder":
      return api<FolderEntry>(`/workspaces/${workspaceId}/folders`, {
        method: "POST",
        body: { name: c.name, parent_id: c.parentId },
      });
    case "createFile":
      return api<FileEntry>(`/workspaces/${workspaceId}/files`, {
        method: "POST",
        body: { name: c.name, kind: c.kind, folder_id: c.folderId },
      });
    case "renameFolder":
      return api<FolderEntry>(`/folders/${c.id}`, { method: "PATCH", body: { name: c.name } });
    case "renameFile":
      return api<FileEntry>(`/files/${c.id}`, { method: "PATCH", body: { name: c.name } });
    case "deleteFolder":
      return api<void>(`/folders/${c.id}`, { method: "DELETE" });
    case "deleteFile":
      return api<void>(`/files/${c.id}`, { method: "DELETE" });
  }
}

/** One mutation for every sidebar edit; refreshes the tree afterwards. */
export function useTreeChange(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: TreeChange) => applyTreeChange(workspaceId, change),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tree", workspaceId] }),
  });
}

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api<Member[]>(`/workspaces/${workspaceId}/members`),
    enabled: workspaceId !== "",
  });
}

export type MemberChange =
  | { op: "add"; email: string; role: Role }
  | { op: "setRole"; userId: string; role: Role }
  | { op: "remove"; userId: string };

export function useMemberChange(workspaceId: string) {
  const qc = useQueryClient();
  const base = `/workspaces/${workspaceId}/members`;
  return useMutation({
    mutationFn: (c: MemberChange): Promise<unknown> => {
      switch (c.op) {
        case "add":
          return api<Member>(base, { method: "POST", body: { email: c.email, role: c.role } });
        case "setRole":
          return api<Member>(`${base}/${c.userId}`, { method: "PATCH", body: { role: c.role } });
        case "remove":
          return api<void>(`${base}/${c.userId}`, { method: "DELETE" });
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["members", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      void qc.invalidateQueries({ queryKey: ["tree", workspaceId] });
    },
  });
}

export interface FileVersion {
  version_no: number;
  size_bytes: number;
  mime: string;
  sha256: string;
  created_by_name: string;
  created_at: string;
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const downloadUrl = (fileId: string, versionNo: number) =>
  `/api/files/${fileId}/versions/${versionNo}/download`;

export function useVersions(fileId: string) {
  return useQuery({
    queryKey: ["versions", fileId],
    queryFn: () => api<FileVersion[]>(`/files/${fileId}/versions`),
  });
}

function fileForm(file: File, fields: Record<string, string | null> = {}): FormData {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is too large (limit 50 MB)");
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
  form.append("file", file);
  return form;
}

/** Upload a new file into a folder (null = workspace root). */
export function useUpload(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, folderId }: { file: File; folderId: string | null }) =>
      api<FileEntry>("/files/upload", {
        method: "POST",
        body: fileForm(file, { workspace_id: workspaceId, folder_id: folderId }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tree", workspaceId] }),
  });
}

/** Upload the next version of an existing uploaded file. */
export function useUploadVersion(workspaceId: string, fileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) =>
      api<FileVersion>(`/files/${fileId}/versions`, { method: "POST", body: fileForm(file) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["versions", fileId] });
      void qc.invalidateQueries({ queryKey: ["tree", workspaceId] });
    },
  });
}

/** Create an empty doc or sheet and return it (used by import, which then fills it). */
export function useCreateFile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; kind: "doc" | "sheet"; folder_id: string | null }) =>
      api<FileEntry>(`/workspaces/${workspaceId}/files`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", workspaceId] }),
  });
}
