import type { CanvasNode } from "@/lib/data/types";

/** Canvas seed in token names, resolved to real colors at render time. */
export const CANVAS_NODES: Record<string, { nodes: CanvasNode[]; edges: [string, string][] }> = {
  "onboarding-flow": {
    nodes: [
      { id: "a", label: "Sign up", x: 40, y: 140, w: 170, h: 70, token: "azure" },
      { id: "b", label: "Verify email", x: 300, y: 140, w: 190, h: 70, token: "cyan" },
      { id: "c", label: "Create workspace", x: 580, y: 140, w: 230, h: 70, token: "mint" },
      { id: "d", label: "Invite your team", x: 900, y: 40, w: 220, h: 70, token: "orange" },
      { id: "e", label: "Write the first doc", x: 900, y: 240, w: 240, h: 70, token: "sun" },
    ],
    edges: [["a", "b"], ["b", "c"], ["c", "d"], ["c", "e"]],
  },
  "system-map": {
    nodes: [
      { id: "web", label: "Web app", x: 60, y: 120, w: 170, h: 70, token: "azure" },
      { id: "sync", label: "Realtime sync", x: 340, y: 40, w: 220, h: 70, token: "cyan" },
      { id: "api", label: "API", x: 340, y: 240, w: 220, h: 70, token: "mint" },
      { id: "db", label: "Postgres", x: 660, y: 140, w: 190, h: 70, token: "orange" },
    ],
    edges: [["web", "sync"], ["web", "api"], ["sync", "db"], ["api", "db"]],
  },
};
