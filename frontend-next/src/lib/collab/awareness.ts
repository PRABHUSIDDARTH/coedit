"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useMemo, useSyncExternalStore } from "react";
import { seatForUser } from "@/lib/seats";

export interface Peer { id: string; name: string; seat: number; cell?: string }

/** Who else has this document open, from Yjs awareness. One entry per person (several tabs collapse). */
export function usePeers(provider: HocuspocusProvider | undefined): Peer[] {
  const store = useMemo(() => {
    const box = { snapshot: [] as Peer[] };
    const read = () => {
      const a = provider?.awareness;
      if (!a) return [];
      const byId = new Map<string, Peer>();
      a.getStates().forEach((state, clientId) => {
        const u = state.user as { id?: string; name?: string } | undefined;
        if (clientId === a.clientID || !(u?.id ?? u?.name)) return;
        const id = (u.id ?? u.name) as string; // scripted peers set only a name
        byId.set(id, { id, name: u.name ?? "Someone", seat: seatForUser(id), cell: typeof state.cell === "string" ? state.cell : undefined });
      });
      return [...byId.values()];
    };
    return {
      subscribe(cb: () => void) {
        const a = provider?.awareness;
        const onChange = () => { box.snapshot = read(); cb(); };
        box.snapshot = read();
        a?.on("change", onChange);
        return () => a?.off("change", onChange);
      },
      get: () => box.snapshot,
    };
  }, [provider]);
  return useSyncExternalStore(store.subscribe, store.get, () => []);
}
