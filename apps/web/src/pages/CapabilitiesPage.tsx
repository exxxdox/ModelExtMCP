import { useState } from "react";
import { CapabilityTestDialog } from "../components/CapabilityTestDialog";
import { EmptyRow, PageHeader, SectionHeader } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";
import type { Capability, ResourceName } from "../types";

export type CapabilitiesPageProps = {
  data: AdminData;
  onOpenEditor: (resource: ResourceName, id?: string) => void;
};

/** 能力设置：先定义 Agent 能调用的能力，再把能力绑到具体模型。 */
export function CapabilitiesPage({ data, onOpenEditor }: CapabilitiesPageProps) {
  // 测试弹窗自己持有目标能力：测试是「看一眼」的操作，不该进编辑器那套共享状态。
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  const [testing, setTesting] = useState<Capability | null>(null);

  return (
    <>
      <PageHeader title="能力设置" description="定义 Agent 可调用的能力标识，并决定每个能力最终由哪些模型提供。" />

      <section className="config-section">
        <SectionHeader title="能力" description="能力由服务端代码提供，数量固定；这里可以调整 Agent 看到的名称、标识与描述，并在编辑中配置外部能力路由。一个能力就是一个 MCP 工具：标识即工具名，描述即工具描述的全部内容。" />
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>工具名（能力标识）</th><th>描述</th><th>状态</th><th /></tr></thead>
            <tbody>
              {data.capabilities.length === 0 && <EmptyRow columns={5} text="服务端未注册可用的能力" />}
              {data.capabilities.map((item) => (
                <tr key={item.id}>
                  <td className="strong">{item.name}</td>
                  <td><code>{item.key}</code></td>
                  <td>{item.description}</td>
                  <td><button className="capability-switch" role="switch" aria-checked={item.enabled} aria-label={`启用${item.name}`} disabled={toggling.has(item.id)} aria-busy={toggling.has(item.id)} onClick={async () => {
                    setToggling((current) => new Set(current).add(item.id));
                    try { await data.setCapabilityEnabled(item); }
                    finally { setToggling((current) => { const next = new Set(current); next.delete(item.id); return next; }); }
                  }}><span aria-hidden="true" className="switch-track"><span /></span><span className="switch-label">{item.enabled ? "启用" : "停用"}</span></button></td>
                  <td><div className="row-actions"><button onClick={() => setTesting(item)}>测试</button><button onClick={() => onOpenEditor("capabilities", item.id)}>编辑</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 路由随所属能力编辑，避免在独立列表中重新选择能力。 */}

      {testing && <CapabilityTestDialog capability={testing} api={data.api} onClose={() => setTesting(null)} />}
    </>
  );
}
