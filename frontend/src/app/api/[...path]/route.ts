/**
 * Same-origin proxy to the Coedit API. The browser only talks to this app, so the session cookie
 * needs no CORS handling. The target is read at request time (API_TARGET), so one build runs in any
 * environment. Request and response bodies are streamed, which keeps 50 MB uploads and downloads
 * out of memory (and clear of the 10 MB body cap that applies to Next's built-in rewrites).
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const TARGET = () => (process.env.API_TARGET ?? "http://localhost:8000").replace(/\/$/, "");
// Hop-by-hop headers must not be forwarded; `host` must be the target's.
const DROP_REQUEST = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te"]);
const DROP_RESPONSE = new Set(["connection", "transfer-encoding", "keep-alive", "content-encoding", "content-length"]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const url = `${TARGET()}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => { if (!DROP_REQUEST.has(key.toLowerCase())) headers.set(key, value); });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // Required by Node's fetch when streaming a request body.
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
      cache: "no-store",
    } as RequestInit);
  } catch {
    return Response.json({ detail: "The Coedit API is not reachable." }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => { if (!DROP_RESPONSE.has(key.toLowerCase()) && key.toLowerCase() !== "set-cookie") out.set(key, value); });
  // Several Set-Cookie headers must stay separate.
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
