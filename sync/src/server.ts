import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import pg from "pg";
import { verifyTicket } from "./auth.ts";

export interface SyncOptions {
  port: number;
  /** Shared with the API, which mints the tickets this server verifies. */
  ticketSecret: string;
  databaseUrl: string;
  /** Milliseconds of quiet before a changed document is written to Postgres. */
  debounce?: number;
  stopOnSignals?: boolean;
}

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

  return new Server({
    port: options.port,
    address: "0.0.0.0",
    quiet: true,
    debounce: options.debounce ?? 2000,
    maxDebounce: 10_000,
    stopOnSignals: options.stopOnSignals ?? true, // SIGTERM/SIGINT: flush documents, then exit

    async onAuthenticate({ token, documentName, connectionConfig }) {
      // A throw rejects the connection. The message never includes the token.
      const claims = verifyTicket(token, documentName, options.ticketSecret);
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
      await pool.end();
    },
  });
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): SyncOptions {
  const ticketSecret = env.WS_TICKET_SECRET ?? "";
  if (ticketSecret.length < 32) throw new Error("WS_TICKET_SECRET must be set (at least 32 characters)");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  return { port: Number(env.PORT ?? 1234), ticketSecret, databaseUrl: env.DATABASE_URL };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer(optionsFromEnv());
  await server.listen();
  console.log(`sync listening on :${server.configuration.port}`);
}
