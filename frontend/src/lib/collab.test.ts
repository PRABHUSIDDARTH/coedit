import { expect, test } from "vitest";
import { resolveSyncUrl } from "./collab";

test("resolves the API's sync path against the page, switching to ws(s)", () => {
  expect(resolveSyncUrl("/sync", "http://localhost:5173/w/1/f/2")).toBe("ws://localhost:5173/sync");
  expect(resolveSyncUrl("/sync", "https://coedit.example/w/1")).toBe("wss://coedit.example/sync");
});

test("keeps absolute URLs", () => {
  expect(resolveSyncUrl("wss://sync.example/doc", "http://localhost:5173/")).toBe("wss://sync.example/doc");
  expect(resolveSyncUrl("http://localhost:1234", "http://localhost:5173/")).toBe("ws://localhost:1234/");
});
