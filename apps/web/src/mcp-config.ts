/**
 * 生成 MCP 客户端可直接粘贴的配置。
 * 单独放在纯函数模块里，是因为“复制出去的内容是否可用”最容易出错：
 * URL 拼接、Bearer 前缀、JSON 结构都必须先被测试覆盖，再交给页面渲染。
 */
export const MCP_PATH = "/mcp";
export const DEFAULT_SERVER_NAME = "model-relay";

const REDACTED_PLACEHOLDER = "••••••••••••";

export type McpConfigOptions = {
  /** 页面所在源，即 `window.location.origin`。 */
  origin: string;
  apiKey: string;
  serverName?: string;
  /** 为 true 时用占位符替换密钥，用于屏幕展示而非复制。 */
  redacted?: boolean;
};

export type McpServerConfig = {
  mcpServers: Record<string, {
    type: "http";
    url: string;
    headers: { Authorization: string };
  }>;
};

/** 去掉末尾斜杠再拼接，避免出现 `//mcp` 这类客户端无法识别的地址。 */
export function mcpServerUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${MCP_PATH}`;
}

/** 固定长度占位符：既不泄露密钥，也不通过字符数暴露密钥长度。 */
export function redactApiKey(): string {
  return REDACTED_PLACEHOLDER;
}

export function buildMcpConfig(options: McpConfigOptions): McpServerConfig {
  const name = options.serverName ?? DEFAULT_SERVER_NAME;
  const key = options.redacted ? redactApiKey() : options.apiKey;

  return {
    mcpServers: {
      [name]: {
        type: "http",
        url: mcpServerUrl(options.origin),
        headers: { Authorization: `Bearer ${key}` }
      }
    }
  };
}

export function buildMcpConfigText(options: McpConfigOptions): string {
  return JSON.stringify(buildMcpConfig(options), null, 2);
}
