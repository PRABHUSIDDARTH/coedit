import { FileText, PenTool, Sparkles, Table2, type LucideIcon } from "lucide-react";

export type PageKind = "doc" | "sheet" | "canvas" | "council";

export const KIND_META: Record<PageKind, { icon: LucideIcon }> = {
  doc: { icon: FileText }, sheet: { icon: Table2 }, canvas: { icon: PenTool }, council: { icon: Sparkles },
};
