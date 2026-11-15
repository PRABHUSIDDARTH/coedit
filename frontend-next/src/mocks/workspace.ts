import type { ItemKind, Workspace } from "@/lib/data/types";

/** `editedMinutesAgo` is relative to load time, so relative timestamps are always plausible. */
export interface SeedItem {
  id: string; kind: ItemKind; title: string; workspaceId: string;
  editedMinutesAgo: number; editedBy: string; starred?: boolean;
}

export const WORKSPACES: Workspace[] = [
  { id: "northwind", name: "Northwind Product", initials: "NP" },
  { id: "studio", name: "Studio Weekly", initials: "SW" },
];

export const ITEMS: SeedItem[] = [
  { id: "q3-launch-brief", kind: "doc", title: "Q3 launch brief", workspaceId: "northwind", editedMinutesAgo: 4, editedBy: "Marcus Webb", starred: true },
  { id: "interview-notes", kind: "doc", title: "Customer interview notes", workspaceId: "northwind", editedMinutesAgo: 95, editedBy: "Inés Duarte" },
  { id: "release-checklist", kind: "doc", title: "Release checklist", workspaceId: "northwind", editedMinutesAgo: 1400, editedBy: "Priya Nair" },
  { id: "q3-revenue-model", kind: "sheet", title: "Q3 revenue model", workspaceId: "northwind", editedMinutesAgo: 22, editedBy: "Kenji Sato", starred: true },
  { id: "hiring-plan", kind: "sheet", title: "Hiring plan", workspaceId: "northwind", editedMinutesAgo: 3100, editedBy: "Priya Nair" },
  { id: "onboarding-flow", kind: "canvas", title: "Onboarding flow", workspaceId: "northwind", editedMinutesAgo: 180, editedBy: "Inés Duarte" },
  { id: "system-map", kind: "canvas", title: "System map", workspaceId: "northwind", editedMinutesAgo: 5200, editedBy: "Kenji Sato" },
  { id: "pricing-debate", kind: "council", title: "Pricing tiers debate", workspaceId: "northwind", editedMinutesAgo: 60, editedBy: "Priya Nair" },
  { id: "launch-risks", kind: "council", title: "Launch risks review", workspaceId: "northwind", editedMinutesAgo: 2600, editedBy: "Marcus Webb" },
  { id: "editorial-calendar", kind: "doc", title: "Editorial calendar", workspaceId: "studio", editedMinutesAgo: 300, editedBy: "Priya Nair" },
];
