/**
 * Cross-version check: the sync server runs @hocuspocus/server 3.x, the browser ships
 * @hocuspocus/provider 4.x. Starts the real server (src/server.ts) on a port of its own against the
 * sync test database, then syncs edits between
 *   (a) two 4.x clients, and (b) one 4.x client and one 3.x client,
 * and checks a 4.x viewer is read-only and a bad ticket is rejected.
 *
 * Needs the db container up, `cd sync && npm ci` and `cd frontend && pnpm install` (for 4.x).
 * Run: cd sync && npx tsx scripts/compat-check.ts      Exit 0 = all checks passed.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { HocuspocusProvider as Provider3 } from "@hocuspocus/provider";
import * as Y3 from "yjs";
import { createServer } from "../src/server.ts";
import { DATABASE_URL, prepareDatabase, SECRET, seedFile, ticket, waitFor } from "../test/helpers.ts";

const feRequire = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { HocuspocusProvider: Provider4 } = feRequire("@hocuspocus/provider") as typeof import("@hocuspocus/provider");
const Y4 = feRequire("yjs") as typeof Y3;
// Package.json is not in the packages' export maps, so read it from disk.
const version = (pkg: string, dir: string) =>
  (JSON.parse(readFileSync(fileURLToPath(new URL(`${dir}/node_modules/${pkg}/package.json`, import.meta.url)), "utf8")) as { version: string }).version;
console.log(`server @hocuspocus/server ${version("@hocuspocus/server", "..")}, provider 3.x = ${version("@hocuspocus/provider", "..")}, provider 4.x = ${version("@hocuspocus/provider", "../../frontend")}`);
// The "Yjs was already imported" warning is expected: the 4.x clients use the frontend's yjs copy.
// Clients are isolated documents, so only wire bytes cross between the two copies.

const pool = await prepareDatabase();
const server = createServer({ port: 0, ticketSecret: SECRET, databaseUrl: DATABASE_URL, debounce: 40, stopOnSignals: false });
await server.listen();
const url = `ws://127.0.0.1:${new URL(server.httpURL).port}`;

interface Peer { text: () => string; type: Y3.Text; synced: () => boolean; denied: () => boolean; close: () => void }
function peer(major: 3 | 4, fileId: string, token: string): Peer {
  const [Y, Provider] = major === 4 ? [Y4, Provider4] : [Y3, Provider3];
  const doc = new Y.Doc();
  let synced = false, denied = false;
  const provider = new Provider({ url, name: fileId, token, document: doc as never, onSynced: () => { synced = true; }, onAuthenticationFailed: () => { denied = true; } });
  const type = doc.getText("t") as unknown as Y3.Text;
  return { type, text: () => type.toString(), synced: () => synced, denied: () => denied, close: () => provider.destroy() };
}

let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}: ${(err as Error).message}`); }
}

await check("two 4.x clients converge", async () => {
  const f = await seedFile(pool);
  const a = peer(4, f, ticket(f, "editor")), b = peer(4, f, ticket(f, "editor"));
  await waitFor(() => a.synced() && b.synced(), "4.x clients to sync");
  a.type.insert(0, "from-a;"); b.type.insert(0, "from-b;");
  await waitFor(() => a.text() === b.text() && a.text().includes("from-a;") && a.text().includes("from-b;"), "convergence", 5000, () => `${a.text()} | ${b.text()}`);
  a.close(); b.close();
});

await check("4.x and 3.x clients converge", async () => {
  const f = await seedFile(pool);
  const a = peer(4, f, ticket(f, "editor")), b = peer(3, f, ticket(f, "editor"));
  await waitFor(() => a.synced() && b.synced(), "mixed clients to sync");
  a.type.insert(0, "four;"); b.type.insert(0, "three;");
  await waitFor(() => a.text() === b.text() && a.text().includes("four;") && a.text().includes("three;"), "convergence", 5000, () => `${a.text()} | ${b.text()}`);
  a.close(); b.close();
});

await check("4.x viewer is read-only and sees editor edits", async () => {
  const f = await seedFile(pool);
  const e = peer(4, f, ticket(f, "editor")), w = peer(4, f, ticket(f, "viewer"));
  await waitFor(() => e.synced() && w.synced(), "sync");
  e.type.insert(0, "editor;"); w.type.insert(0, "viewer-attempt;");
  await waitFor(() => w.text().includes("editor;"), "viewer to receive the editor's text");
  await new Promise((r) => setTimeout(r, 300));
  if (e.text().includes("viewer-attempt")) throw new Error("viewer edit reached the editor");
  e.close(); w.close();
});

await check("4.x client with a bad ticket is rejected", async () => {
  const f = await seedFile(pool);
  const bad = peer(4, f, ticket(f, "editor", { secret: "x".repeat(40) }));
  await waitFor(() => bad.denied(), "rejection");
  bad.close();
});

await server.destroy();
await pool.end();
console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
