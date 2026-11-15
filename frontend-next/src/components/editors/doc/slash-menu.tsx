"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { slashStore } from "./extensions";

const server = { open: false, items: [], index: 0, rect: null, pick: () => {} } as ReturnType<typeof slashStore.get>;

export function SlashMenu() {
  const s = useSyncExternalStore(slashStore.subscribe, slashStore.get, () => server);
  if (!s.open || !s.rect) return null;
  return (
    <div role="listbox" aria-label="Insert a block" style={{ position: "fixed", left: s.rect.left, top: s.rect.bottom + 6 }}
      className="z-50 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
      {s.items.length === 0 && <p className="px-3 py-2 text-sm text-ink-3">No blocks match.</p>}
      {s.items.map((it, i) => (
        <button key={it.title} role="option" aria-selected={i === s.index} type="button"
          onMouseDown={(e) => { e.preventDefault(); s.pick(it); }}
          className={cn("flex w-full flex-col rounded-md px-3 py-1.5 text-left", i === s.index ? "bg-raised" : "hover:bg-raised")}>
          <span className="text-sm font-medium text-ink">{it.title}</span>
          <span className="text-xs text-ink-3">{it.hint}</span>
        </button>
      ))}
    </div>
  );
}
