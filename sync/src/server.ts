import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import pg from "pg";
import { verifyTicket, type Role, type TicketClaims } from "./auth.ts";

export interface SyncOptions {
  port: number;
  /** Shared with the API, which mints the tickets this server verifies. */
  ticketSecret: string;
  databaseUrl: string;
  /** Milliseconds of quiet before a changed document is written to Postgres. */
  debounce?: number;
  stopOnSignals?: boolean;
  /** Largest single WebSocket message (a Yjs update, an initial sync, an awareness frame) in bytes.
   * Bigger frames make the `ws` library close the connection with 1009 before anything is parsed.
   * This bounds one update, not the total document. Default 8 MiB; the `ws` default is 100 MiB. */
  maxMessageBytes?: number;
  /** Connections (tabs) allowed on one document at a time; the next one is refused. 0 = no limit. */
  maxConnectionsPerDocument?: number;
  /** Look the user up in Postgres (membership of the file's workspace, file not soft-deleted) on every
   * connect and use that role instead of the one in the ticket. `optionsFromEnv` turns this on. */
  checkMembership?: boolean;
  /** With checkMembership: how often open connections are re-checked, in ms. A removed member or a
   * demoted editor is disconnected (and reconnects read-only or not at all). 0 = never. */
  revalidateMs?: number;
}

export const DEFAULT_REVALIDATE_MS = 30_000;
const ROLE_RANK = { viewer: 0, editor: 1, owner: 2 } as const;

export const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_CONNECTIONS_PER_DOCUMENT = 50;

const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Hocuspocus server for docs and sheets. Document name = file id.
 * - Join: the client presents a short-lived ticket from the API; the API has already checked
 *   workspace membership, so this server holds no authorization logic beyond verifying it.
 * - Viewers connect read-only: Hocuspocus drops their updates before they reach the document.
 * - Persistence: the whole Yjs state per file in `doc_states` (the only table touched here).
 */
export function createServer(options: SyncOptions): Server {
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 5 });
  // Without a listener, an idle-connection error (e.g. Postgres restarting) would crash the process.
  pool.on("error", (err) => console.error("sync: postgres pool error", (err as { code?: string }).code ?? ""));

  const maxConnections = options.maxConnectionsPerDocument ?? DEFAULT_MAX_CONNECTIONS_PER_DOCUMENT;

  const checkMembership = options.checkMembership ?? false;

  /** The user's current role on the file's workspace, or null if not a member / file deleted. */
  async function currentRole(userId: string, fileId: string): Promise<Role | null> {
    const { rows } = await pool.query<{ role: Role }>(
      `select m.role::text as role from files f
         join memberships m on m.workspace_id = f.workspace_id and m.user_id = $2
        where f.id = $1 and f.deleted_at is null`,
      [fileId, userId],
    );
    return rows[0]?.role ?? null;
  }

  let timer: NodeJS.Timeout | undefined;

  const server = new Server(
    {
      port: options.port,
      address: "0.0.0.0",
      quiet: true,
      debounce: options.debounce ?? 2000,
      maxDebounce: 10_000,
      stopOnSignals: options.stopOnSignals ?? true, // SIGTERM/SIGINT: flush documents, then exit

      // Runs before authentication, so it also bounds what an unauthenticated peer can hold open.
      async onConnect({ documentName, instance }) {
        const open = instance.documents.get(documentName)?.getConnectionsCount() ?? 0;
        if (maxConnections > 0 && open >= maxConnections) throw new Error("too many connections to this document");
      },

      async onAuthenticate({ token, documentName, connectionConfig }) {
        // A throw rejects the connection. The message never includes the token.
        const claims = verifyTicket(token, documentName, options.ticketSecret);
        if (checkMembership) {
          // The ticket was valid when minted (<= 60 s ago); the database is authoritative now.
          const role = await currentRole(claims.userId, documentName);
          if (role === null) throw new Error("no longer a member of this file");
          claims.role = role;
        }
        if (claims.role === "viewer") connectionConfig.readOnly = true;
        return { user: claims };
      },

      extensions: [
        new Database({
          async fetch({ documentName }) {
            const { rows } = await pool.query<{ state: Buffer }>(
              "select state from doc_states where file_id = $1",
              [documentName],
            );
            return rows[0]?.state ?? null;
          },
          async store({ documentName, state }) {
            try {
              await pool.query(
                `insert into doc_states (file_id, state, updated_at) values ($1, $2, now())
                 on conflict (file_id) do update set state = excluded.state, updated_at = now()`,
                [documentName, state],
              );
            } catch (err) {
              // The files row is gone (hard-deleted workspace): nothing to attach the state to.
              if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) return;
              throw err;
            }
          },
        }),
      ],

      async onDestroy() {
        clearInterval(timer);
        await pool.end();
      },
    },
    { maxPayload: options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES },
  );

  /** Close connections whose user was removed or demoted since they connected. */
  async function revalidate(): Promise<void> {
    const open = [...server.hocuspocus.documents.values()].flatMap((doc) =>
      [...doc.connections.values()].map(({ connection }) => ({ doc, connection })),
    );
    for (const { doc, connection } of open) {
      const claims = (connection.context as { user?: TicketClaims } | undefined)?.user;
      if (!claims) continue;
      try {
        const role = await currentRole(claims.userId, doc.name);
        if (role === null || ROLE_RANK[role] < ROLE_RANK[claims.role]) {
          connection.close({ code: 4403, reason: "Forbidden" });
        }
      } catch (err) {
        console.error("sync: membership re-check failed", (err as { code?: string }).code ?? "");
      }
    }
  }

  const everyMs = options.revalidateMs ?? 0;
  if (checkMembership && everyMs > 0) {
    timer = setInterval(() => void revalidate(), everyMs);
    timer.unref();
  }
  return server;
}

function nonNegativeInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function positiveInt(raw: string | undefined, name: string, fallback: number): number {
  const n = nonNegativeInt(raw, name, fallback);
  if (n === 0) throw new Error(`${name} must be greater than 0`);
  return n;
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): SyncOptions {
  const ticketSecret = env.WS_TICKET_SECRET ?? "";
  if (ticketSecret.length < 32) throw new Error("WS_TICKET_SECRET must be set (at least 32 characters)");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  return {
    port: Number(env.PORT ?? 1234),
    ticketSecret,
    databaseUrl: env.DATABASE_URL,
    // Production path: always look the user up; MEMBERSHIP_CHECK=0 is only for debugging.
    checkMembership: env.MEMBERSHIP_CHECK !== "0",
    revalidateMs: nonNegativeInt(env.REVALIDATE_SECONDS, "REVALIDATE_SECONDS", DEFAULT_REVALIDATE_MS / 1000) * 1000,
    maxMessageBytes: positiveInt(env.MAX_MESSAGE_BYTES, "MAX_MESSAGE_BYTES", DEFAULT_MAX_MESSAGE_BYTES),
    maxConnectionsPerDocument: nonNegativeInt(
      env.MAX_CONNECTIONS_PER_DOC,
      "MAX_CONNECTIONS_PER_DOC",
      DEFAULT_MAX_CONNECTIONS_PER_DOCUMENT,
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer(optionsFromEnv());
  await server.listen();
  console.log(`sync listening on :${server.configuration.port}`);
}
