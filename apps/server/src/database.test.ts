import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
      { maxImageBytes: 10_485_760, maxConcurrentRequests: 4, allowNetworkAccess: true, updatedAt: undefined }
    );
    const updatedSettings = database.updateRuntimeSettings({ maxImageBytes: 2_097_152, maxConcurrentRequests: 7, allowNetworkAccess: false });
    assert.equal(updatedSettings.maxImageBytes, 2_097_152);
    assert.equal(updatedSettings.maxConcurrentRequests, 7);
    assert.equal(updatedSettings.allowNetworkAccess, false);

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

    const [resolved] = database.resolveRoutes("image_describe");
    assert.equal(resolved?.modelName, "vision:test");
    assert.equal(resolved?.baseUrl, "http://ollama:11434");
    assert.throws(() => database.deleteEndpoint(endpoint.id), /constraint failed/i);
  } finally {
    database.close();
    // 测试数据库只存在于独立临时目录，测试后清理以避免污染开发环境。
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renaming a capability key does not create a duplicate capability on restart", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-rename-"));
  const first = new AppDatabase(directory);
  const [capability] = first.listCapabilities();
  assert.ok(capability);
  first.updateCapability(capability.id, {
    key: "vision_analyze",
    name: "视觉理解",
    description: "自定义描述",
    enabled: true,
    version: capability.version
  });
  first.close();

  // 重新打开会再次执行 seed：它按 definition_key 匹配，改过 key 也不能多出一行。
  const second = new AppDatabase(directory);
  try {
    const capabilities = second.listCapabilities();
    assert.equal(capabilities.length, 1);
    assert.equal(capabilities[0]?.key, "vision_analyze");
    assert.equal(capabilities[0]?.name, "视觉理解");
    assert.equal(second.getDefaultCapabilityKey(), "vision_analyze");
  } finally {
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy capability rows adopt the code definition key without duplicating", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-legacy-capability-"));
  const legacy = new DatabaseSync(path.join(directory, "model-ext-mcp.sqlite"));
  legacy.exec(`
    CREATE TABLE capabilities (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      executor_type TEXT NOT NULL CHECK (executor_type = 'ollama_vision'),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  legacy.prepare("INSERT INTO capabilities VALUES ('legacy-1', 'vision.old', '旧名称', '旧描述', 'ollama_vision', 1, 1, ?, ?)")
    .run(now, now);
  legacy.close();

  const database = new AppDatabase(directory);
  try {
    const capabilities = database.listCapabilities();
    assert.equal(capabilities.length, 1);
    assert.equal(capabilities[0]?.definitionKey, "image.describe");
    // 管理员改过的名称必须保留；标识带点号时只把非法字符换成下划线，因为标识就是 MCP 工具名。
    assert.equal(capabilities[0]?.key, "vision_old");
    assert.equal(capabilities[0]?.name, "旧名称");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a legacy dotted capability key becomes the tool name the agent will see", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-dotted-key-"));
  const legacy = new DatabaseSync(path.join(directory, "model-ext-mcp.sqlite"));
  legacy.exec(`
    CREATE TABLE capabilities (
      id TEXT PRIMARY KEY,
      definition_key TEXT NOT NULL DEFAULT 'image.describe',
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      executor_type TEXT NOT NULL CHECK (executor_type = 'ollama_vision'),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  // 旧版本代码把工具名写成 analyze_image、能力标识写成 image.describe，升级后两者合一。
  legacy.prepare("INSERT INTO capabilities VALUES ('legacy-1', 'image.describe', 'image.describe', '图像理解', '描述图片', 'ollama_vision', 1, 1, ?, ?)")
    .run(now, now);
  legacy.close();

  const database = new AppDatabase(directory);
  try {
    const [capability] = database.listCapabilities();
    assert.equal(capability?.key, "image_describe");
    assert.equal(capability?.name, "图像理解");
    assert.equal(capability?.description, "描述图片");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing databases gain the network access switch defaulting to allowed", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-legacy-"));
  // 复刻升级前的 runtime_settings 表结构，验证旧数据卷不会因为缺列而启动失败。
  const legacy = new DatabaseSync(path.join(directory, "model-ext-mcp.sqlite"));
  legacy.exec(`
    CREATE TABLE runtime_settings (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      max_image_bytes INTEGER NOT NULL CHECK (max_image_bytes BETWEEN 1024 AND 52428800),
      max_concurrent_requests INTEGER NOT NULL CHECK (max_concurrent_requests BETWEEN 1 AND 32),
      updated_at TEXT NOT NULL
    );
  `);
  legacy.prepare("INSERT INTO runtime_settings VALUES (1, 2097152, 6, ?)").run(new Date().toISOString());
  legacy.close();

  const database = new AppDatabase(directory);
  try {
    const settings = database.getRuntimeSettings();
    assert.equal(settings.maxImageBytes, 2_097_152);
    assert.equal(settings.maxConcurrentRequests, 6);
    // 默认放行，避免升级后原有 Agent 立刻连不上。
    assert.equal(settings.allowNetworkAccess, true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
