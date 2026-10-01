import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  MCP_TOOL_NAME_PATTERN,
  PRIMARY_CAPABILITY_DEFINITION_KEY,
  VISION_CAPABILITY_DEFINITIONS
} from "./capabilities.js";
import type {
  Capability,
  CapabilityRoute,
  ModelDeployment,
  OllamaEndpoint,
  ResolvedRoute
} from "./domain.js";

type DatabaseRow = Record<string, unknown>;
export type CredentialKind = "admin" | "mcp";
export type AccessCredential = { kind: CredentialKind; token: string; updatedAt: string };
export type RuntimeSettings = {
  maxImageBytes: number;
  maxConcurrentRequests: number;
  /** 是否允许网络访问 MCP 端点；关闭时只接受本机与本机网段的调用。 */
  allowNetworkAccess: boolean;
  updatedAt: string;
};

function asBoolean(value: unknown): boolean {
  return value === 1;
}

function mapCapability(row: DatabaseRow): Capability {
  return {
    id: String(row.id),
    definitionKey: String(row.definition_key),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description),
    executorType: "ollama_vision",
    enabled: asBoolean(row.enabled),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapEndpoint(row: DatabaseRow): OllamaEndpoint {
  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.base_url),
    enabled: asBoolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapDeployment(row: DatabaseRow): ModelDeployment {
  return {
    id: String(row.id),
    endpointId: String(row.endpoint_id),
    modelName: String(row.model_name),
    supportsVision: asBoolean(row.supports_vision),
    timeoutMs: Number(row.timeout_ms),
    enabled: asBoolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapRoute(row: DatabaseRow): CapabilityRoute {
  return {
    id: String(row.id),
    capabilityId: String(row.capability_id),
    deploymentId: String(row.deployment_id),
    priority: Number(row.priority),
    promptTemplate: String(row.prompt_template),
    enabled: asBoolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(dataDirectory: string) {
    fs.mkdirSync(dataDirectory, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDirectory, "model-ext-mcp.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
    this.seed();
    this.ensureCredentials();
    this.ensureRuntimeSettings();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    // 表按领域边界拆分，避免未来新增 provider 或多路由时迁移整张能力表。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capabilities (
        id TEXT PRIMARY KEY,
        definition_key TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        executor_type TEXT NOT NULL CHECK (executor_type = 'ollama_vision'),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ollama_endpoints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_deployments (
        id TEXT PRIMARY KEY,
        endpoint_id TEXT NOT NULL REFERENCES ollama_endpoints(id) ON DELETE RESTRICT,
        model_name TEXT NOT NULL,
        supports_vision INTEGER NOT NULL DEFAULT 1 CHECK (supports_vision IN (0, 1)),
        timeout_ms INTEGER NOT NULL DEFAULT 60000,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(endpoint_id, model_name)
      );
      CREATE TABLE IF NOT EXISTS capability_routes (
        id TEXT PRIMARY KEY,
        capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE RESTRICT,
        deployment_id TEXT NOT NULL REFERENCES model_deployments(id) ON DELETE RESTRICT,
        priority INTEGER NOT NULL DEFAULT 100,
        prompt_template TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(capability_id, deployment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_routes_resolution
        ON capability_routes(capability_id, enabled, priority);
      CREATE TABLE IF NOT EXISTS access_credentials (
        kind TEXT PRIMARY KEY CHECK (kind IN ('admin', 'mcp')),
        token TEXT NOT NULL UNIQUE,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_settings (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        max_image_bytes INTEGER NOT NULL CHECK (max_image_bytes BETWEEN 1024 AND 52428800),
        max_concurrent_requests INTEGER NOT NULL CHECK (max_concurrent_requests BETWEEN 1 AND 32),
        allow_network_access INTEGER NOT NULL DEFAULT 1 CHECK (allow_network_access IN (0, 1)),
        updated_at TEXT NOT NULL
      );
    `);
    this.addMissingColumns();
    this.migrateCapabilityDefinitionKeys();
    this.migrateCapabilityKeysToToolNames();
  }

  /**
   * 能力标识就是 MCP 工具名，而工具名只接受 [a-z0-9_-]：旧库里的标识（如 image.describe）
   * 会被客户端拒绝，必须在启动时改写成合法形式。
   *
   * 改写规则只动非法字符，管理员起的名字与含义都保留；撞名时补数字后缀，
   * 免得 UNIQUE 约束让服务直接起不来。这里不碰 updated_at/version：迁移不是管理员的一次编辑，
   * 不应当成乐观锁意义上的「配置已变更」。
   */
  private migrateCapabilityKeysToToolNames(): void {
    const rows = this.db.prepare("SELECT id, key FROM capabilities").all() as DatabaseRow[];
    const taken = new Set(rows.map((row) => String(row.key)));
    for (const row of rows) {
      const id = String(row.id);
      const current = String(row.key);
      if (MCP_TOOL_NAME_PATTERN.test(current)) continue;
      taken.delete(current);

      const sanitized = current.toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/^[^a-z]+/, "");
      const base = sanitized || "capability";
      let candidate = base;
      for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}_${suffix}`;

      taken.add(candidate);
      this.db.prepare("UPDATE capabilities SET key = ? WHERE id = ?").run(candidate, id);
    }
  }

  /**
   * definition_key 是后来引入的不可变代码标识。旧库没有该列，且其中的 key 可能
   * 已被管理员改过，因此按注册表的首个定义回填——升级前的库里只有代码内置的那一个能力。
   */
  private migrateCapabilityDefinitionKeys(): void {
    const columns = this.db.prepare("PRAGMA table_info(capabilities)").all() as DatabaseRow[];
    if (!columns.some((column) => String(column.name) === "definition_key")) {
      this.db.exec("ALTER TABLE capabilities ADD COLUMN definition_key TEXT NOT NULL DEFAULT '';");
      this.db.prepare("UPDATE capabilities SET definition_key = ? WHERE definition_key = ''")
        .run(PRIMARY_CAPABILITY_DEFINITION_KEY);
    }
    // 唯一索引在两条路径上都要有：新建表与旧表补列（SQLite 不允许 ALTER 直接加 UNIQUE 列）。
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_capabilities_definition_key ON capabilities(definition_key);");
  }

  /**
   * CREATE TABLE IF NOT EXISTS 不会给已存在的表补列，升级时旧数据卷会缺列，
   * 因此这里显式检查并补齐；默认值 1 让升级后行为与升级前一致。
   */
  private addMissingColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(runtime_settings)").all() as DatabaseRow[];
    const hasColumn = columns.some((column) => String(column.name) === "allow_network_access");
    if (hasColumn) return;
    this.db.exec("ALTER TABLE runtime_settings ADD COLUMN allow_network_access INTEGER NOT NULL DEFAULT 1 CHECK (allow_network_access IN (0, 1));");
  }

  /**
   * 能力集合来自代码注册表，按 definition_key 写入：管理员改过 key 之后重启不会
   * 再插入一行重复能力。名称与描述只在首次写入时取注册表默认值。
   */
  private seed(): void {
    const now = new Date().toISOString();
    for (const definition of VISION_CAPABILITY_DEFINITIONS) {
      this.db.prepare(`
        INSERT OR IGNORE INTO capabilities
          (id, definition_key, key, name, description, executor_type, enabled, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
      `).run(
        randomUUID(),
        definition.definitionKey,
        definition.defaultKey,
        definition.defaultName,
        definition.defaultDescription,
        definition.executorType,
        now,
        now
      );
    }
  }

  private ensureCredentials(): void {
    const existingAdmin = this.db.prepare("SELECT token FROM access_credentials WHERE kind = 'admin'").get() as DatabaseRow | undefined;
    const now = new Date().toISOString();
    if (!existingAdmin) {
      const initialAdminToken = generateAccessToken();
      this.db.prepare("INSERT INTO access_credentials (kind, token, updated_at) VALUES ('admin', ?, ?)")
        .run(initialAdminToken, now);
    }
    const existingMcp = this.db.prepare("SELECT token FROM access_credentials WHERE kind = 'mcp'").get();
    if (!existingMcp) {
      this.db.prepare("INSERT INTO access_credentials (kind, token, updated_at) VALUES ('mcp', ?, ?)")
        .run(generateAccessToken(), now);
    }
  }

  private ensureRuntimeSettings(): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO runtime_settings
        (singleton_id, max_image_bytes, max_concurrent_requests, allow_network_access, updated_at)
      VALUES (1, 10485760, 4, 1, ?)
    `).run(new Date().toISOString());
  }

  getRuntimeSettings(): RuntimeSettings {
    const row = this.db.prepare("SELECT * FROM runtime_settings WHERE singleton_id = 1").get() as DatabaseRow | undefined;
    if (!row) throw new Error("NOT_FOUND");
    return {
      maxImageBytes: Number(row.max_image_bytes),
      maxConcurrentRequests: Number(row.max_concurrent_requests),
      allowNetworkAccess: asBoolean(row.allow_network_access),
      updatedAt: String(row.updated_at)
    };
  }

  /** 是否允许网络访问 MCP；设置缺失时按放行处理，避免误挡正常运行。 */
  isNetworkAccessAllowed(): boolean {
    return this.getRuntimeSettings().allowNetworkAccess;
  }

  updateRuntimeSettings(input: Pick<RuntimeSettings, "maxImageBytes" | "maxConcurrentRequests" | "allowNetworkAccess">): RuntimeSettings {
    this.db.prepare(`
      UPDATE runtime_settings SET max_image_bytes = ?, max_concurrent_requests = ?, allow_network_access = ?, updated_at = ? WHERE singleton_id = 1
    `).run(input.maxImageBytes, input.maxConcurrentRequests, Number(input.allowNetworkAccess), new Date().toISOString());
    return this.getRuntimeSettings();
  }

  getCredential(kind: CredentialKind): AccessCredential {
    const row = this.db.prepare("SELECT * FROM access_credentials WHERE kind = ?").get(kind) as DatabaseRow | undefined;
    if (!row) throw new Error("NOT_FOUND");
    return { kind, token: String(row.token), updatedAt: String(row.updated_at) };
  }

  listCredentials(): AccessCredential[] {
    return (["admin", "mcp"] as const).map((kind) => this.getCredential(kind));
  }

  rotateCredential(kind: CredentialKind): AccessCredential {
    const token = generateAccessToken();
    const updatedAt = new Date().toISOString();
    this.db.prepare("UPDATE access_credentials SET token = ?, updated_at = ? WHERE kind = ?")
      .run(token, updatedAt, kind);
    return { kind, token, updatedAt };
  }

  listCapabilities(): Capability[] {
    return this.db.prepare("SELECT * FROM capabilities ORDER BY created_at").all().map(mapCapability);
  }

  updateCapability(id: string, input: Pick<Capability, "key" | "name" | "description" | "enabled" | "version">): Capability {
    const result = this.db.prepare(`
      UPDATE capabilities SET key = ?, name = ?, description = ?, enabled = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?
    `).run(input.key, input.name, input.description, Number(input.enabled), new Date().toISOString(), id, input.version);
    if (result.changes === 0) throw new Error("VERSION_CONFLICT");
    return this.getCapability(id);
  }

  /**
   * 主能力的当前标识（管理员可改），只服务健康检查：MCP 调用一定带工具名，
   * 不再有需要服务端兜底解析的调用。
   */
  getDefaultCapabilityKey(): string {
    const row = this.db.prepare("SELECT key FROM capabilities WHERE definition_key = ?")
      .get(PRIMARY_CAPABILITY_DEFINITION_KEY) as DatabaseRow | undefined;
    if (row) return String(row.key);
    const fallback = this.db.prepare("SELECT key FROM capabilities ORDER BY created_at").get() as DatabaseRow | undefined;
    if (!fallback) throw new Error("NO_CAPABILITY");
    return String(fallback.key);
  }

  private getCapability(id: string): Capability {
    const row = this.db.prepare("SELECT * FROM capabilities WHERE id = ?").get(id);
    if (!row) throw new Error("NOT_FOUND");
    return mapCapability(row);
  }

  listEndpoints(): OllamaEndpoint[] {
    return this.db.prepare("SELECT * FROM ollama_endpoints ORDER BY created_at").all().map(mapEndpoint);
  }

  createEndpoint(input: Pick<OllamaEndpoint, "name" | "baseUrl" | "enabled">): OllamaEndpoint {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO ollama_endpoints (id, name, base_url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, input.name, input.baseUrl, Number(input.enabled), now, now);
    return mapEndpoint(this.db.prepare("SELECT * FROM ollama_endpoints WHERE id = ?").get(id)!);
  }

  updateEndpoint(id: string, input: Pick<OllamaEndpoint, "name" | "baseUrl" | "enabled">): OllamaEndpoint {
    const result = this.db.prepare(`UPDATE ollama_endpoints SET name = ?, base_url = ?, enabled = ?, updated_at = ? WHERE id = ?`)
      .run(input.name, input.baseUrl, Number(input.enabled), new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("NOT_FOUND");
    return mapEndpoint(this.db.prepare("SELECT * FROM ollama_endpoints WHERE id = ?").get(id)!);
  }

  deleteEndpoint(id: string): void {
    this.deleteById("ollama_endpoints", id);
  }

  listDeployments(): ModelDeployment[] {
    return this.db.prepare("SELECT * FROM model_deployments ORDER BY created_at").all().map(mapDeployment);
  }

  createDeployment(input: Pick<ModelDeployment, "endpointId" | "modelName" | "supportsVision" | "timeoutMs" | "enabled">): ModelDeployment {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO model_deployments (id, endpoint_id, model_name, supports_vision, timeout_ms, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.endpointId, input.modelName, Number(input.supportsVision), input.timeoutMs, Number(input.enabled), now, now);
    return mapDeployment(this.db.prepare("SELECT * FROM model_deployments WHERE id = ?").get(id)!);
  }

  updateDeployment(id: string, input: Pick<ModelDeployment, "endpointId" | "modelName" | "supportsVision" | "timeoutMs" | "enabled">): ModelDeployment {
    const result = this.db.prepare(`
      UPDATE model_deployments SET endpoint_id = ?, model_name = ?, supports_vision = ?, timeout_ms = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(input.endpointId, input.modelName, Number(input.supportsVision), input.timeoutMs, Number(input.enabled), new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("NOT_FOUND");
    return mapDeployment(this.db.prepare("SELECT * FROM model_deployments WHERE id = ?").get(id)!);
  }

  deleteDeployment(id: string): void {
    this.deleteById("model_deployments", id);
  }

  listRoutes(): CapabilityRoute[] {
    return this.db.prepare("SELECT * FROM capability_routes ORDER BY priority, created_at").all().map(mapRoute);
  }

  createRoute(input: Pick<CapabilityRoute, "capabilityId" | "deploymentId" | "priority" | "promptTemplate" | "enabled">): CapabilityRoute {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO capability_routes (id, capability_id, deployment_id, priority, prompt_template, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.capabilityId, input.deploymentId, input.priority, input.promptTemplate, Number(input.enabled), now, now);
    return mapRoute(this.db.prepare("SELECT * FROM capability_routes WHERE id = ?").get(id)!);
  }

  updateRoute(id: string, input: Pick<CapabilityRoute, "capabilityId" | "deploymentId" | "priority" | "promptTemplate" | "enabled">): CapabilityRoute {
    const result = this.db.prepare(`
      UPDATE capability_routes SET capability_id = ?, deployment_id = ?, priority = ?, prompt_template = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(input.capabilityId, input.deploymentId, input.priority, input.promptTemplate, Number(input.enabled), new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("NOT_FOUND");
    return mapRoute(this.db.prepare("SELECT * FROM capability_routes WHERE id = ?").get(id)!);
  }

  deleteRoute(id: string): void {
    this.deleteById("capability_routes", id);
  }

  resolveRoutes(capabilityKey: string): ResolvedRoute[] {
    // 能力标识只用于筛选，执行器不需要回传能力标识和名称。
    const rows = this.db.prepare(`
      SELECT r.*, e.name AS endpoint_name, e.base_url, d.model_name, d.timeout_ms
      FROM capability_routes r
      JOIN capabilities c ON c.id = r.capability_id
      JOIN model_deployments d ON d.id = r.deployment_id
      JOIN ollama_endpoints e ON e.id = d.endpoint_id
      WHERE c.key = ? AND c.enabled = 1 AND r.enabled = 1
        AND d.enabled = 1 AND d.supports_vision = 1 AND e.enabled = 1
      ORDER BY r.priority ASC, r.created_at ASC
    `).all(capabilityKey);
    return rows.map((row) => ({
      ...mapRoute(row),
      endpointName: String(row.endpoint_name),
      baseUrl: String(row.base_url),
      modelName: String(row.model_name),
      timeoutMs: Number(row.timeout_ms)
    }));
  }

  /**
   * 默认能力是否已经有可用路由。用 getDefaultCapabilityKey() 而不是写死标识：
   * 管理员改过默认能力的 key 之后，写死的字面量会让 /health/ready 永远报未就绪。
   */
  hasReadyRoute(): boolean {
    return this.resolveRoutes(this.getDefaultCapabilityKey()).length > 0;
  }

  private deleteById(table: "ollama_endpoints" | "model_deployments" | "capability_routes", id: string): void {
    const result = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (result.changes === 0) throw new Error("NOT_FOUND");
  }
}

function generateAccessToken(): string {
  // 使用 256 位随机值，令牌可直接用于 Bearer 鉴权且不依赖外部密钥服务。
  return randomBytes(32).toString("base64url");
}
