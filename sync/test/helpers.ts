import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HocuspocusProvider } from "@hocuspocus/provider";
import jwt from "jsonwebtoken";
import pg from "pg";
import * as Y from "yjs";
import type { Server } from "@hocuspocus/server";
import { TICKET_AUDIENCE } from "../src/auth.ts";

export const SECRET = "test-ws-ticket-secret-0123456789abcdef";

// Fall back to the repo's .env (written by `make env`) so tests reach the compose database without
// exporting anything; the password is only ever put in a connection string, never printed.
function fromDotenv(key: string): string | undefined {
  try {
    const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}
const user = process.env.POSTGRES_USER ?? fromDotenv("POSTGRES_USER") ?? "coedit";
const password = process.env.POSTGRES_PASSWORD ?? fromDotenv("POSTGRES_PASSWORD") ?? "coedit";
const port = process.env.DB_PORT ?? fromDotenv("DB_PORT") ?? "5433";
const TEST_DB = "coedit_sync_test";
const base = `${user}:${password}@localhost:${port}`;
export const DATABASE_URL = `postgres://${base}/${TEST_DB}`;

/** Create the sync test database if needed and bring it to the API's current schema, so the
 * tests run against the real `doc_states` table and its foreign key to `files`. */
export async function prepareDatabase(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: `postgres://${base}/${process.env.POSTGRES_DB ?? "coedit"}` });
  await admin.connect();
  try {
    const found = await admin.query("select 1 from pg_database where datname = $1", [TEST_DB]);
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end();
  }
  execFileSync("uv", ["run", "alembic", "upgrade", "head"], {
    cwd: fileURLToPath(new URL("../../backend", import.meta.url)),
    env: {
      APP_SECRET: "sync-test-app-secret-0123456789abcdef",
      WS_TICKET_SECRET: SECRET,
      KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      ...process.env,
      DATABASE_URL: `postgresql+asyncpg://${base}/${TEST_DB}`,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
}

/** Insert a user, workspace and doc file; returns the file id (= Hocuspocus document name). */
export async function seedFile(pool: pg.Pool): Promise<string> {
  const [userId, workspaceId, fileId] = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(
    "insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', 'Sync Test')",
    [userId, `sync-${userId}@example.com`],
  );
  await pool.query("insert into workspaces (id, name, owner_id) values ($1, 'Sync', $2)", [workspaceId, userId]);
  await pool.query(
    "insert into files (id, workspace_id, name, kind, created_by) values ($1, $2, 'Doc', 'doc', $3)",
    [fileId, workspaceId, userId],
  );
  return fileId;
}

export function ticket(
  fileId: string,
  role: "owner" | "editor" | "viewer",
  overrides: { secret?: string; expiresIn?: number; audience?: string; sub?: string } = {},
): string {
  return jwt.sign(
    { sub: overrides.sub ?? randomUUID(), file_id: fileId, role, name: `${role} user`, color: "#1f5f4a" },
    overrides.secret ?? SECRET,
    { algorithm: "HS256", expiresIn: overrides.expiresIn ?? 60, audience: overrides.audience ?? TICKET_AUDIENCE },
  );
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 5000,
  detail: () => string = () => "",
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(15);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what} ${detail()}`.trimEnd());
}

export interface Client {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** "synced" once the first sync finished, "rejected" if authentication failed. */
  status: () => "pending" | "synced" | "rejected";
}

const open: HocuspocusProvider[] = [];

export function wsUrl(server: Server): string {
  return `ws://127.0.0.1:${new URL(server.httpURL).port}`;
}

/** Open a provider with the given token. Does not wait; use `connected` for the happy path. */
export function connect(server: Server, documentName: string, token: string): Client {
  const doc = new Y.Doc();
  let status: "pending" | "synced" | "rejected" = "pending";
  const provider = new HocuspocusProvider({
    url: wsUrl(server),
    name: documentName,
    token,
    document: doc,
    onSynced: () => {
      status = "synced";
    },
    onAuthenticationFailed: () => {
      status = "rejected";
    },
  });
  open.push(provider);
  return { doc, provider, status: () => status };
}

export async function connected(server: Server, fileId: string, role: "owner" | "editor" | "viewer") {
  const client = connect(server, fileId, ticket(fileId, role));
  await waitFor(() => client.status() !== "pending", `${role} to sync`);
  if (client.status() !== "synced") throw new Error(`${role} was rejected`);
  return client;
}

export function closeClients() {
  for (const provider of open.splice(0)) provider.destroy();
}

/** Deterministic PRNG so a failing run can be replayed with SEED=<n>. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything that must be identical across replicas once they have converged. */
export function snapshot(doc: Y.Doc) {
  const vector = [...Y.decodeStateVector(Y.encodeStateVector(doc))].sort(([a], [b]) => a - b);
  // Y.Map iteration order is not canonical across replicas, so sort the entries.
  const cells = Object.entries(doc.getMap("cells").toJSON()).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ text: doc.getText("t").toString(), cells, vector });
}

/** Make a user a member of the workspace that owns `fileId`; returns the user id (the ticket `sub`). */
export async function addMember(pool: pg.Pool, fileId: string, role: "owner" | "editor" | "viewer"): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    "insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', $3)",
    [userId, `member-${userId}@example.com`, `${role} member`],
  );
  await pool.query(
    "insert into memberships (workspace_id, user_id, role) select workspace_id, $2, $3::member_role from files where id = $1",
    [fileId, userId, role],
  );
  return userId;
}
