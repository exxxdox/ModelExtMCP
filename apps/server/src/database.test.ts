import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppDatabase } from "./database.js";

test("database resolves a complete capability route and protects referenced records", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-"));
  const database = new AppDatabase(directory);
  try {
    const initialAdminToken = database.getCredential("admin").token;
    assert.equal(initialAdminToken.length, 43);
    assert.notEqual(database.getCredential("mcp").token, initialAdminToken);
    assert.notEqual(database.rotateCredential("admin").token, initialAdminToken);
    assert.deepEqual(
      { ...database.getRuntimeSettings(), updatedAt: undefined },
      { maxImageBytes: 10_485_760, maxConcurrentRequests: 4, updatedAt: undefined }
    );
    const updatedSettings = database.updateRuntimeSettings({ maxImageBytes: 2_097_152, maxConcurrentRequests: 7 });
    assert.equal(updatedSettings.maxImageBytes, 2_097_152);
    assert.equal(updatedSettings.maxConcurrentRequests, 7);

    const capability = database.listCapabilities()[0];
    assert.ok(capability);
    const endpoint = database.createEndpoint({ name: "Local", baseUrl: "http://ollama:11434", enabled: true });
    const deployment = database.createDeployment({
      endpointId: endpoint.id,
      modelName: "vision:test",
      supportsVision: true,
      timeoutMs: 30_000,
      enabled: true
    });
    database.createRoute({
      capabilityId: capability.id,
      deploymentId: deployment.id,
      priority: 10,
      promptTemplate: "Describe the image.",
      enabled: true
    });

    const [resolved] = database.resolveRoutes("image.describe");
    assert.equal(resolved?.modelName, "vision:test");
    assert.equal(resolved?.baseUrl, "http://ollama:11434");
    assert.throws(() => database.deleteEndpoint(endpoint.id), /constraint failed/i);
  } finally {
    database.close();
    // 测试数据库只存在于独立临时目录，测试后清理以避免污染开发环境。
    rmSync(directory, { recursive: true, force: true });
  }
});
