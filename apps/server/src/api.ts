import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { findCapabilityDefinition, MCP_TOOL_NAME_PATTERN, viewCapabilityDefinition, type CapabilityDefinitionView } from "./capabilities.js";
import type { AppDatabase, CredentialKind } from "./database.js";
import type { Capability } from "./domain.js";
import { testOllamaEndpoint, type ImageInput } from "./ollama.js";
import type { VisionService } from "./service.js";

const capabilitySchema = z.object({
  // 标识就是 MCP 工具名，所以直接复用工具名规则：不合法的话 Agent 侧根本调不动。
  // 留空表示采用代码默认值；非空标识仍必须符合工具名约束。
  key: z.string().trim().refine((value) => value === "" || MCP_TOOL_NAME_PATTERN.test(value), "标识即 MCP 工具名，只能用小写字母开头，后接小写字母、数字、下划线或短横线，长度 2-64").default(""),
  name: z.string().trim().max(80).default(""),
  description: z.string().trim().max(500).default(""),
  enabled: z.boolean().default(true),
  version: z.number().int().positive().optional()
});

const endpointSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().transform(normalizeOllamaUrl),
  enabled: z.boolean().default(true)
});

const deploymentSchema = z.object({
  endpointId: z.string().uuid(),
  modelName: z.string().trim().min(1).max(160),
  supportsVision: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  enabled: z.boolean().default(true)
});

const routeSchema = z.object({
  capabilityId: z.string().uuid(),
  deploymentId: z.string().uuid(),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true)
});

const capabilityConfigurationSchema = capabilitySchema.omit({ enabled: true }).extend({
  version: z.number().int().positive(),
  routes: z.array(deploymentSchema.omit({ enabled: true }).extend({
    id: z.string().uuid().optional(),
    priority: routeSchema.shape.priority,
    enabled: routeSchema.shape.enabled
  }))
});

const runtimeSettingsSchema = z.object({
  maxImageBytes: z.number().int().min(1_024).max(50 * 1_024 * 1_024),
  maxConcurrentRequests: z.number().int().min(1).max(32),
  allowNetworkAccess: z.boolean()
});

export function normalizeOllamaUrl(value: string): string {
  const url = new URL(value);
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new Error("仅支持 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("URL 不能包含凭据");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("请输入 Ollama 服务根地址");
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function bearerAuth(expectedToken: string | (() => string)) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const authorization = request.header("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    const currentToken = typeof expectedToken === "function" ? expectedToken() : expectedToken;
    if (!tokenMatches(token, currentToken)) {
      response.status(401).json({ error: { code: "UNAUTHORIZED", message: "访问凭据无效" } });
      return;
    }
    next();
  };
}

/** 只读的代码侧定义与数据库行合并后返回，管理端据此展示参数等不可编辑信息。 */
function toCapabilityView(capability: Capability): Capability & { definition: CapabilityDefinitionView | null } {
  const definition = findCapabilityDefinition(capability.definitionKey);
  return { ...capability, definition: definition ? viewCapabilityDefinition(definition) : null };
}

export function registerAdminApi(router: Router, database: AppDatabase, service: VisionService): void {
  router.get("/settings", (_request, response) => response.json(database.getRuntimeSettings()));
  router.put("/settings", (request, response) => {
    response.json(database.updateRuntimeSettings(runtimeSettingsSchema.parse(request.body)));
  });

  router.get("/security", (_request, response) => response.json(database.listCredentials()));
  router.post("/security/:kind/rotate", (request, response) => {
    const kind = z.enum(["admin", "mcp"]).parse(request.params.kind) as CredentialKind;
    response.json(database.rotateCredential(kind));
  });

  // 能力集合由代码注册表决定：没有新增与删除，只允许改名称、标识、描述与启用状态。
  router.get("/capabilities", (_request, response) => response.json(database.listCapabilities().map(toCapabilityView)));
  router.put("/capabilities/:id", (request, response) => {
    const input = capabilitySchema.extend({ version: z.number().int().positive() }).parse(request.body);
    response.json(toCapabilityView(database.updateCapability(request.params.id!, input)));
  });
  router.patch("/capabilities/:id/enabled", (request, response) => {
    const input = z.object({ enabled: z.boolean(), version: z.number().int().positive() }).parse(request.body);
    response.json(toCapabilityView(database.updateCapabilityEnabled(request.params.id!, input)));
  });
  // 一次保存整个编辑弹窗，避免逐个请求造成能力与路由不一致。
  router.put("/capabilities/:id/configuration", (request, response) => {
    const input = capabilityConfigurationSchema.parse(request.body);
    response.json(toCapabilityView(database.updateCapabilityConfiguration(request.params.id!, input)));
  });

  // 能力测试：拿代码里的静态样例输入去打真实链路。失败也返回 200 + 诊断，
  // 因为「哪条路由、哪个模型、卡在哪一步」正是管理员点这个按钮想知道的东西。
  // 异步路由的拒绝由 Express 5 自动交给 apiErrorHandler，无需逐路由转发。
  router.post("/capabilities/:id/test", async (request, response) => {
    const capability = database.listCapabilities().find((item) => item.id === request.params.id);
    if (!capability) throw new Error("NOT_FOUND");
    const definition = findCapabilityDefinition(capability.definitionKey);
    if (!definition) {
      response.status(404).json({ error: { code: "NO_DEFINITION", message: "该能力的代码定义已不存在，无法测试" } });
      return;
    }
    // 样例先过一遍能力自己的入参契约：样例漂移时在这里就暴露，而不是拿坏参数去打上游。
    const input = definition.inputSchema.parse(definition.sampleInput) as ImageInput;
    response.json(await service.testCapability(capability.key, input, randomUUID()));
  });

  router.get("/endpoints", (_request, response) => response.json(database.listEndpoints()));
  router.post("/endpoints", (request, response) => response.status(201).json(database.createEndpoint(endpointSchema.parse(request.body))));
  // 启用状态由列表开关单独保存；旧编辑请求携带的 enabled 也不能覆盖较新的开关状态。
  router.put("/endpoints/:id", (request, response) => response.json(database.updateEndpoint(request.params.id!, endpointSchema.omit({ enabled: true }).parse(request.body))));
  router.patch("/endpoints/:id/enabled", (request, response) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    response.json(database.updateEndpointEnabled(request.params.id!, enabled));
  });
  router.delete("/endpoints/:id", (request, response) => {
    database.deleteEndpoint(request.params.id!);
    response.status(204).end();
  });
  router.post("/endpoints/test", async (request, response) => {
    const { baseUrl } = endpointSchema.pick({ baseUrl: true }).parse(request.body);
    response.json(await testOllamaEndpoint(baseUrl));
  });

  router.get("/deployments", (_request, response) => response.json(database.listDeployments()));
  router.post("/deployments", (request, response) => response.status(201).json(database.createDeployment(deploymentSchema.parse(request.body))));
  router.put("/deployments/:id", (request, response) => response.json(database.updateDeployment(request.params.id!, deploymentSchema.parse(request.body))));
  router.delete("/deployments/:id", (request, response) => {
    database.deleteDeployment(request.params.id!);
    response.status(204).end();
  });

  router.get("/routes", (_request, response) => response.json(database.listRoutes()));
  router.post("/routes", (request, response) => response.status(201).json(database.createRoute(routeSchema.parse(request.body))));
  router.put("/routes/:id", (request, response) => response.json(database.updateRoute(request.params.id!, routeSchema.parse(request.body))));
  router.delete("/routes/:id", (request, response) => {
    database.deleteRoute(request.params.id!);
    response.status(204).end();
  });
}

export function apiErrorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "输入无效" } });
    return;
  }
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (message === "INVALID_CONFIGURATION") {
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "路由或外部能力不存在，或路由不属于当前能力" } });
    return;
  }
  if (message === "NOT_FOUND") {
    response.status(404).json({ error: { code: message, message: "记录不存在" } });
    return;
  }
  if (message === "VERSION_CONFLICT") {
    response.status(409).json({ error: { code: message, message: "配置已被其他会话更新，请刷新后重试" } });
    return;
  }
  const sqliteCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (sqliteCode.includes("CONSTRAINT") || message.includes("constraint failed")) {
    response.status(409).json({ error: { code: "CONFLICT", message: "记录重复或仍被其他配置引用" } });
    return;
  }
  response.status(502).json({ error: { code: "UPSTREAM_ERROR", message: "Ollama 服务连接或响应异常" } });
}
