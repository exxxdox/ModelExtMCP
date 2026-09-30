import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppDatabase } from "./database.js";
import { VisionService } from "./service.js";

function withDatabase(run: (database: AppDatabase) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-service-"));
  const database = new AppDatabase(directory);
  try {
    run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("an omitted capability key falls back to the configured default capability", () => {
  withDatabase((database) => {
    const service = new VisionService(database);

    assert.equal(service.resolveCapabilityKey(undefined), database.getDefaultCapabilityKey());
  });
});

test("the fallback follows a renamed capability so agents without a key keep working", () => {
  withDatabase((database) => {
    const [capability] = database.listCapabilities();
    assert.ok(capability);
    database.updateCapability(capability.id, {
      key: "vision.analyze",
      name: capability.name,
      description: capability.description,
      enabled: true,
      version: capability.version
    });

    const service = new VisionService(database);

    assert.equal(service.resolveCapabilityKey(undefined), "vision.analyze");
  });
});

test("an explicit capability key is used as-is", () => {
  withDatabase((database) => {
    const service = new VisionService(database);

    assert.equal(service.resolveCapabilityKey("image.describe"), "image.describe");
  });
});

/** 1x1 红色 PNG：与页面测试按钮用的样例同款，足够通过图片校验又不会拖慢用例。 */
const SAMPLE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function withDatabaseAsync(run: (database: AppDatabase) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-service-"));
  const database = new AppDatabase(directory);
  try {
    await run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 按请求体里的模型名决定上游行为，比按 URL 匹配稳。 */
function stubOllama(respond: (model: string) => Response): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    return respond(String(body.model));
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

/** 建一条完整可用的路由，返回能力 key。 */
function withRoute(database: AppDatabase, options: { modelName: string; priority: number; baseUrl: string }): string {
  const [capability] = database.listCapabilities();
  assert.ok(capability);
  // base_url 有唯一约束，多个端点必须给不同地址。
  const endpoint = database.createEndpoint({ name: `endpoint-${options.modelName}`, baseUrl: options.baseUrl, enabled: true });
  const deployment = database.createDeployment({ endpointId: endpoint.id, modelName: options.modelName, supportsVision: true, timeoutMs: 5_000, enabled: true });
  database.createRoute({ capabilityId: capability.id, deploymentId: deployment.id, priority: options.priority, promptTemplate: "描述这张图片", enabled: true });
  return capability.key;
}

function okResponse(text: string): Response {
  return new Response(JSON.stringify({ message: { content: text } }), { status: 200, headers: { "content-type": "application/json" } });
}

test("testing a capability reports the model that answered and the request it actually sent", async () => {
  await withDatabaseAsync(async (database) => {
    const key = withRoute(database, { modelName: "vision:test", priority: 10, baseUrl: "http://ollama:11434" });
    const service = new VisionService(database);

    const restore = stubOllama(() => okResponse("这张图片是纯红色。"));
    const outcome = await service
      .testCapability(key, { imageBase64: SAMPLE_PNG, mimeType: "image/png", prompt: "什么颜色？" }, "req-1")
      .finally(restore);

    assert.equal(outcome.ok, true);
    assert.equal(outcome.text, "这张图片是纯红色。");
    assert.equal(outcome.capabilityKey, "image.describe");
    assert.equal(outcome.input.prompt, "什么颜色？");
    assert.equal(outcome.input.mimeType, "image/png");
    assert.deepEqual(outcome.attempts.map((attempt) => [attempt.modelName, attempt.status, attempt.responseText]), [
      ["vision:test", "ok", "这张图片是纯红色。"]
    ]);
    // 展示给管理员的必须是真实发出的那份请求，而不是另拼一份。
    const [first] = outcome.attempts;
    assert.equal(first?.requestUrl, "http://ollama:11434/api/chat");
    assert.equal(first?.requestBody.model, "vision:test");
    assert.equal(first?.requestBody.messages[1]?.content, "什么颜色？");
    assert.deepEqual(first?.requestBody.messages[1]?.images, [SAMPLE_PNG]);
  });
});

test("a failed attempt is recorded and the next route is tried", async () => {
  await withDatabaseAsync(async (database) => {
    const key = withRoute(database, { modelName: "broken:test", priority: 10, baseUrl: "http://broken-ollama:11434" });
    withRoute(database, { modelName: "working:test", priority: 20, baseUrl: "http://working-ollama:11434" });
    const service = new VisionService(database);

    const restore = stubOllama((model) => model === "broken:test" ? new Response("boom", { status: 500 }) : okResponse("退回到可用模型"));
    const outcome = await service
      .testCapability(key, { imageBase64: SAMPLE_PNG, mimeType: "image/png" }, "req-2")
      .finally(restore);

    assert.equal(outcome.ok, true);
    assert.equal(outcome.text, "退回到可用模型");
    assert.deepEqual(outcome.attempts.map((attempt) => [attempt.modelName, attempt.status, attempt.errorCode ?? null]), [
      ["broken:test", "error", "OLLAMA_HTTP_500"],
      ["working:test", "ok", null]
    ]);
  });
});

test("testing without a usable route explains the gap instead of throwing at the caller", async () => {
  await withDatabaseAsync(async (database) => {
    const service = new VisionService(database);

    const outcome = await service.testCapability("image.describe", { imageBase64: SAMPLE_PNG, mimeType: "image/png" }, "req-3");

    assert.equal(outcome.ok, false);
    assert.equal(outcome.errorCode, "NO_ACTIVE_ROUTE");
    assert.deepEqual(outcome.attempts, []);
  });
});

test("an invalid sample image is reported before any route is touched", async () => {
  await withDatabaseAsync(async (database) => {
    const key = withRoute(database, { modelName: "vision:test", priority: 10, baseUrl: "http://ollama:11434" });
    const service = new VisionService(database);

    const restore = stubOllama(() => okResponse("不该被调用"));
    const outcome = await service
      .testCapability(key, { imageBase64: "not-base64", mimeType: "image/png" }, "req-4")
      .finally(restore);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.errorCode, "INVALID_IMAGE_BASE64");
    assert.deepEqual(outcome.attempts, []);
  });
});
