"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { api } from "@/api/client";

interface Ticket {
  ticket: string;
  url: string;
  read_only: boolean;
  name: string;
  color: string;
}

export interface CollabSession {
  fileId: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** The server also enforces this; the flag only switches the UI to view-only. */
  readOnly: boolean;
  user: { name: string };
}

export type CollabStatus = "connecting" | "connected" | "disconnected";

export interface Collab {
  session: CollabSession | null;
  status: CollabStatus;
  /** True once the document's stored content has arrived. */
  synced: boolean;
  error: string | null;
}

const fetchTicket = (fileId: string) => api<Ticket>(`/files/${fileId}/ws-ticket`, { method: "POST" });

/**
 * Where to open the WebSocket. The API returns a path ("/sync") or an absolute URL. Next cannot
 * proxy WebSockets, so a relative answer resolves to the sync server's own port on this host, or to
 * NEXT_PUBLIC_SYNC_URL when set (use that behind a reverse proxy that routes /sync).
 */
export function resolveSyncUrl(url: string, page: Location | URL = window.location): string {
  const override = process.env.NEXT_PUBLIC_SYNC_URL?.trim() || undefined; // an empty value means "not set"
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
  const base = isAbsolute ? url : (override ?? `${page.protocol === "https:" ? "wss:" : "ws:"}//${page.hostname}:1234`);
  const resolved = new URL(base, page instanceof URL ? page.href : page.href);
  if (resolved.protocol === "http:") resolved.protocol = "ws:";
  if (resolved.protocol === "https:") resolved.protocol = "wss:";
  return resolved.toString().replace(/\/$/, "");
}

/**
 * Open a live Yjs session for one doc or sheet.
 * Tickets live 60 seconds, so every (re)connect asks the API for a fresh one; the API re-checks
 * membership each time.
 */
export function useCollab(fileId: string): Collab {
  const [state, setState] = useState<{ fileId: string; session: CollabSession | null; status: CollabStatus; synced: boolean; error: string | null }>(
    { fileId, session: null, status: "connecting", synced: false, error: null },
  );

  useEffect(() => {
    let cancelled = false;
    let provider: HocuspocusProvider | undefined;
    const doc = new Y.Doc();
    const patch = (p: Partial<typeof state>) => !cancelled && setState((s) => (s.fileId === fileId ? { ...s, ...p } : { fileId, session: null, status: "connecting", synced: false, error: null, ...p }));

    void (async () => {
      try {
        let unused: Ticket | null = await fetchTicket(fileId);
        if (cancelled) return;
        const first = unused;
        provider = new HocuspocusProvider({
          url: resolveSyncUrl(first.url),
          name: fileId,
          document: doc,
          token: async () => {
            const t = unused ?? (await fetchTicket(fileId));
            unused = null;
            return t.ticket;
          },
          onStatus: ({ status }) => patch({ status: status as CollabStatus }),
          onSynced: () => patch({ synced: true }),
          onAuthenticationFailed: () => patch({ error: "The server refused this session. Reload the page to try again." }),
        });
        patch({ session: { fileId, doc, provider, readOnly: first.read_only, user: { name: first.name } } });
      } catch (err) {
        patch({ error: err instanceof Error ? err.message : "Could not open the file" });
      }
    })();

    return () => {
      cancelled = true;
      provider?.destroy();
      doc.destroy();
    };
  }, [fileId]);

  // A result that belongs to a previous file reads as "connecting".
  return state.fileId === fileId ? state : { session: null, status: "connecting", synced: false, error: null };
}
