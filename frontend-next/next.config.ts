import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: Next blocks dev resources (HMR) requested from a host other than localhost, which stalls
  // hydration when the app is opened on 127.0.0.1 (a separate cookie jar, handy for a second user).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
