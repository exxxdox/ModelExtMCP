import { randomUUID } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { CAPABILITY_KEY_PARAMETER_DESCRIPTION, IMAGE_INPUT_SCHEMA } from "./capabilities.js";
import type { AppDatabase } from "./database.js";
import type { Capability } from "./domain.js";
import type { VisionService } from "./service.js";

const TOOL_NAME = "analyze_image";
const TOOL_TITLE = "Analyze image with a configured vision model";
const TOOL_DESCRIPTION = "When the current model cannot see images, send an image to a configured Ollama vision model.";

/** Agent 侧看到的动态说明：工具描述里的能力清单，以及省略 capabilityKey 时的默认值。 */
export type AgentCapabilityView = {
  toolDescription: string;
  capabilityKeyDescription: string;
};

/**
 * 能力说明是管理员自由文本（管理 API 只做长度校验），里面的换行会伪造出额外的清单条目，
 * 所以拼进工具描述前压平成单行。信任边界：能改这段文字的人已经持有管理员令牌，
 * 与改提示词模板是同一层权限，这里只做格式归一，不做内容审查。
 */
function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 把启用能力拼成 Agent 可读的说明。
 *
 * 为什么用能力的 description 而不另起字段：description 本身就是「这个能力是干什么的」，
 * 它既是管理端编辑的对象，也必须是 Agent 判断该不该调用这个能力的唯一依据，同一份文本
 * 才不会出现「管理端写的」和「Agent 读到的」不一致。
 *
 * 能力清单放在工具描述里而不放参数说明里：Agent 先读工具描述决定要不要调用这个工具，
 * 同一份清单一处出现即可。
 *
 * 为什么判据是 enabled 而不是「有没有可用路由」：路由、部署、端点是否健康是随时变化的
 * 运行状态，Ollama 掉线也会让路由暂时解析不出来。把它写进能力语义，会让 Agent 以为这个
 * 能力不存在；而实际状态已经由 /health/ready 暴露给管理员，失败也会以 NO_ACTIVE_ROUTE
 * 返回给调用方。
 */
export function describeCapabilitiesForAgent(
  capabilities: readonly Capability[],
  defaultCapabilityKey: string
): AgentCapabilityView {
  const enabled = capabilities.filter((capability) => capability.enabled);
  const defaultIsUsable = enabled.some((capability) => capability.key === defaultCapabilityKey);

  return {
    toolDescription: enabled.length === 0
      ? `${TOOL_DESCRIPTION}\n当前没有启用的能力。`
      : [TOOL_DESCRIPTION, "可用能力：", ...enabled.map((capability) => `- ${capability.key}：${toSingleLine(capability.description)}`)].join("\n"),
    // 默认能力被停用时不能再说「省略即可」，否则 Agent 会照着一个失效的默认值调用并拿到 NO_ACTIVE_ROUTE。
    capabilityKeyDescription: defaultIsUsable
      ? `${CAPABILITY_KEY_PARAMETER_DESCRIPTION} ${defaultCapabilityKey}`
      : "要调用的能力标识，当前默认能力不可用，必须显式指定"
  };
}

export function createVisionMcpHandler(service: VisionService, database: AppDatabase) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: "model-ext-mcp", version: "0.1.0" });
      // factory 每个 HTTP 请求都会重建 server，所以这里读到的是最新配置：
      // 管理员改完 Agent 可见说明，下一次 tools/list 就生效，无需重启服务。
      const capabilities = describeCapabilitiesForAgent(database.listCapabilities(), database.getDefaultCapabilityKey());

      server.registerTool(
        TOOL_NAME,
        {
          title: TOOL_TITLE,
          description: capabilities.toolDescription,
          inputSchema: IMAGE_INPUT_SCHEMA.extend({
            capabilityKey: IMAGE_INPUT_SCHEMA.shape.capabilityKey.describe(capabilities.capabilityKeyDescription)
          })
        },
        async (input) => {
          try {
            const result = await service.analyze(input.capabilityKey, input, randomUUID());
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
      return server;
    },
    { responseMode: "json" }
  );
}
