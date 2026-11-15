import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSyncUrl } from "./session";

const page = new URL("http://localhost:3000/app/doc/1");

describe("resolveSyncUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends a relative path to the sync server's port on this host", () => {
    expect(resolveSyncUrl("/sync", page)).toBe("ws://localhost:1234");
    expect(resolveSyncUrl("/sync", new URL("https://app.example.com/x"))).toBe("wss://app.example.com:1234");
  });
  it("uses NEXT_PUBLIC_SYNC_URL for a relative path when set", () => {
    vi.stubEnv("NEXT_PUBLIC_SYNC_URL", "wss://sync.example.com/ws");
    expect(resolveSyncUrl("/sync", page)).toBe("wss://sync.example.com/ws");
  });
  it("treats an empty NEXT_PUBLIC_SYNC_URL as unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SYNC_URL", "");
    expect(resolveSyncUrl("/sync", page)).toBe("ws://localhost:1234");
    vi.stubEnv("NEXT_PUBLIC_SYNC_URL", "   ");
    expect(resolveSyncUrl("/sync", page)).toBe("ws://localhost:1234");
  });
  it("keeps an absolute URL and converts http to ws", () => {
    vi.stubEnv("NEXT_PUBLIC_SYNC_URL", "wss://ignored.example.com");
    expect(resolveSyncUrl("ws://sync:1234", page)).toBe("ws://sync:1234");
    expect(resolveSyncUrl("https://sync.example.com/s", page)).toBe("wss://sync.example.com/s");
  });
});
