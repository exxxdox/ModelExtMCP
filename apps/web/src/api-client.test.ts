import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAdminApi } from "./api-client.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init?: RequestInit) => unknown): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

test("prefixes the admin API path and sends the bearer token", async () => {
  const { calls } = stubFetch(() => jsonResponse(200, []));

  const api = createAdminApi({ token: "admin-token", onUnauthorized: () => {} });
  const result = await api<unknown[]>("capabilities");

  assert.deepEqual(result, []);
  assert.equal(calls[0]?.url, "/api/v1/capabilities");
  assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer admin-token");
});

test("resolves undefined for 204 responses instead of parsing an empty body", async () => {
  stubFetch(() => ({ status: 204, ok: true, json: async () => { throw new Error("should not parse"); } }) as unknown as Response);

  const api = createAdminApi({ token: "admin-token", onUnauthorized: () => {} });

  assert.equal(await api("capabilities/1"), undefined);
});

test("reports unauthorized responses to the caller and rejects with a readable message", async () => {
  stubFetch(() => jsonResponse(401, { error: { message: "访问凭据无效" } }));
  let unauthorizedCount = 0;

  const api = createAdminApi({ token: "stale-token", onUnauthorized: () => { unauthorizedCount += 1; } });

  await assert.rejects(() => api("capabilities"), { message: "访问令牌无效" });
  assert.equal(unauthorizedCount, 1);
});

test("surfaces the server error message when the response carries one", async () => {
  stubFetch(() => jsonResponse(409, { error: { message: "记录重复或仍被其他配置引用" } }));

  const api = createAdminApi({ token: "admin-token", onUnauthorized: () => {} });

  await assert.rejects(() => api("capabilities"), { message: "记录重复或仍被其他配置引用" });
});

test("falls back to a generic message when the error body is not JSON", async () => {
  stubFetch(() => ({ status: 502, ok: false, json: async () => { throw new Error("invalid json"); } }) as unknown as Response);

  const api = createAdminApi({ token: "admin-token", onUnauthorized: () => {} });

  await assert.rejects(() => api("capabilities"), { message: "请求失败" });
});
