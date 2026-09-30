import { EmptyRow, PageHeader, RowActions, SectionHeader, Status } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";
import type { Deployment, DiscoveredModel, ResourceName } from "../types";

export type OllamaPageProps = {
  data: AdminData;
  onOpenEditor: (resource: ResourceName, id?: string) => void;
};

/** Ollama 配置：端点与端点上的视觉模型，两件事放在一页便于对照测试结果。 */
export function OllamaPage({ data, onOpenEditor }: OllamaPageProps) {
  return (
    <>
      <PageHeader title="Ollama 配置" description="登记可访问的 Ollama 服务，并把这些服务上真正支持图片的模型加进来。" />

      <section className="config-section">
        <SectionHeader title="Ollama 端点" description="可访问的 Ollama 服务根地址。" action="新增端点" onAdd={() => onOpenEditor("endpoints")} />
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
                    <td><Status enabled={item.enabled} /></td>
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

      <section className="config-section">
        <SectionHeader
          title="模型部署"
          description="端点上的具体视觉模型及超时设置。"
          action="新增模型"
          onAdd={() => onOpenEditor("deployments")}
          secondaryAction={data.refreshingModels ? "刷新中…" : "刷新模型列表"}
          onSecondary={() => void data.refreshModelList()}
          secondaryDisabled={data.refreshingModels}
        />
        <div className="table-wrap">
          <table>
            <thead><tr><th>模型</th><th>端点</th><th>超时</th><th>视觉</th><th>状态</th><th /></tr></thead>
            <tbody>
              {data.deployments.length === 0 && <EmptyRow columns={6} text="添加端点后，再登记视觉模型" />}
              {data.deployments.map((item) => (
                <tr key={item.id}>
                  <td className="strong">{item.modelName}</td>
                  <td>{data.endpointMap.get(item.endpointId)?.name ?? "未知端点"}</td>
                  <td>{Math.round(item.timeoutMs / 1000)} 秒</td>
                  <td>{item.supportsVision ? "支持" : "未验证"}</td>
                  <td><Status enabled={item.enabled} /></td>
                  <td><RowActions onEdit={() => onOpenEditor("deployments", item.id)} onDelete={() => void data.remove("deployments", item.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.discoveredModels && (
          <DiscoveredModels
            models={data.discoveredModels}
            deployments={data.deployments}
            onAdd={data.addDiscoveredModel}
            onDelete={(deploymentId) => data.remove("deployments", deploymentId)}
          />
        )}
      </section>
    </>
  );
}

type DiscoveredModelsProps = {
  models: DiscoveredModel[];
  deployments: Deployment[];
  onAdd: (model: DiscoveredModel) => Promise<void>;
  onDelete: (deploymentId: string) => Promise<void>;
};

function DiscoveredModels({ models, deployments, onAdd, onDelete }: DiscoveredModelsProps) {
  const deploymentMap = new Map(deployments.map((deployment) => [`${deployment.endpointId}:${deployment.modelName}`, deployment]));

  return (
    <div className="discovered-models">
      <div className="discovered-heading"><h3>Ollama 模型列表</h3><span>{models.length} 个</span></div>
      {models.length === 0
        ? <p className="discovered-empty">启用的端点未返回任何模型。</p>
        : (
          <div className="model-chips">
            {models.map((model) => {
              const deployment = deploymentMap.get(`${model.endpointId}:${model.modelName}`);
              return (
                <div className="model-chip" key={`${model.endpointId}:${model.modelName}`}>
                  <div><strong>{model.modelName}</strong><span>{model.endpointName}</span></div>
                  {deployment
                    ? <button className="danger-text" onClick={() => void onDelete(deployment.id)}>删除配置</button>
                    : <button onClick={() => void onAdd(model)}>添加为视觉模型</button>}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
