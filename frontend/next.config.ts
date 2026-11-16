import type { NextConfig } from "next";
import { parseCspMode, securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // Next writes an AGENTS.md into the app folder on `dev`; the repo already has one at the root.
  agentRules: false,
  // Dev only: Next blocks dev resources (HMR) requested from a host other than localhost, which stalls
  // hydration when the app is opened on 127.0.0.1 (a separate cookie jar, handy for a second user).
  allowedDevOrigins: ["127.0.0.1"],
  // Not applied to /api: the proxied API responses carry their own headers (downloads set a sandbox CSP).
  // CSP_MODE (build time): enforce (default) | report-only | off. HSTS is opt-in at build time (ENABLE_HSTS=1) because it must only be sent over HTTPS.
  async headers() {
    return [
      {
        source: "/((?!api/).*)",
        headers: securityHeaders({
          production: process.env.NODE_ENV === "production",
          syncUrl: process.env.NEXT_PUBLIC_SYNC_URL,
          hsts: process.env.ENABLE_HSTS === "1",
          cspMode: parseCspMode(process.env.CSP_MODE),
        }),
      },
    ];
  },
};

export default nextConfig;
