import type { Collaborator, DocKind } from "@/lib/collab/types";

export interface Workspace { id: string; name: string; initials: string }

export type ItemKind = DocKind | "council";
export interface WorkItem {
  id: string;
  kind: ItemKind;
  title: string;
  workspaceId: string;
  editedAt: string; // ISO
  editedBy: string;
  starred?: boolean;
}

export type ColumnType = "text" | "number" | "currency" | "percent" | "status" | "date";
export interface SheetColumn { id: string; label: string; type: ColumnType; width: number }
export interface SheetData { title: string; columns: SheetColumn[]; rows: string[][] }

export interface DocData {
  title: string;
  html: string;
  comments: { id: string; author: string; seat: number; text: string; editedAt: string }[];
}

export interface CanvasNode { id: string; label: string; x: number; y: number; w: number; h: number; token: "azure" | "cyan" | "mint" | "orange" | "sun" }
export interface CanvasData { title: string; nodes: CanvasNode[]; edges: [string, string][] }

export type Role = "Owner" | "Editor" | "Viewer";
export interface Member extends Collaborator { email: string; role: Role }

export type Level = "info" | "warning" | "danger";
export interface AdminData {
  usage: { day: number; requests: number; tokensK: number }[];
  bySeat: { seat: string; seatNo: number; runs: number; tokensK: number; costUsd: number }[];
  routing: { seat: string; primary: string; fallback: string; maxTokens: number; share: number }[];
  audit: { at: string; actor: string; action: string; target: string; level: Level }[];
  keys: { id: string; provider: string; last4: string; created: string; status: "active" | "revoked" }[];
  health: { id: string; name: string; status: "ok" | "degraded" | "down"; detail: string; uptime: string }[];
}

export interface Repo {
  me(): Promise<Collaborator>;
  listWorkspaces(): Promise<Workspace[]>;
  listItems(workspaceId: string): Promise<WorkItem[]>;
  getDoc(id: string): Promise<DocData>;
  getSheet(id: string): Promise<SheetData>;
  getCanvas(id: string): Promise<CanvasData>;
  listMembers(): Promise<Member[]>;
  getAdmin(): Promise<AdminData>;
}
