import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, optionsFromEnv } from "../src/server.ts";

const options = {
  port: 0,
  ticketSecret: "health-test-secret-0123456789abcdefgh",
  databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused", // the pool connects lazily
  stopOnSignals: false,
};

test("sync server starts and answers HTTP", async () => {
  const server = createServer(options);
  await server.listen();
  try {
    const res = await fetch(server.httpURL);
    assert.equal(res.status, 200);
  } finally {
    await server.destroy();
  }
});

test("refuses to start without a strong ticket secret or a database URL", () => {
  assert.throws(() => optionsFromEnv({ DATABASE_URL: "postgres://x" }), /WS_TICKET_SECRET/);
  assert.throws(() => optionsFromEnv({ WS_TICKET_SECRET: "short", DATABASE_URL: "postgres://x" }), /WS_TICKET_SECRET/);
  assert.throws(() => optionsFromEnv({ WS_TICKET_SECRET: "s".repeat(32) }), /DATABASE_URL/);
  assert.equal(optionsFromEnv({ WS_TICKET_SECRET: "s".repeat(32), DATABASE_URL: "postgres://x", PORT: "4321" }).port, 4321);
});
