import { EmptyRow, PageHeader, RowActions, SectionHeader, Status } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";
import type { ResourceName } from "../types";

export type CapabilitiesPageProps = {
  data: AdminData;
  onOpenEditor: (resource: ResourceName, id?: string) => void;
};

/** 能力设置：先定义 Agent 能调用的能力，再把能力绑到具体模型。 */
export function CapabilitiesPage({ data, onOpenEditor }: CapabilitiesPageProps) {
  return (
    <>
      <PageHeader title="能力设置" description="定义 Agent 可调用的能力标识，并决定每个能力最终由哪些模型提供。" />

      <section className="config-section">
        <SectionHeader title="能力" description="能力由服务端代码提供，数量固定；这里可以调整 Agent 看到的名称、标识与说明。" />
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>标识</th><th>说明</th><th>MCP 工具</th><th>状态</th><th /></tr></thead>
            <tbody>
              {data.capabilities.length === 0 && <EmptyRow columns={6} text="服务端未注册可用的能力" />}
              {data.capabilities.map((item) => (
                <tr key={item.id}>
                  <td className="strong">{item.name}</td>
                  <td><code>{item.key}</code></td>
                  <td>{item.description}</td>
                  <td>{item.definition ? <code>{item.definition.toolName}</code> : "—"}</td>
                  <td><Status enabled={item.enabled} /></td>
                  <td><div className="row-actions"><button onClick={() => onOpenEditor("capabilities", item.id)}>编辑</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="config-section">
        <SectionHeader title="能力路由" description="一个能力里只有“询问 Ollama 模型”这一步需要路由：这里决定这一步用哪个模型、超时多久、默认提示词是什么。图片格式与大小校验、参数解析等固定逻辑由服务端完成，不在此配置。同一能力可配置多条回退路由，按优先级依次尝试。" action="新增路由" onAdd={() => onOpenEditor("routes")} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>能力</th><th>模型</th><th>端点</th><th>优先级</th><th>状态</th><th /></tr></thead>
            <tbody>
              {data.routes.length === 0 && <EmptyRow columns={6} text="绑定能力与模型后，MCP 才能处理图片" />}
              {data.routes.map((item) => {
                const deployment = data.deploymentMap.get(item.deploymentId);
                return (
                  <tr key={item.id}>
                    <td className="strong">{data.capabilityMap.get(item.capabilityId)?.name ?? "未知能力"}</td>
                    <td>{deployment?.modelName ?? "未知模型"}</td>
                    <td>{deployment ? data.endpointMap.get(deployment.endpointId)?.name ?? "—" : "—"}</td>
                    <td>{item.priority}</td>
                    <td><Status enabled={item.enabled} /></td>
                    <td><RowActions onEdit={() => onOpenEditor("routes", item.id)} onDelete={() => void data.remove("routes", item.id)} /></td>
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
