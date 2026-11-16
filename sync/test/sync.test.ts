import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import type { Server } from "@hocuspocus/server";
import type pg from "pg";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { createServer, optionsFromEnv, type SyncOptions } from "../src/server.ts";
import {
  closeClients,
  connect,
  connected,
  DATABASE_URL,
  mulberry32,
  prepareDatabase,
  SECRET,
  seedFile,
  sleep,
  snapshot,
  ticket,
  waitFor,
  wsUrl,
} from "./helpers.ts";

let pool: pg.Pool;
let server: Server;

async function startServer(limits: Partial<SyncOptions> = {}): Promise<Server> {
  const s = createServer({
    port: 0,
    ticketSecret: SECRET,
    databaseUrl: DATABASE_URL,
    debounce: 40,
    stopOnSignals: false,
    ...limits,
  });
  await s.listen();
  return s;
}

const serverDoc = (fileId: string) => server.hocuspocus.documents.get(fileId);

async function storedText(fileId: string): Promise<string | null> {
  const { rows } = await pool.query("select state from doc_states where file_id = $1", [fileId]);
  if (rows.length === 0) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, rows[0].state);
  return doc.getText("t").toString();
}

before(async () => {
  pool = await prepareDatabase();
  server = await startServer();
});
afterEach(closeClients);
after(async () => {
  closeClients();
  await server.destroy();
  await pool.end();
});

test("three clients making random concurrent edits converge to identical replicas", async () => {
  const seed = Number(process.env.SEED ?? Math.floor(Math.random() * 2 ** 31));
  const rand = mulberry32(seed);
  const fileId = await seedFile(pool);
  const clients = await Promise.all([1, 2, 3].map(() => connected(server, fileId, "editor")));

  await Promise.all(
    clients.map(async ({ doc }, i) => {
      const text = doc.getText("t");
      const cells = doc.getMap<string>("cells");
      for (let n = 0; n < 80; n++) {
        const r = rand();
        if (r < 0.5) {
          text.insert(Math.floor(rand() * (text.length + 1)), `${i}${n} `);
        } else if (r < 0.75 && text.length > 0) {
          const at = Math.floor(rand() * text.length);
          text.delete(at, Math.min(1 + Math.floor(rand() * 4), text.length - at));
        } else {
          // Few distinct keys on purpose: forces concurrent writes to the same cell.
          cells.set(`${"AB"[Math.floor(rand() * 2)]}${1 + Math.floor(rand() * 3)}`, `c${i}-${n}`);
        }
        if (rand() < 0.4) await sleep(rand() * 6); // interleave with the other clients
      }
    }),
  );

  const replicas = () => [...clients.map((c) => c.doc), serverDoc(fileId)!];
  await waitFor(
    () => new Set(replicas().map(snapshot)).size === 1,
    `replicas to converge (replay with SEED=${seed})`,
  );
  const [first] = clients;
  assert.ok(first.doc.getText("t").length > 0, "the run actually produced text");
  assert.ok(first.doc.getMap("cells").size > 0, "the run actually produced cells");
});

test("a client that edits while disconnected converges after reconnecting", async () => {
  const fileId = await seedFile(pool);
  const [a, b] = await Promise.all([connected(server, fileId, "editor"), connected(server, fileId, "owner")]);
  a.doc.getText("t").insert(0, "base ");
  await waitFor(() => b.doc.getText("t").toString() === "base ", "b to receive the base text");

  b.provider.disconnect();
  // connect() is a no-op until the socket has really closed, so wait for that.
  const socket = b.provider.configuration.websocketProvider;
  await waitFor(() => socket.status === "disconnected", "b to go offline");
  b.doc.getText("t").insert(0, "offline ");
  a.doc.getText("t").insert(5, "online ");
  await b.provider.connect();

  await waitFor(
    () => new Set([a.doc, b.doc, serverDoc(fileId)!].map(snapshot)).size === 1,
    "replicas to converge after reconnect",
    5000,
    () => [a.doc, b.doc, serverDoc(fileId)!].map(snapshot).join("\n"),
  );
  const merged = a.doc.getText("t").toString();
  assert.ok(merged.includes("offline ") && merged.includes("online ") && merged.includes("base "), merged);
});

test("a viewer receives live updates but its own edits are not applied", async () => {
  const fileId = await seedFile(pool);
  const editor = await connected(server, fileId, "editor");
  const viewer = await connected(server, fileId, "viewer");

  editor.doc.getText("t").insert(0, "from editor");
  await waitFor(() => viewer.doc.getText("t").toString() === "from editor", "viewer to see the edit");

  viewer.doc.getText("t").insert(0, "VIEWER WAS HERE ");
  viewer.doc.getMap("cells").set("A1", "viewer");
  await sleep(300); // generous: an accepted update would arrive within a few ms

  for (const replica of [serverDoc(fileId)!, editor.doc]) {
    assert.equal(replica.getText("t").toString(), "from editor");
    assert.equal(replica.getMap("cells").size, 0);
  }

  // The viewer keeps receiving, and nothing it wrote ever reaches storage.
  editor.doc.getText("t").insert(11, "!");
  await waitFor(() => viewer.doc.getText("t").toString().endsWith("from editor!"), "viewer to keep receiving");
  await waitFor(async () => (await storedText(fileId)) === "from editor!", "state to be stored");
});

test("connections without a valid ticket for this file are rejected", async () => {
  const fileId = await seedFile(pool);
  const otherFile = await seedFile(pool);
  const cases: Record<string, string> = {
    "wrong secret": ticket(fileId, "editor", { secret: "another-secret-0123456789abcdefghij" }),
    expired: ticket(fileId, "editor", { expiresIn: -5 }),
    "ticket for another file": ticket(otherFile, "owner"),
    "wrong audience": ticket(fileId, "editor", { audience: "coedit-session" }),
    garbage: "not-a-jwt",
  };
  for (const [label, token] of Object.entries(cases)) {
    const client = connect(server, fileId, token);
    await waitFor(() => client.status() === "rejected", `rejection of: ${label}`);
    client.doc.getText("t").insert(0, "intruder");
  }
  await sleep(200);
  assert.equal(serverDoc(fileId), undefined, "no document was opened for rejected clients");
  assert.equal(await storedText(fileId), null, "nothing was stored");

  // The same file still works for a properly ticketed client, and holds none of the intruder text.
  const ok = await connected(server, fileId, "editor");
  assert.equal(ok.doc.getText("t").toString(), "");
});

test("document state survives a server restart", async () => {
  const fileId = await seedFile(pool);
  const writer = await connected(server, fileId, "editor");
  writer.doc.getText("t").insert(0, "persist me");
  writer.doc.getMap("cells").set("A1", "=SUM(B1:B2)");
  await waitFor(async () => (await storedText(fileId)) === "persist me", "debounced store");

  // An edit made right before shutdown must be flushed by the shutdown itself.
  writer.doc.getText("t").insert(10, " please");
  await waitFor(() => serverDoc(fileId)?.getText("t").toString() === "persist me please", "server to get the edit");
  closeClients();
  await server.destroy();
  assert.equal(await storedText(fileId), "persist me please");

  server = await startServer();
  const reader = await connected(server, fileId, "viewer");
  assert.equal(reader.doc.getText("t").toString(), "persist me please");
  assert.equal(reader.doc.getMap("cells").get("A1"), "=SUM(B1:B2)");
});

test("state for a file that no longer exists is dropped, not crashed on", async () => {
  const ghost = randomUUID(); // valid ticket, but no files row: the FK must hold
  const client = await connected(server, ghost, "editor");
  client.doc.getText("t").insert(0, "orphan");
  await sleep(250);
  assert.equal(await storedText(ghost), null);
  const fileId = await seedFile(pool); // and the server is still healthy afterwards
  const ok = await connected(server, fileId, "editor");
  ok.doc.getText("t").insert(0, "fine");
  await waitFor(async () => (await storedText(fileId)) === "fine", "store after FK failure");
});

test("a document accepts at most maxConnectionsPerDocument connections, and frees a slot on close", async () => {
  const limited = await startServer({ maxConnectionsPerDocument: 2 });
  try {
    const fileId = await seedFile(pool);
    const a = await connected(limited, fileId, "editor");
    await connected(limited, fileId, "viewer");
    const third = connect(limited, fileId, ticket(fileId, "editor"));
    await sleep(500);
    assert.notEqual(third.status(), "synced", "third connection must not sync");
    assert.equal(limited.hocuspocus.documents.get(fileId)?.getConnectionsCount(), 2);
    // Another document is unaffected by this document's limit.
    const other = await seedFile(pool);
    await connected(limited, other, "editor");
    // Closing one frees a slot.
    a.provider.destroy();
    await waitFor(() => limited.hocuspocus.documents.get(fileId)?.getConnectionsCount() === 1, "slot to free");
    await connected(limited, fileId, "editor");
  } finally {
    closeClients();
    await limited.destroy();
  }
});

test("a frame larger than maxMessageBytes closes the connection with 1009; normal edits still work", async () => {
  const limited = await startServer({ maxMessageBytes: 64 * 1024 });
  try {
    const fileId = await seedFile(pool);
    const small = await connected(limited, fileId, "editor");
    // A raw socket, not a provider: the provider would reconnect and resend the oversized state.
    const raw = new WebSocket(wsUrl(limited));
    const closeCode = await new Promise<number>((resolve, reject) => {
      raw.on("error", () => {}); // the close event carries the outcome
      raw.on("open", () => raw.send(Buffer.alloc(200 * 1024, 1)));
      raw.on("close", (code) => resolve(code));
      setTimeout(() => reject(new Error("socket was not closed")), 5000);
    });
    assert.equal(closeCode, 1009, "ws closes with 1009 (message too big)");
    // A frame under the limit is accepted (it is not valid protocol data, but it is not size-rejected).
    small.doc.getText("t").insert(0, "ok");
    await waitFor(() => limited.hocuspocus.documents.get(fileId)?.getText("t").toString() === "ok", "small edit");
  } finally {
    closeClients();
    await limited.destroy();
  }
});

test("limits come from MAX_MESSAGE_BYTES / MAX_CONNECTIONS_PER_DOC and reject bad values", () => {
  const base = { WS_TICKET_SECRET: "x".repeat(32), DATABASE_URL: "postgres://x" };
  const dflt = optionsFromEnv(base);
  assert.equal(dflt.maxMessageBytes, 8 * 1024 * 1024);
  assert.equal(dflt.maxConnectionsPerDocument, 50);
  const set = optionsFromEnv({ ...base, MAX_MESSAGE_BYTES: "1048576", MAX_CONNECTIONS_PER_DOC: "0" });
  assert.equal(set.maxMessageBytes, 1048576);
  assert.equal(set.maxConnectionsPerDocument, 0);
  assert.throws(() => optionsFromEnv({ ...base, MAX_MESSAGE_BYTES: "0" }));
  assert.throws(() => optionsFromEnv({ ...base, MAX_MESSAGE_BYTES: "lots" }));
  assert.throws(() => optionsFromEnv({ ...base, MAX_CONNECTIONS_PER_DOC: "-1" }));
});
