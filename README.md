# Model Relay

Model Relay 为不具备视觉能力的 Agent 提供 MCP 图像理解工具。它把图片转发给管理员配置的 Ollama 视觉模型，并通过一个控制页面管理能力、端点、模型部署与路由。

## 当前能力

- MCP Streamable HTTP 端点：`POST /mcp`
- `analyze_image` 工具，接收 JPEG、PNG、WebP 的 Base64 内容
- 多能力、多 Ollama 端点、多模型部署
- 同一能力支持按优先级配置多条回退路由
- 管理 API 与 MCP 使用自动生成的独立 Bearer Token，可在管理页查看和轮转
- 管理页可调整图片大小上限和模型调用并发数
- SQLite 持久化，容器重建后配置不丢失
- 图片大小、格式、并发数、Ollama 超时限制

## Docker 启动

1. 构建并启动：

   ```bash
   docker compose up -d --build
   ```

   数据默认保存在项目目录的 `./data`。如需修改宿主机保存位置，可复制 `.env.example` 为 `.env` 并设置 `DATA_DIR`。

2. 服务会自动生成凭据，并在每次容器启动时将管理员令牌和 MCP API Key 写入日志：

   ```bash
   docker compose logs model-ext-mcp
   ```

   查找 `access_credentials` 对应的 `adminToken` 和 `mcpApiKey`。
3. 打开 `http://localhost:3000`，输入该管理员令牌。
4. 在“访问凭据”中查看或轮转管理员令牌和 MCP API Key。
5. 在“运行限制”中设置单张图片大小和最大并发请求数。
6. 依次添加 Ollama 端点、模型部署和能力路由。

若 Ollama 运行在宿主机，端点通常填写 `http://host.docker.internal:11434`。Ollama 必须监听容器可访问的地址；容器内的 `localhost` 指向容器自身。

## MCP 客户端

连接地址为 `http://<服务器>:3000/mcp`。MCP API Key 可在管理页“访问凭据”中查看，请求头为：

```text
Authorization: Bearer <MCP_API_KEY>
```

工具参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `imageBase64` | 是 | 图片纯 Base64，或带前缀的数据 URI |
| `mimeType` | 是 | `image/jpeg`、`image/png`、`image/webp` |
| `prompt` | 否 | 希望视觉模型回答的问题 |
| `capabilityKey` | 否 | 默认 `image.describe` |

调用者不能指定 Ollama URL 或模型名；实际目标完全由服务端路由决定。

## 本地开发

需要 Node.js 24 和 pnpm 11：

```bash
pnpm install
pnpm dev
```

前端开发服务器为 `http://localhost:5173`，后端为 `http://localhost:3000`。首次创建开发数据库时，后端终端会输出管理员令牌。

## 健康检查

- `/health/live`：进程存活，不依赖 Ollama。
- `/health/ready`：数据库中至少存在一条完整启用的 `image.describe` 路由。

## 安全边界

- MCP 不接受远程图片 URL，避免图片下载引入 SSRF。
- Ollama 地址只能由管理员保存，且仅支持不含凭据的 HTTP/HTTPS 根地址。
- 按部署要求，服务会在每次启动时记录完整访问凭据；必须限制容器日志的读取权限和保留范围。
- 为支持页面查看，凭据保存在 `DATA_DIR` 下的 SQLite 数据库中；应限制该目录的读取权限并做好安全备份。
- 推荐置于反向代理之后启用 TLS，并限制管理页面的网络访问范围。

当前端点连接测试只能确认 Ollama 可访问并列出模型；“支持视觉”仍需管理员使用实际图片验证。
