import { RuntimeSettingsPanel } from "../components/RuntimeSettingsPanel";
import { PageHeader, SectionHeader } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";

export type SettingsPageProps = { data: AdminData };

/** 设置：与业务配置无关的两块——访问凭据和运行限制。 */
export function SettingsPage({ data }: SettingsPageProps) {
  return (
    <>
      <PageHeader title="设置" description="管理端与 MCP 调用端的凭据，以及 MCP 的网络可达范围与资源限制。" />

      <section className="config-section">
        <SectionHeader title="访问凭据" description="查看或轮转管理端与 MCP 调用端的独立凭据。" />
        <div className="credential-grid">
          {data.credentials.map((credential) => {
            const revealed = data.revealedCredentials.has(credential.kind);
            const label = credential.kind === "admin" ? "管理员令牌" : "MCP API Key";
            return (
              <article className="credential" key={credential.kind}>
                <div>
                  <h3>{label}</h3>
                  <p>{credential.kind === "admin" ? "用于登录控制台和管理 API" : "用于 Agent 连接 /mcp"}</p>
                </div>
                <div className="credential-value"><code>{revealed ? credential.token : `••••••••••••${credential.token.slice(-6)}`}</code></div>
                <p className="credential-time">最近轮转：{new Date(credential.updatedAt).toLocaleString()}</p>
                <div className="credential-actions">
                  <button className="secondary" onClick={() => data.toggleCredentialReveal(credential.kind)}>{revealed ? "隐藏" : "显示"}</button>
                  <button className="secondary" onClick={() => void data.copyCredential(credential)}>复制</button>
                  <button className="rotate" onClick={() => void data.rotateCredential(credential.kind)}>轮转</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {data.runtimeSettings && (
        <RuntimeSettingsPanel
          settings={data.runtimeSettings}
          api={data.api}
          onSaved={(next) => {
            data.setRuntimeSettings(next);
            data.setMessage("运行设置已保存，新请求将使用最新配置");
          }}
        />
      )}
    </>
  );
}
