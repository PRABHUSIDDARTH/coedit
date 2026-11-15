import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // Next writes an AGENTS.md into the app folder on `dev`; the repo already has one at the root.
  agentRules: false,
  // Dev only: Next blocks dev resources (HMR) requested from a host other than localhost, which stalls
  // hydration when the app is opened on 127.0.0.1 (a separate cookie jar, handy for a second user).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
