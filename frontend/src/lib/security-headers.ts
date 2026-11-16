/**
 * Response security headers for the Next server (wired in next.config.ts, baked in at build time).
 *
 * CSP trade-offs, all deliberate:
 * - script-src keeps 'unsafe-inline': the App Router emits inline bootstrap scripts, and nonces would
 *   need middleware that makes every page dynamic. The CSP still blocks foreign script origins,
 *   plugins (object-src), framing, <base> and form hijacking. Development also needs 'unsafe-eval'.
 * - style-src keeps 'unsafe-inline': React `style=` props, Tailwind and Excalidraw use inline styles.
 * - connect-src allows the sync WebSocket on any host at port 1234 (the browser connects to the page's
 *   own host there), plus NEXT_PUBLIC_SYNC_URL's origin when that build-time override is set.
 * - font-src allows https://esm.sh: Excalidraw (canvas preview) fetches its fonts from there unless
 *   EXCALIDRAW_ASSET_PATH is set. Drop it once the fonts are self-hosted.
 */
export interface HeaderOptions {
  production: boolean;
  /** Value of NEXT_PUBLIC_SYNC_URL (build time), if any. */
  syncUrl?: string;
  /** Send Strict-Transport-Security. Only for deployments served over HTTPS. */
  hsts?: boolean;
  /** How the CSP is sent. Default "enforce". */
  cspMode?: CspMode;
}

export type CspMode = "enforce" | "report-only" | "off";

/** Parse CSP_MODE. Empty/unset = enforce; anything else unknown throws, so a typo cannot silently weaken the policy. */
export function parseCspMode(raw: string | undefined): CspMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "enforce") return "enforce";
  if (value === "report-only" || value === "off") return value;
  throw new Error(`CSP_MODE must be "enforce", "report-only" or "off" (got "${raw}")`);
}

function syncOrigin(syncUrl: string | undefined): string | null {
  if (!syncUrl?.trim()) return null;
  try {
    const url = new URL(syncUrl);
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    return `${secure ? "wss:" : "ws:"}//${url.host}`;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy({ production, syncUrl }: HeaderOptions): string {
  const connect = ["'self'", "ws://*:1234", "wss://*:1234"];
  const custom = syncOrigin(syncUrl);
  if (custom) connect.push(custom);
  // Dev only: the HMR socket, for browsers where 'self' does not cover ws: on the same host.
  if (!production) connect.push("ws://localhost:*", "ws://127.0.0.1:*");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://esm.sh",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(options: HeaderOptions): { key: string; value: string }[] {
  const mode = options.cspMode ?? "enforce";
  const headers = [
    ...(mode === "off"
      ? []
      : [
          {
            key: mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
            value: contentSecurityPolicy(options),
          },
        ]),
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  if (options.hsts) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}
