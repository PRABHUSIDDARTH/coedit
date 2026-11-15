import { afterEach, expect, test, vi } from "vitest";
import { api, ApiError } from "./client";

function stubFetch(status: number, payload: unknown) {
  const fn = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

test("sends the CSRF header and JSON body under /api", async () => {
  const fetchMock = stubFetch(200, { ok: true });
  await api("/auth/login", { method: "POST", body: { email: "a@b.c" } });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/auth/login");
  expect(init.method).toBe("POST");
  expect(init.headers).toMatchObject({
    "X-Requested-With": "coedit",
    "Content-Type": "application/json",
  });
  expect(init.body).toBe('{"email":"a@b.c"}');
});

test("throws ApiError with the server's detail", async () => {
  stubFetch(401, { detail: "Invalid email or password" });
  const err = await api("/auth/login", { method: "POST", body: {} }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(401);
  expect((err as ApiError).message).toBe("Invalid email or password");
});

test("joins validation messages", async () => {
  stubFetch(422, { detail: [{ msg: "too short" }, { msg: "bad email" }] });
  await expect(api("/auth/register", { method: "POST", body: {} })).rejects.toThrow(
    "too short; bad email",
  );
});

test("204 resolves to undefined", async () => {
  stubFetch(204, null);
  await expect(api<void>("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
});
