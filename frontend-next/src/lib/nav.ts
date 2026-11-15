import { FileText, PenTool, Sparkles, Table2, type LucideIcon } from "lucide-react";
import type { ItemKind, WorkItem } from "@/lib/data/types";

export const KIND_META: Record<ItemKind, { label: string; plural: string; icon: LucideIcon; base: string }> = {
  doc: { label: "Doc", plural: "Docs", icon: FileText, base: "/app/doc" },
  sheet: { label: "Sheet", plural: "Sheets", icon: Table2, base: "/app/sheet" },
  canvas: { label: "Canvas", plural: "Canvases", icon: PenTool, base: "/app/canvas" },
  council: { label: "Council run", plural: "Council", icon: Sparkles, base: "/app/council" },
};

export const hrefFor = (i: Pick<WorkItem, "kind" | "id">) =>
  i.kind === "council" ? `/app/council?run=${i.id}` : `${KIND_META[i.kind].base}/${i.id}`;
