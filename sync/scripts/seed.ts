/**
 * Demo data for a RUNNING stack: three users (owner, editor, viewer), a shared workspace,
 * and a sample doc and sheet with content. Safe to run twice (existing users are reused; a
 * workspace named "Demo" owned by the owner is reused).
 *
 *   make seed SEED_PASSWORD=<at least 8 characters>      # runs inside the sync container
 *   ... scripts/seed.ts --verify                          # only read the data back, as the viewer
 *
 * Users: owner@example.com, editor@example.com, viewer@example.com — all with SEED_PASSWORD.
 */
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const API = process.env.API_ORIGIN ?? process.env.ORIGIN ?? "http://localhost:5173";
const SYNC_URL = process.env.SYNC_URL; // default: the ticket's url resolved against API
const password = process.env.SEED_PASSWORD ?? "";
if (password.length < 8) {
  console.error("Set SEED_PASSWORD (at least 8 characters), e.g. make seed SEED_PASSWORD=...");
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Session {
  cookie = "";
  async call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "X-Requested-With": "coedit", "Content-Type": "application/json", Cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie()[0];
    if (setCookie) this.cookie = setCookie.split(";")[0];
    if (!res.ok && !okStatuses.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status}`);
    return (res.status === 204 || !res.ok ? undefined : await res.json()) as T;
  }
}

async function user(email: string, name: string): Promise<Session> {
  const s = new Session();
  await s.call("POST", "/auth/register", { email, password, display_name: name }, [409]);
  await s.call("POST", "/auth/login", { email, password }); // also covers "already existed"
  return s;
}

/** Open a file's shared document, run `use` on it once loaded, and wait for any writes to be sent. */
async function edit(session: Session, fileId: string, write: (doc: Y.Doc) => void): Promise<void> {
  const t = await session.call<{ ticket: string; url: string }>("POST", `/files/${fileId}/ws-ticket`);
  const url = SYNC_URL ?? new URL(t.url, API.replace(/^http/, "ws")).toString();
  const doc = new Y.Doc();
  let synced = false;
  const provider = new HocuspocusProvider({ url, name: fileId, token: t.ticket, document: doc, onSynced: () => (synced = true) });
  for (let i = 0; i < 400 && !synced; i++) await sleep(25);
  if (!synced) throw new Error(`could not reach the sync server at ${url}`);
  doc.transact(() => write(doc));
  for (let i = 0; i < 200 && provider.hasUnsyncedChanges; i++) await sleep(25);
  await sleep(300);
  provider.destroy();
}

function block(type: string, text: string, attrs: Record<string, string | number> = {}): Y.XmlElement {
  const el = new Y.XmlElement(type);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v as string);
  el.insert(0, [new Y.XmlText(text)]);
  return el;
}

if (process.argv.includes("--verify")) {
  const viewer = new Session();
  await viewer.call("POST", "/auth/login", { email: "viewer@example.com", password });
  const [demo] = await viewer.call<{ id: string; role: string }[]>("GET", "/workspaces");
  const { files } = await viewer.call<{ files: { id: string; name: string }[] }>("GET", `/workspaces/${demo.id}/tree`);
  const id = (name: string) => files.find((f) => f.name === name)!.id;
  let heading = "";
  let cells: Record<string, string> = {};
  await edit(viewer, id("Welcome"), (d) => (heading = d.getXmlFragment("default").get(0)?.toString() ?? ""));
  await edit(viewer, id("Budget"), (d) => (cells = d.getMap<string>("cells").toJSON()));
  const ok = demo.role === "viewer" && heading.includes("Welcome to coedit") && cells.D5 === "=SUM(D2:D4)";
  console.log(`${ok ? "PASS" : "FAIL"}  viewer reads seeded doc and sheet (role=${demo.role}, ${Object.keys(cells).length} cells)`);
  process.exit(ok ? 0 : 1);
}

const owner = await user("owner@example.com", "Olivia Owner");
await user("editor@example.com", "Eli Editor");
await user("viewer@example.com", "Vera Viewer");

const mine = await owner.call<{ id: string; name: string; role: string }[]>("GET", "/workspaces");
const ws =
  mine.find((w) => w.name === "Demo" && w.role === "owner") ??
  (await owner.call<{ id: string }>("POST", "/workspaces", { name: "Demo" }));
for (const [email, role] of [["editor@example.com", "editor"], ["viewer@example.com", "viewer"]]) {
  await owner.call("POST", `/workspaces/${ws.id}/members`, { email, role }, [409]);
}

const tree = await owner.call<{ folders: { id: string; name: string }[]; files: { name: string }[] }>(
  "GET",
  `/workspaces/${ws.id}/tree`,
);
if (tree.files.some((f) => f.name === "Welcome")) {
  console.log(`Demo workspace already seeded: ${ws.id}`);
} else {
  const folder =
    tree.folders.find((f) => f.name === "Handoff") ??
    (await owner.call<{ id: string }>("POST", `/workspaces/${ws.id}/folders`, { name: "Handoff" }));
  const doc = await owner.call<{ id: string }>("POST", `/workspaces/${ws.id}/files`, { name: "Welcome", kind: "doc" });
  const sheet = await owner.call<{ id: string }>("POST", `/workspaces/${ws.id}/files`, { name: "Budget", kind: "sheet" });

  await edit(owner, doc.id, (d) => {
    d.getXmlFragment("default").push([
      block("heading", "Welcome to coedit", { level: 1 }),
      block("paragraph", "Open this document in two browsers as two different users and type: each sees the other's caret."),
      block("heading", "Try next", { level: 2 }),
      block("paragraph", "Edit the Budget sheet, upload a file twice, then run the AI council into the Handoff folder."),
    ]);
  });
  await edit(owner, sheet.id, (d) => {
    const cells = d.getMap<string>("cells");
    const rows = [
      ["Item", "Qty", "Unit price", "Total"],
      ["Laptops", "3", "1200", "=B2*C2"],
      ["Monitors", "6", "250", "=B3*C3"],
      ["Licences", "10", "49.5", "=B4*C4"],
      ["Sum", "=SUM(B2:B4)", "", "=SUM(D2:D4)"],
      ["Average line", "", "", "=AVERAGE(D2:D4)"],
    ];
    rows.forEach((row, r) => row.forEach((value, c) => value && cells.set(`${"ABCD"[c]}${r + 1}`, value)));
  });
  console.log(`Seeded workspace "Demo" (${ws.id}) with a doc, a sheet and folder ${folder.id}.`);
}
console.log("Users: owner@example.com, editor@example.com, viewer@example.com (password = SEED_PASSWORD)");
