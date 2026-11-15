"use client";

import { useEffect, useRef, useState } from "react";
import type { CollabProvider, ConnectionState, DocKind, DocUpdate, PresenceEvent } from "@/lib/collab/types";
import { createCollabProvider } from "@/lib/data";

/** Connects a provider for one document and exposes live presence. `onUpdate` is called for remote
 *  edits; it is kept in a ref, so passing an inline function is fine. */
export function useCollab(docId: string, kind: DocKind, onUpdate?: (u: DocUpdate) => void) {
  const [state, setState] = useState<ConnectionState>("connecting");
  // Presence is stored with the document it belongs to, so switching documents shows no stale peers.
  const [presence, setPresence] = useState<{ doc: string; peers: Record<string, PresenceEvent> }>({ doc: docId, peers: {} });
  const provider = useRef<CollabProvider | null>(null);
  const cb = useRef(onUpdate);
  useEffect(() => { cb.current = onUpdate; });

  useEffect(() => {
    const p = createCollabProvider();
    provider.current = p;
    const offs = [
      p.onState(setState),
      p.onPresence((e) => setPresence((prev) => ({ doc: docId, peers: { ...(prev.doc === docId ? prev.peers : {}), [e.collaborator.id]: e } }))),
      p.onUpdate((u) => cb.current?.(u)),
    ];
    void p.connect(docId, kind);
    return () => { offs.forEach((off) => off()); p.disconnect(); provider.current = null; };
  }, [docId, kind]);

  return { state, peers: presence.doc === docId ? Object.values(presence.peers) : [], provider };
}
