/** Types for the preview areas (canvas, admin console). Everything else talks to the real API in `@/api`. */

export interface CanvasNode { id: string; label: string; x: number; y: number; w: number; h: number; token: "azure" | "cyan" | "mint" | "orange" | "sun" }
export interface CanvasData { title: string; nodes: CanvasNode[]; edges: [string, string][] }

export type Level = "info" | "warning" | "danger";
export interface AdminData {
  usage: { day: number; requests: number; tokensK: number }[];
  bySeat: { seat: string; seatNo: number; runs: number; tokensK: number; costUsd: number }[];
  routing: { seat: string; primary: string; fallback: string; maxTokens: number; share: number }[];
  audit: { at: string; actor: string; action: string; target: string; level: Level }[];
  keys: { id: string; provider: string; last4: string; created: string; status: "active" | "revoked" }[];
  health: { id: string; name: string; status: "ok" | "degraded" | "down"; detail: string; uptime: string }[];
}

export interface PreviewRepo {
  getCanvas(id: string): Promise<CanvasData>;
  getAdmin(): Promise<AdminData>;
}
