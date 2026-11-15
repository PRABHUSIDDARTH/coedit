/** Thin fetch wrapper: same-origin cookie session, JSON in/out, typed errors. */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      // FastAPI validation errors: [{loc, msg, ...}]
      return detail
        .map((d: unknown) =>
          d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : "",
        )
        .filter(Boolean)
        .join("; ");
    }
  }
  return `Request failed (${status})`;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "coedit" };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(payload, res.status));
  return payload as T;
}
