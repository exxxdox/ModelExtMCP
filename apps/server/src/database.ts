import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
export type RuntimeSettings = { maxImageBytes: number; maxConcurrentRequests: number; updatedAt: string };

function asBoolean(value: unknown): boolean {
  return value === 1;
}

function mapCapability(row: DatabaseRow): Capability {
  return {
    id: String(row.id),
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
        updated_at TEXT NOT NULL
      );
    `);
  }

  private seed(): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO capabilities
        (id, key, name, description, executor_type, enabled, version, created_at, updated_at)
      VALUES (?, 'image.describe', '图像理解', '描述图片内容并回答关于图片的问题', 'ollama_vision', 1, 1, ?, ?)
    `).run(randomUUID(), now, now);
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
        (singleton_id, max_image_bytes, max_concurrent_requests, updated_at)
      VALUES (1, 10485760, 4, ?)
    `).run(new Date().toISOString());
  }

  getRuntimeSettings(): RuntimeSettings {
    const row = this.db.prepare("SELECT * FROM runtime_settings WHERE singleton_id = 1").get() as DatabaseRow | undefined;
    if (!row) throw new Error("NOT_FOUND");
    return {
      maxImageBytes: Number(row.max_image_bytes),
      maxConcurrentRequests: Number(row.max_concurrent_requests),
      updatedAt: String(row.updated_at)
    };
  }

  updateRuntimeSettings(input: Pick<RuntimeSettings, "maxImageBytes" | "maxConcurrentRequests">): RuntimeSettings {
    this.db.prepare(`
      UPDATE runtime_settings SET max_image_bytes = ?, max_concurrent_requests = ?, updated_at = ? WHERE singleton_id = 1
    `).run(input.maxImageBytes, input.maxConcurrentRequests, new Date().toISOString());
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

  createCapability(input: Pick<Capability, "key" | "name" | "description" | "enabled">): Capability {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO capabilities (id, key, name, description, executor_type, enabled, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ollama_vision', ?, 1, ?, ?)
    `).run(id, input.key, input.name, input.description, Number(input.enabled), now, now);
    return this.getCapability(id);
  }

  updateCapability(id: string, input: Pick<Capability, "key" | "name" | "description" | "enabled" | "version">): Capability {
    const result = this.db.prepare(`
      UPDATE capabilities SET key = ?, name = ?, description = ?, enabled = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?
    `).run(input.key, input.name, input.description, Number(input.enabled), new Date().toISOString(), id, input.version);
    if (result.changes === 0) throw new Error("VERSION_CONFLICT");
    return this.getCapability(id);
  }

  deleteCapability(id: string): void {
    this.deleteById("capabilities", id);
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
    const rows = this.db.prepare(`
      SELECT r.*, c.key AS capability_key, c.name AS capability_name,
             e.name AS endpoint_name, e.base_url, d.model_name, d.timeout_ms
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
      capabilityKey: String(row.capability_key),
      capabilityName: String(row.capability_name),
      endpointName: String(row.endpoint_name),
      baseUrl: String(row.base_url),
      modelName: String(row.model_name),
      timeoutMs: Number(row.timeout_ms)
    }));
  }

  hasReadyRoute(): boolean {
    return this.resolveRoutes("image.describe").length > 0;
  }

  private deleteById(table: "capabilities" | "ollama_endpoints" | "model_deployments" | "capability_routes", id: string): void {
    const result = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (result.changes === 0) throw new Error("NOT_FOUND");
  }
}

function generateAccessToken(): string {
  // 使用 256 位随机值，令牌可直接用于 Bearer 鉴权且不依赖外部密钥服务。
  return randomBytes(32).toString("base64url");
}
