/**
 * End-to-end smoke test against a RUNNING stack (default: the compose stack via the web proxy).
 * Real API tickets, real WebSocket through /sync: owner writes, viewer reads and is blocked.
 *   npx tsx scripts/smoke.ts            # write + verify
 *   npx tsx scripts/smoke.ts <state>    # internal: second phase after a sync restart
 * Creates throwaway users named smoke-*@example.com.
 */
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const ORIGIN = process.env.ORIGIN ?? "http://localhost:5173";
/** The API says "/sync" (a path); Next cannot proxy WebSockets, so go to the sync server directly. */
const syncUrl = (u: string) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : (process.env.SYNC_URL ?? "ws://localhost:1234"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Session {
  cookie = "";
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${ORIGIN}/api${path}`, {
      method,
      headers: { "X-Requested-With": "coedit", "Content-Type": "application/json", Cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie()[0];
    if (setCookie) this.cookie = setCookie.split(";")[0];
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
}

async function open(session: Session, fileId: string) {
  const t = await session.call<{ ticket: string; url: string; read_only: boolean }>("POST", `/files/${fileId}/ws-ticket`);
  const url = syncUrl(t.url);
  const doc = new Y.Doc();
  let synced = false;
  const provider = new HocuspocusProvider({ url, name: fileId, token: t.ticket, document: doc, onSynced: () => (synced = true) });
  for (let i = 0; i < 200 && !synced; i++) await sleep(25);
  if (!synced) throw new Error(`could not sync via ${url}`);
  return { doc, provider, readOnly: t.read_only };
}

function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}

const password = "smoke-pass-" + Math.random().toString(36).slice(2);
const stamp = Date.now();

if (process.argv[2]) {
  // Phase 2: a fresh login reads back what phase 1 wrote, after the sync container restarted.
  const { email, pw, fileId, expected } = JSON.parse(Buffer.from(process.argv[2], "base64").toString());
  const owner = new Session();
  await owner.call("POST", "/auth/login", { email, password: pw });
  const o = await open(owner, fileId);
  check(o.doc.getText("t").toString() === expected, `state survived restart ("${expected}")`);
  o.provider.destroy();
} else {
  const owner = new Session();
  const viewer = new Session();
  const ownerEmail = `smoke-owner-${stamp}@example.com`;
  const viewerEmail = `smoke-viewer-${stamp}@example.com`;
  await owner.call("POST", "/auth/register", { email: ownerEmail, password, display_name: "Smoke Owner" });
  await viewer.call("POST", "/auth/register", { email: viewerEmail, password, display_name: "Smoke Viewer" });
  const ws = await owner.call<{ id: string }>("POST", "/workspaces", { name: "Smoke" });
  await owner.call("POST", `/workspaces/${ws.id}/members`, { email: viewerEmail, role: "viewer" });
  const file = await owner.call<{ id: string }>("POST", `/workspaces/${ws.id}/files`, { name: "Smoke doc", kind: "doc" });

  const o = await open(owner, file.id);
  const v = await open(viewer, file.id);
  check(!o.readOnly && v.readOnly, "API marks the viewer ticket read-only");

  o.doc.getText("t").insert(0, "hello from owner");
  for (let i = 0; i < 80 && v.doc.getText("t").toString() !== "hello from owner"; i++) await sleep(25);
  check(v.doc.getText("t").toString() === "hello from owner", "viewer receives the owner's edit through /sync");

  v.doc.getText("t").insert(0, "VIEWER ");
  await sleep(500);
  check(o.doc.getText("t").toString() === "hello from owner", "viewer's edit is not applied for the owner");

  o.provider.destroy();
  v.provider.destroy();
  const state = { email: ownerEmail, pw: password, fileId: file.id, expected: "hello from owner" };
  console.log("STATE " + Buffer.from(JSON.stringify(state)).toString("base64"));
}
