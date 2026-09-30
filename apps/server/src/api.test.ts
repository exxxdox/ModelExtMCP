import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { apiErrorHandler, bearerAuth, normalizeOllamaUrl, registerAdminApi } from "./api.js";
import { AppDatabase } from "./database.js";

test("normalizeOllamaUrl keeps only a safe service root", () => {
  assert.equal(normalizeOllamaUrl("http://ollama:11434/"), "http://ollama:11434");
  assert.throws(() => normalizeOllamaUrl("ftp://ollama/"), /HTTP/);
  assert.throws(() => normalizeOllamaUrl("http://user:pass@ollama:11434/"), /凭据/);
  assert.throws(() => normalizeOllamaUrl("http://ollama:11434/api/chat"), /根地址/);
});

type AdminApiHarness = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
};

/** 用真实 HTTP 栈验证管理 API 契约：路由是否还在、返回体是否带只读定义。 */
async function startAdminApi(database: AppDatabase): Promise<AdminApiHarness> {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(bearerAuth(() => database.getCredential("admin").token));
  registerAdminApi(router, database);
  router.use((_request, response) => response.status(404).json({ error: { code: "NOT_FOUND", message: "接口不存在" } }));
  app.use("/api/v1", router);
  app.use(apiErrorHandler);
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    request: (requestPath, init) => fetch(`http://127.0.0.1:${port}/api/v1/${requestPath}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${database.getCredential("admin").token}`,
        ...init?.headers
      }
    }),
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); })
  };
}

async function withAdminApi(run: (api: AdminApiHarness, database: AppDatabase) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-api-"));
  const database = new AppDatabase(directory);
  const api = await startAdminApi(database);
  try {
    await run(api, database);
  } finally {
    await api.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("capabilities are read-only in count: the API exposes no create or delete route", async () => {
  await withAdminApi(async (api, database) => {
    const [capability] = database.listCapabilities();
    assert.ok(capability);

    const created = await api.request("capabilities", { method: "POST", body: JSON.stringify({ key: "x.y", name: "x", description: "x", enabled: true }) });
    const removed = await api.request(`capabilities/${capability.id}`, { method: "DELETE" });

    assert.equal(created.status, 404);
    assert.equal(removed.status, 404);
    assert.equal(database.listCapabilities().length, 1);
  });
});

test("capability responses carry the code-owned tool contract for read-only display", async () => {
  await withAdminApi(async (api) => {
    const response = await api.request("capabilities");
    const [capability] = await response.json() as Array<{ definition: { toolName: string; parameters: Array<{ name: string }> } }>;

    assert.equal(response.status, 200);
    assert.equal(capability?.definition.toolName, "analyze_image");
    assert.ok((capability?.definition.parameters.length ?? 0) >= 4);
  });
});

test("capability responses expose the code defaults so the console can restore them", async () => {
  await withAdminApi(async (api) => {
    const response = await api.request("capabilities");
    const [capability] = await response.json() as Array<{ definition: { defaultKey: string; defaultName: string; defaultDescription: string } }>;

    assert.equal(capability?.definition.defaultKey, "image.describe");
    assert.ok((capability?.definition.defaultName.length ?? 0) > 0);
    assert.ok((capability?.definition.defaultDescription.length ?? 0) > 0);
  });
});

test("editing a capability updates name, key and description while keeping the definition", async () => {
  await withAdminApi(async (api, database) => {
    const [capability] = database.listCapabilities();
    assert.ok(capability);

    const response = await api.request(`capabilities/${capability.id}`, {
      method: "PUT",
      body: JSON.stringify({ key: "vision.analyze", name: "视觉理解", description: "改为自定义描述", enabled: true, version: capability.version })
    });
    const body = await response.json() as { key: string; name: string; version: number; definition: { toolName: string } };

    assert.equal(response.status, 200);
    assert.equal(body.key, "vision.analyze");
    assert.equal(body.name, "视觉理解");
    assert.equal(body.version, capability.version + 1);
    assert.equal(body.definition.toolName, "analyze_image");
  });
});
