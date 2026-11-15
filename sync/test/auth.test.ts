import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { TICKET_AUDIENCE, verifyTicket } from "../src/auth.ts";
import { SECRET, ticket } from "./helpers.ts";

const fileId = randomUUID();

test("valid ticket yields its claims", () => {
  const claims = verifyTicket(ticket(fileId, "viewer"), fileId, SECRET);
  assert.equal(claims.fileId, fileId);
  assert.equal(claims.role, "viewer");
  assert.equal(claims.name, "viewer user");
  assert.match(claims.userId, /^[0-9a-f-]{36}$/);
});

test("rejects wrong secret, expiry, other file, other audience and garbage", () => {
  const bad = [
    ticket(fileId, "editor", { secret: "another-secret-0123456789abcdefghij" }),
    ticket(fileId, "editor", { expiresIn: -5 }),
    ticket(randomUUID(), "editor"),
    ticket(fileId, "editor", { audience: "something-else" }),
    "not-a-jwt",
    "",
  ];
  for (const token of bad) assert.throws(() => verifyTicket(token, fileId, SECRET));
});

test("rejects unsigned and wrong-algorithm tokens", () => {
  const payload = { sub: randomUUID(), file_id: fileId, role: "owner", name: "x", color: "#000" };
  const none = jwt.sign(payload, "", { algorithm: "none", audience: TICKET_AUDIENCE, expiresIn: 60 });
  const hs512 = jwt.sign(payload, SECRET, { algorithm: "HS512", audience: TICKET_AUDIENCE, expiresIn: 60 });
  assert.throws(() => verifyTicket(none, fileId, SECRET));
  assert.throws(() => verifyTicket(hs512, fileId, SECRET));
});

test("rejects unknown roles and missing claims", () => {
  const sign = (payload: object) =>
    jwt.sign(payload, SECRET, { algorithm: "HS256", audience: TICKET_AUDIENCE, expiresIn: 60 });
  assert.throws(() => verifyTicket(sign({ sub: randomUUID(), file_id: fileId, role: "admin" }), fileId, SECRET));
  assert.throws(() => verifyTicket(sign({ file_id: fileId, role: "editor" }), fileId, SECRET));
  // A ticket without an expiry must not be accepted, however it was minted.
  const noExp = jwt.sign({ sub: randomUUID(), file_id: fileId, role: "editor" }, SECRET, {
    algorithm: "HS256",
    audience: TICKET_AUDIENCE,
  });
  assert.throws(() => verifyTicket(noExp, fileId, SECRET));
});
