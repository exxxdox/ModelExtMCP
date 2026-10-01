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
import { VisionService } from "./service.js";

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
  registerAdminApi(router, database, new VisionService(database));
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
    const [capability] = await response.json() as Array<{ definition: { parameters: Array<{ name: string }> } }>;

    assert.equal(response.status, 200);
    assert.deepEqual(capability?.definition.parameters.map((parameter) => parameter.name), ["imageBase64", "mimeType", "prompt"]);
  });
});

test("capability responses expose the code defaults so the console can restore them", async () => {
  await withAdminApi(async (api) => {
    const response = await api.request("capabilities");
    const [capability] = await response.json() as Array<{ definition: { defaultKey: string; defaultName: string; defaultDescription: string } }>;

    assert.equal(capability?.definition.defaultKey, "image_describe");
    assert.ok((capability?.definition.defaultName.length ?? 0) > 0);
    assert.ok((capability?.definition.defaultDescription.length ?? 0) > 0);
  });
});

test("testing a capability runs the real path and reports why it could not finish", async () => {
  await withAdminApi(async (api, database) => {
    const [capability] = database.listCapabilities();
    assert.ok(capability);

    // 没有配置路由时，测试仍然返回诊断而不是抛错：管理端要看到「缺什么」。
    const response = await api.request(`capabilities/${capability.id}/test`, { method: "POST", body: "{}" });
    const body = await response.json() as { ok: boolean; errorCode: string; capabilityKey: string; input: { imageBytes: number } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.errorCode, "NO_ACTIVE_ROUTE");
    assert.equal(body.capabilityKey, "image_describe");
    assert.ok(body.input.imageBytes > 0, "样例图片必须随诊断一起回给管理端");
  });
});

test("testing an unknown capability is a 404 rather than a silent empty run", async () => {
  await withAdminApi(async (api) => {
    const response = await api.request("capabilities/6f9c0a7e-0000-4000-8000-000000000000/test", { method: "POST", body: "{}" });
    assert.equal(response.status, 404);
  });
});

test("endpoint test errors reach the shared handler without per-route catches", async () => {
  await withAdminApi(async (api) => {
    const invalid = await api.request("endpoints/test", { method: "POST", body: "{}" });
    assert.equal(invalid.status, 400);

    // 端口 0 不对应可连接的上游，验证 await 拒绝的转发，不依赖外部 Ollama。
    const failed = await api.request("endpoints/test", { method: "POST", body: JSON.stringify({ baseUrl: "http://127.0.0.1:0" }) });
    assert.equal(failed.status, 502);
    assert.equal((await failed.json() as { error: { code: string } }).error.code, "UPSTREAM_ERROR");
  });
});

test("editing a capability updates name, key and description while keeping the definition", async () => {
  await withAdminApi(async (api, database) => {
    const [capability] = database.listCapabilities();
    assert.ok(capability);

    const response = await api.request(`capabilities/${capability.id}`, {
      method: "PUT",
      body: JSON.stringify({ key: "vision_analyze", name: "视觉理解", description: "改为自定义描述", enabled: true, version: capability.version })
    });
    const body = await response.json() as { key: string; name: string; version: number; definition: { definitionKey: string } };

    assert.equal(response.status, 200);
    assert.equal(body.key, "vision_analyze");
    assert.equal(body.name, "视觉理解");
    assert.equal(body.version, capability.version + 1);
    assert.equal(body.definition.definitionKey, "image.describe");
  });
});

test("a capability key that is not a legal MCP tool name is rejected", async () => {
  await withAdminApi(async (api, database) => {
    const [capability] = database.listCapabilities();
    assert.ok(capability);

    // 标识就是 MCP 工具名：带点号的标识会让客户端拿工具名去调模型时直接失败，必须挡在保存前。
    const response = await api.request(`capabilities/${capability.id}`, {
      method: "PUT",
      body: JSON.stringify({ key: "vision.analyze", name: "视觉理解", description: "描述", enabled: true, version: capability.version })
    });

    assert.equal(response.status, 400);
    assert.equal(database.listCapabilities()[0]?.key, "image_describe");
  });
});

test("empty capability fields independently use code defaults through both save routes", async () => {
  await withAdminApi(async (api, database) => {
    const initial = database.listCapabilities()[0]!;
    database.updateCapabilityEnabled(initial.id, { enabled: false, version: initial.version });
    const defaults = { key: initial.key, name: initial.name, description: initial.description };
    const custom = { key: "custom_vision", name: "自定义名称", description: "自定义描述" };
    const endpoint = database.createEndpoint({ name: "local", baseUrl: "http://ollama:11434", enabled: true });
    const deployment = database.createDeployment({ endpointId: endpoint.id, modelName: "vision", supportsVision: true, timeoutMs: 60_000, enabled: true });
    const route = database.createRoute({ capabilityId: initial.id, deploymentId: deployment.id, priority: 100, enabled: true });
    const { updatedAt: _updatedAt, ...routeContent } = route;
    const routes = [{ id: route.id, endpointId: endpoint.id, modelName: "vision", supportsVision: true, timeoutMs: 60_000, priority: 100, enabled: true }];
    for (const suffix of ["", "/configuration"]) {
      const save = (fields: object, version = database.listCapabilities()[0]!.version) => api.request(`capabilities/${initial.id}${suffix}`, {
        method: "PUT", body: JSON.stringify({ ...fields, enabled: false, version, routes })
      });
      for (const field of ["key", "name", "description"] as const) {
        for (const empty of ["", " \n\t ", undefined]) {
          const response = await save({ ...custom, [field]: empty });
          assert.equal(response.status, 200);
          const current = database.listCapabilities()[0]!;
          assert.deepEqual({ key: current.key, name: current.name, description: current.description }, { ...custom, [field]: defaults[field] });
          assert.equal(current.enabled, false);
          // 集中保存会刷新路由时间戳，但默认值回退不能改变路由内容。
          assert.deepEqual(database.listRoutes().map(({ updatedAt, ...value }) => value), [routeContent]);
          assert.deepEqual(database.listDeployments(), [deployment]);
        }
      }
      const before = database.listCapabilities()[0]!;
      for (const invalid of [{ key: "bad.key" }, { name: "x".repeat(81) }, { description: "x".repeat(501) }, { name: null }]) {
        assert.equal((await save({ ...custom, ...invalid })).status, 400);
        assert.deepEqual(database.listCapabilities()[0]!, before);
      }
      assert.equal((await save(custom, before.version - 1)).status, 409);
      assert.deepEqual(database.listCapabilities()[0]!, before);
    }
    // 失去注册表定义时，不允许将空字段当作可保存的配置。
    database.db.prepare("UPDATE capabilities SET definition_key = 'unknown' WHERE id = ?").run(initial.id);
    const response = await api.request(`capabilities/${initial.id}`, { method: "PUT", body: JSON.stringify({ ...custom, key: "", enabled: false, version: database.listCapabilities()[0]!.version }) });
    assert.equal(response.status, 400);
    assert.equal(database.listCapabilities()[0]!.key, custom.key);
  });
});

test("configuration save is atomic and keeps shared deployments and other capability routes intact", async () => {
  await withAdminApi(async (api, database) => {
    const capability = database.listCapabilities()[0]!;
    const endpoint = database.createEndpoint({ name: "local", baseUrl: "http://ollama:11434", enabled: true });
    const deployment = database.createDeployment({ endpointId: endpoint.id, modelName: "vision:one", supportsVision: true, timeoutMs: 60_000, enabled: true });
    const original = database.createRoute({ capabilityId: capability.id, deploymentId: deployment.id, priority: 100, promptTemplate: "Describe", enabled: true });
    const otherId = "10000000-0000-4000-8000-000000000001";
    // 第二个能力共享同一部署，用来证明集中编辑不会顺手改坏相邻能力。
    database.db.prepare(`INSERT INTO capabilities (id, definition_key, key, name, description, executor_type, enabled, version, created_at, updated_at)
      SELECT ?, 'test_other', 'test_other', name, description, executor_type, enabled, version, created_at, updated_at FROM capabilities WHERE id = ?`).run(otherId, capability.id);
    // 模拟升级前留下的未知能力路由；新 API 已禁止未知定义新增路由。
    const otherRouteId = "10000000-0000-4000-8000-000000000003";
    database.db.prepare(`INSERT INTO capability_routes (id, capability_id, deployment_id, priority, prompt_template, enabled, created_at, updated_at)
      SELECT ?, ?, deployment_id, 50, 'Other', enabled, created_at, updated_at FROM capability_routes WHERE id = ?`).run(otherRouteId, otherId, original.id);
    const other = database.listRoutes().find((route) => route.id === otherRouteId)!;
    const choice = { endpointId: endpoint.id, modelName: "vision:one", timeoutMs: 60_000, supportsVision: true, priority: 100, promptTemplate: "Updated", enabled: true };
    const save = (body: unknown) => api.request(`capabilities/${capability.id}/configuration`, { method: "PUT", body: JSON.stringify(body) });
    const base = { key: capability.key, name: "Edited", description: "Updated description", enabled: true, version: capability.version };

    // 第二条路由失败发生在首条已创建部署之后，验证事务确实回滚所有表。
    const before = [database.listCapabilities(), database.listDeployments(), database.listRoutes()];
    const invalid = await save({ ...base, routes: [{ ...choice, modelName: "vision:new" }, { ...choice, endpointId: "10000000-0000-4000-8000-000000000002" }] });
    assert.equal(invalid.status, 400);
    assert.deepEqual([database.listCapabilities(), database.listDeployments(), database.listRoutes()], before);
    const foreign = await save({ ...base, routes: [{ ...choice, id: other.id }] });
    assert.equal(foreign.status, 400);
    const duplicate = await save({ ...base, routes: [{ ...choice, id: original.id }, { ...choice, id: original.id }] });
    assert.equal(duplicate.status, 400);
    assert.deepEqual([database.listCapabilities(), database.listDeployments(), database.listRoutes()], before);

    const reused = await save({ ...base, routes: [{ ...choice, id: original.id }] });
    assert.equal(reused.status, 200);
    assert.equal((await reused.json() as { version: number }).version, capability.version + 1);
    assert.equal(database.listDeployments().length, 1);
    const stale = await save({ ...base, routes: [] });
    assert.equal(stale.status, 409);
    assert.equal(database.listRoutes().length, 2);

    const changed = await save({ ...base, version: capability.version + 1, routes: [{ ...choice, id: original.id, modelName: "vision:two" }] });
    assert.equal(changed.status, 200);
    assert.equal(database.listDeployments().length, 2);
    assert.deepEqual(database.listDeployments().find((item) => item.id === deployment.id), deployment);
    assert.deepEqual(database.listRoutes().find((item) => item.id === other.id), other);
    assert.notEqual(database.listRoutes().find((item) => item.id === original.id)?.deploymentId, deployment.id);
    const cleared = await save({ ...base, version: capability.version + 2, routes: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(database.listRoutes(), [other]);
    assert.deepEqual(database.listDeployments(), [deployment]);
    assert.equal((await api.request(`endpoints/${endpoint.id}`, { method: "DELETE" })).status, 409);
    assert.deepEqual(database.listRoutes(), [other]);
    assert.deepEqual(database.listDeployments(), [deployment]);
  });
});

test("endpoint deletion cleans orphan deployments atomically and preserves routed endpoints", async () => {
  await withAdminApi(async (api, database) => {
    const capability = database.listCapabilities()[0]!;
    const endpoint = database.createEndpoint({ name: "local", baseUrl: "http://ollama:11434", enabled: true });
    const deployment = database.createDeployment({ endpointId: endpoint.id, modelName: "vision:one", supportsVision: true, timeoutMs: 60_000, enabled: true });
    const orphan = database.createDeployment({ endpointId: endpoint.id, modelName: "vision:unused", supportsVision: true, timeoutMs: 60_000, enabled: false });
    const route = database.createRoute({ capabilityId: capability.id, deploymentId: deployment.id, priority: 100, promptTemplate: "Describe", enabled: false });
    const remove = () => api.request(`endpoints/${endpoint.id}`, { method: "DELETE" });
    assert.equal((await remove()).status, 409);
    assert.deepEqual(database.listEndpoints(), [endpoint]);
    assert.deepEqual(database.listDeployments(), [deployment, orphan]);
    assert.deepEqual(database.listRoutes(), [route]);
    database.deleteRoute(route.id);
    assert.equal((await remove()).status, 204);
    assert.deepEqual(database.listEndpoints(), []);
    assert.deepEqual(database.listDeployments(), []);
    assert.equal((await remove()).status, 404);
  });
});

test("endpoint status changes independently of edits and keeps routes intact", async () => {
  await withAdminApi(async (api, database) => {
    const endpoint = database.createEndpoint({ name: "local", baseUrl: "http://ollama:11434", enabled: true });
    const deployment = database.createDeployment({ endpointId: endpoint.id, modelName: "vision", supportsVision: true, timeoutMs: 60_000, enabled: true });
    const route = database.createRoute({ capabilityId: database.listCapabilities()[0]!.id, deploymentId: deployment.id, priority: 100, enabled: true });
    const toggle = (id: string, enabled: unknown) => api.request(`endpoints/${id}/enabled`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    const disabled = await toggle(endpoint.id, false);
    assert.equal(disabled.status, 200);
    const body = await disabled.json() as { id: string; name: string; baseUrl: string; enabled: boolean };
    assert.equal(body.id, endpoint.id);
    assert.equal(body.name, endpoint.name);
    assert.equal(body.baseUrl, endpoint.baseUrl);
    assert.equal(body.enabled, false);
    // 模拟开关操作前打开的旧编辑框，enabled: true 不应把端点重新启用。
    const edited = await api.request(`endpoints/${endpoint.id}`, { method: "PUT", body: JSON.stringify({ name: "renamed", baseUrl: "http://new-ollama:11434", enabled: true }) });
    assert.equal(edited.status, 200);
    assert.equal(database.listEndpoints()[0]!.enabled, false);
    assert.equal(database.listEndpoints()[0]!.name, "renamed");
    assert.equal(database.listEndpoints()[0]!.baseUrl, "http://new-ollama:11434");
    assert.equal((await toggle(endpoint.id, "false")).status, 400);
    assert.equal(database.listEndpoints()[0]!.enabled, false);
    assert.equal((await toggle("10000000-0000-4000-8000-000000000001", true)).status, 404);
    assert.equal((await toggle(endpoint.id, true)).status, 200);
    assert.equal(database.listEndpoints()[0]!.enabled, true);
    assert.deepEqual(database.listRoutes(), [route]);
    assert.deepEqual(database.listDeployments(), [deployment]);
  });
});


test("ability status is versioned separately and provider task stays code-owned", async () => {
  await withAdminApi(async (api, database) => {
    const capability = database.listCapabilities()[0]!;
    const endpoint = database.createEndpoint({ name: "local", baseUrl: "http://ollama:11434", enabled: true });
    const deployment = database.createDeployment({ endpointId: endpoint.id, modelName: "vision", supportsVision: true, timeoutMs: 60000, enabled: true });
    const created = await api.request("routes", { method: "POST", body: JSON.stringify({ capabilityId: capability.id, deploymentId: deployment.id, promptTemplate: "untrusted admin task" }) });
    assert.equal(created.status, 201);
    const view = await (await api.request("capabilities")).json() as Array<{ definition: { externalProvider: string; defaultPrompt: string } }>;
    assert.equal(view[0]!.definition.externalProvider, "ollama");
    const task = view[0]!.definition.defaultPrompt;
    assert.ok(task);
    assert.equal(database.listRoutes()[0]!.promptTemplate, task);
    // 旧数据库的提示词不能改变实际任务；调用链拿到的是代码默认值。
    database.db.prepare("UPDATE capability_routes SET prompt_template = 'legacy custom task'").run();
    assert.equal(database.resolveRoutes(capability.key)[0]!.promptTemplate, task);
    const routes = database.listRoutes();
    const disabled = await api.request(`capabilities/${capability.id}/enabled`, { method: "PATCH", body: JSON.stringify({ enabled: false, version: capability.version }) });
    assert.equal(disabled.status, 200);
    const current = database.listCapabilities()[0]!;
    assert.equal(current.enabled, false);
    assert.equal(current.version, capability.version + 1);
    assert.equal(current.description, capability.description);
    assert.deepEqual(database.listRoutes(), routes);
    assert.equal((await api.request(`capabilities/${capability.id}/enabled`, { method: "PATCH", body: JSON.stringify({ enabled: true, version: capability.version }) })).status, 409);
    const saved = await api.request(`capabilities/${capability.id}/configuration`, { method: "PUT", body: JSON.stringify({ key: current.key, name: current.name, description: current.description, enabled: true, version: current.version, routes: [{ id: routes[0]!.id, endpointId: endpoint.id, modelName: "vision", promptTemplate: "ignore", enabled: true }] }) });
    assert.equal(saved.status, 200);
    assert.equal(database.listCapabilities()[0]!.enabled, false);
    assert.equal(database.listRoutes()[0]!.promptTemplate, task);
    // 失去代码实现的能力不能继续借用旧路由执行，也不能新增配置。
    database.db.prepare("UPDATE capabilities SET definition_key = 'unknown', enabled = 1").run();
    assert.deepEqual(database.resolveRoutes(capability.key), []);
    assert.equal((await api.request("routes", { method: "POST", body: JSON.stringify({ capabilityId: capability.id, deploymentId: deployment.id }) })).status, 400);
  });
});
