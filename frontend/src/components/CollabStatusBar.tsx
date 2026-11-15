import type { Collab } from "../lib/collab";

/** One-line connection state shared by the doc and sheet editors. */
export function CollabStatusBar({ collab }: { collab: Collab }) {
  const { session, status, synced } = collab;
  const live = status === "connected" && synced;
  const label = live ? "Live" : status === "disconnected" ? "Offline — reconnecting…" : "Connecting…";
  return (
    <div className="collab-status">
      <span className={`dot ${live ? "ok" : "wait"}`} aria-hidden />
      <span role="status">{label}</span>
      {session?.readOnly && <span className="badge">View only</span>}
      {!live && session && !session.readOnly && (
        <span className="muted">Changes you make now are sent when the connection returns.</span>
      )}
    </div>
  );
}
