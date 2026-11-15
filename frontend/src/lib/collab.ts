import { useEffect, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { api } from "../api/client";

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
  user: { name: string; color: string };
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

/** The API returns a path ("/sync") or an absolute URL; resolve it against the page as ws(s)://. */
export function resolveSyncUrl(url: string, pageUrl: string = window.location.href): string {
  const resolved = new URL(url, pageUrl);
  if (resolved.protocol === "http:") resolved.protocol = "ws:";
  if (resolved.protocol === "https:") resolved.protocol = "wss:";
  return resolved.toString();
}

/**
 * Open a live Yjs session for one doc or sheet.
 * Tickets live 60 seconds, so every (re)connect asks the API for a fresh one; the API
 * re-checks membership each time.
 */
export function useCollab(fileId: string): Collab {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let provider: HocuspocusProvider | undefined;
    const doc = new Y.Doc();

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
          onStatus: ({ status }) => !cancelled && setStatus(status as CollabStatus),
          onSynced: () => !cancelled && setSynced(true),
          onAuthenticationFailed: () =>
            !cancelled && setError("The server refused this session. Reload the page to try again."),
        });
        setSession({
          fileId,
          doc,
          provider,
          readOnly: first.read_only,
          user: { name: first.name, color: first.color },
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open the file");
      }
    })();

    return () => {
      cancelled = true;
      provider?.destroy();
      doc.destroy();
      setSession(null);
      setSynced(false);
      setStatus("connecting");
      setError(null);
    };
  }, [fileId]);

  return { session, status, synced, error };
}
