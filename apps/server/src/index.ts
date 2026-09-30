import fs from "node:fs";
import path from "node:path";
import { toNodeHandler } from "@modelcontextprotocol/node";
import express from "express";
import { apiErrorHandler, bearerAuth, registerAdminApi } from "./api.js";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./database.js";
import { createVisionMcpHandler } from "./mcp.js";
import { VisionService } from "./service.js";

const config = loadConfig();
const database = new AppDatabase(config.DATA_DIR);
const service = new VisionService(database);
const app = express();

const startupCredentials = Object.fromEntries(database.listCredentials().map((credential) => [credential.kind, credential.token]));
// 用户要求每次启动可从容器日志恢复凭据，因此这里显式输出两类完整令牌。
console.warn(JSON.stringify({
  level: "warn",
  message: "access_credentials",
  adminToken: startupCredentials.admin,
  mcpApiKey: startupCredentials.mcp
}));

// MCP 请求包含 Base64 图片，限制编码后的请求体，避免在校验前耗尽内存。
// 运行限制可动态调低，解析层只保留数据库允许值的绝对硬上限。
app.use(express.json({ limit: Math.ceil(50 * 1_024 * 1_024 * 1.4 + 64_000) }));
app.disable("x-powered-by");

app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
app.get("/health/ready", (_request, response) => {
  const ready = database.hasReadyRoute();
  response.status(ready ? 200 : 503).json({ status: ready ? "ready" : "needs_configuration" });
});

const adminRouter = express.Router();
adminRouter.use(bearerAuth(() => database.getCredential("admin").token));
registerAdminApi(adminRouter, database);
adminRouter.use((_request, response) => response.status(404).json({ error: { code: "NOT_FOUND", message: "接口不存在" } }));
app.use("/api/v1", adminRouter);

const mcpNodeHandler = toNodeHandler(createVisionMcpHandler(service));
app.all("/mcp", bearerAuth(() => database.getCredential("mcp").token), (request, response) => {
  void mcpNodeHandler(request, response, request.body);
});

if (fs.existsSync(config.WEB_DIST_DIR)) {
  app.use(express.static(config.WEB_DIST_DIR, { index: false }));
  app.get("*path", (_request, response) => response.sendFile(path.join(config.WEB_DIST_DIR, "index.html")));
}

app.use(apiErrorHandler);

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(JSON.stringify({ level: "info", message: "server_started", host: config.HOST, port: config.PORT }));
});

function shutdown(): void {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
