import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const prod = { production: true };
const names = (o: Parameters<typeof securityHeaders>[0]) => securityHeaders(o).map((h) => h.key);

describe("security headers", () => {
  it("always sends the framing, sniffing and referrer headers", () => {
    expect(names(prod)).toEqual(
      expect.arrayContaining(["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]),
    );
    expect(securityHeaders(prod).find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
  });

  it("sends HSTS only when asked (HTTPS deployments)", () => {
    expect(names(prod)).not.toContain("Strict-Transport-Security");
    expect(names({ ...prod, hsts: true })).toContain("Strict-Transport-Security");
  });

  it("production CSP forbids eval, framing, plugins and foreign scripts", () => {
    const csp = contentSecurityPolicy(prod);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toMatch(/script-src 'self' 'unsafe-inline'(;|$)/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*https?:/);
    expect(csp).not.toContain("localhost");
  });

  it("allows the sync WebSocket on :1234 and a custom NEXT_PUBLIC_SYNC_URL origin", () => {
    expect(contentSecurityPolicy(prod)).toMatch(/connect-src 'self' ws:\/\/\*:1234 wss:\/\/\*:1234(;|$)/);
    expect(contentSecurityPolicy({ ...prod, syncUrl: "https://sync.example.com/ws" })).toContain("wss://sync.example.com");
    expect(contentSecurityPolicy({ ...prod, syncUrl: "ws://10.0.0.5:9999" })).toContain("ws://10.0.0.5:9999");
    expect(contentSecurityPolicy({ ...prod, syncUrl: "not a url" })).not.toContain("not a url");
  });

  it("development additionally allows eval and the HMR socket", () => {
    const csp = contentSecurityPolicy({ production: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws://localhost:*");
  });
});
