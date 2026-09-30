import { useMemo, useState } from "react";
import { buildMcpConfigText, mcpServerUrl } from "../mcp-config";
import type { Credential } from "../types";

export type McpConfigCardProps = {
  credential: Credential | undefined;
  onCopied: (message: string) => void;
  onGoToSettings: () => void;
};

/**
 * 控制台的 MCP 接入卡片：把当前部署地址与 MCP API Key 拼成客户端配置。
 * 默认隐藏密钥，复制时才写入完整内容——与“访问凭据”卡片的隐藏约定保持一致。
 */
export function McpConfigCard({ credential, onCopied, onGoToSettings }: McpConfigCardProps) {
  const [revealed, setRevealed] = useState(false);
  const origin = window.location.origin;

  const visible = useMemo(
    () => buildMcpConfigText({ origin, apiKey: credential?.token ?? "", redacted: !revealed }),
    [origin, credential?.token, revealed]
  );

  async function copy(): Promise<void> {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(buildMcpConfigText({ origin, apiKey: credential.token }));
      onCopied("MCP 配置已复制，可直接粘贴到客户端配置文件中");
    } catch {
      onCopied("浏览器未允许复制，请展开密钥后手动复制");
    }
  }

  return (
    <section className="config-section">
      <div className="section-heading">
        <div>
          <h2>接入 MCP 客户端</h2>
          <p>把这份配置粘贴到支持 HTTP 传输的 MCP 客户端，例如 Claude Code 的 <code>.mcp.json</code>。</p>
        </div>
        {credential
          ? <div className="section-actions"><button className="secondary" onClick={() => setRevealed((current) => !current)}>{revealed ? "隐藏密钥" : "显示密钥"}</button><button onClick={() => void copy()}>一键复制</button></div>
          : <div className="section-actions"><button className="secondary" onClick={onGoToSettings}>去设置查看凭据</button></div>}
      </div>

      <div className="mcp-body">
        <div className="mcp-endpoint">
          <span>服务地址</span>
          <code>{mcpServerUrl(origin)}</code>
        </div>
        {credential
          ? <pre className="mcp-code"><code>{visible}</code></pre>
          : <p className="empty">尚未读取到 MCP API Key，请在“设置”中查看访问凭据。</p>}
        {credential && <p className="mcp-hint">复制的内容包含完整密钥；粘贴到客户端后请按 MCP API Key 的保密要求管理该文件。</p>}
      </div>
    </section>
  );
}
