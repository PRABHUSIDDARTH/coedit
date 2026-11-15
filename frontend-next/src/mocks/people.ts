import type { Collaborator } from "@/lib/collab/types";

/** The signed-in user always holds seat 1; collaborators take the next seats in join order. */
export const ME: Collaborator = { id: "u-priya", name: "Priya Nair", seat: 1 };

export const TEAMMATES: Collaborator[] = [
  { id: "u-marcus", name: "Marcus Webb", seat: 2 },
  { id: "u-ines", name: "Inés Duarte", seat: 3 },
  { id: "u-kenji", name: "Kenji Sato", seat: 4 },
];

export const MEMBERS = [
  { ...ME, email: "priya@northwind.example", role: "Owner" as const },
  { ...TEAMMATES[0], email: "marcus@northwind.example", role: "Editor" as const },
  { ...TEAMMATES[1], email: "ines@northwind.example", role: "Editor" as const },
  { ...TEAMMATES[2], email: "kenji@northwind.example", role: "Viewer" as const },
];
