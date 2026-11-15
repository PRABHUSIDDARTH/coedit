import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same-origin proxy: the browser only talks to :5173, so the session cookie needs no CORS tricks.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8000";
const syncTarget = process.env.SYNC_TARGET ?? "ws://localhost:1234";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/sync": {
        target: syncTarget,
        ws: true,
        rewrite: (path) => path.replace(/^\/sync/, ""),
      },
    },
  },
});
