import { randomUUID } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { IMAGE_INPUT_SCHEMA } from "./capabilities.js";
import type { AppDatabase } from "./database.js";
import type { Capability } from "./domain.js";
import type { VisionService } from "./service.js";

/** Agent 侧看到的工具：能力与工具一一对应，标识即工具名，说明即工具描述的全部。 */
export type AgentToolView = {
  name: string;
  title: string;
  description: string;
};

/**
 * 把启用能力映射成 MCP 工具。
 *
 * 为什么一个能力一个工具，而不是「一个工具 + capabilityKey 参数」：能力之间的区别就是
 * 「什么时候该用它」，而这是模型读工具描述做的选择。摊平成一个参数后，模型要先读描述
 * 再猜参数，等于同一件事说两遍。新增能力就是新增一个工具。
 *
 * 为什么工具描述就是能力说明本身，不再拼接前缀或能力清单：这段文字是管理员写给 Agent 的
 * 唯一依据，只要还能被拼上别的内容，「管理端写的」与「Agent 读到的」就还有分叉的余地。
 * 停用的能力不下发，等于从工具列表里消失，而不是留一个调用必然失败的条目。
 */
export function describeCapabilityTools(capabilities: readonly Capability[]): AgentToolView[] {
  return capabilities
    .filter((capability) => capability.enabled)
    .map((capability) => ({
      name: capability.key,
      title: capability.name,
      description: capability.description
    }));
}

export function createVisionMcpHandler(service: VisionService, database: AppDatabase) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: "model-ext-mcp", version: "0.1.0" });
      // factory 每个 HTTP 请求都会重建 server，所以这里读到的是最新配置：
      // 管理员改完工具名、名称或说明，下一次 tools/list 就生效，无需重启服务。
      for (const tool of describeCapabilityTools(database.listCapabilities())) {
        server.registerTool(
          tool.name,
          {
            title: tool.title,
            description: tool.description,
            inputSchema: IMAGE_INPUT_SCHEMA
          },
          async (input) => {
            try {
              // 工具名即能力标识：调用方没有可选的能力参数，服务端按工具名解析路由。
              const result = await service.analyze(tool.name, input, randomUUID());
              return {
                content: [{ type: "text" as const, text: result.text }],
                structuredContent: result
              };
            } catch (error) {
              const code = error instanceof Error ? error.message : "VISION_ANALYSIS_FAILED";
              return {
                isError: true,
                content: [{ type: "text" as const, text: `图像分析失败：${code}` }]
              };
            }
          }
        );
      }
      return server;
    },
    { responseMode: "json" }
  );
}
