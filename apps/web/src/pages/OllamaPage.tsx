import { useState } from "react";
import { EmptyRow, PageHeader, SectionHeader } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";
import type { ResourceName } from "../types";

export type OllamaPageProps = {
  data: AdminData;
  onOpenEditor: (resource: ResourceName, id?: string) => void;
};

/** 外部能力仅管理服务端点；模型选择随能力路由编辑，避免重复配置。 */
export function OllamaPage({ data, onOpenEditor }: OllamaPageProps) {
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  return (
    <>
      <PageHeader title="外部能力" description="目前支持 Ollama。登记服务地址后，在能力编辑中选择端点与模型。" />

      <section className="config-section">
        <SectionHeader title="Ollama" description="可访问的 Ollama 服务根地址。" action="新增端点" onAdd={() => onOpenEditor("endpoints")} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>地址</th><th>状态</th><th>连接</th><th /></tr></thead>
            <tbody>
              {data.endpoints.length === 0 && <EmptyRow columns={5} text="先添加一个 Ollama 端点" />}
              {data.endpoints.map((item) => {
                const test = data.endpointTests[item.id];
                return (
                  <tr key={item.id}>
                    <td className="strong">{item.name}</td>
                    <td><code>{item.baseUrl}</code></td>
                    <td><button className="capability-switch" role="switch" aria-checked={item.enabled} aria-label={`启用${item.name}`} disabled={toggling.has(item.id)} aria-busy={toggling.has(item.id)} onClick={async () => {
                      setToggling((current) => new Set(current).add(item.id));
                      try { await data.setEndpointEnabled(item); }
                      finally { setToggling((current) => { const next = new Set(current); next.delete(item.id); return next; }); }
                    }}><span aria-hidden="true" className="switch-track"><span /></span><span className="switch-label">{item.enabled ? "启用" : "停用"}</span></button></td>
                    <td><span className={`connection ${test?.kind ?? "idle"}`}>{test?.text ?? "尚未测试"}</span></td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => void data.testEndpoint(item)} disabled={test?.kind === "testing"}>测试连接</button>
                        <button onClick={() => onOpenEditor("endpoints", item.id)}>编辑</button>
                        <button className="danger" onClick={() => void data.remove("endpoints", item.id)}>删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </>
  );
}
