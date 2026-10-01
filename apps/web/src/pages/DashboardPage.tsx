import { McpConfigCard } from "../components/McpConfigCard";
import { PageHeader } from "../components/ui";
import type { AdminData } from "../hooks/useAdminData";
import type { PageKey } from "../navigation";

export type DashboardPageProps = {
  data: AdminData;
  onNavigate: (page: PageKey) => void;
};

/** 控制台：只做状态总览与接入，具体配置都在各自页面完成。 */
export function DashboardPage({ data, onNavigate }: DashboardPageProps) {
  // 旧部署可继续保留；总览只统计路由实际选择的模型，避免把未使用配置算作已选。
  const selectedModelCount = new Set(data.routes.map((route) => route.deploymentId)).size;
  return (
    <>
      <PageHeader
        title="控制台"
        description="请求从能力出发，沿路由进入指定的 Ollama 模型；优先级越小越先尝试。"
        actions={<button className="secondary" onClick={() => void data.refresh(true)} disabled={data.loading}>{data.loading ? "刷新中…" : "刷新状态"}</button>}
      />

      <div className="stat-grid">
        <StatCard label="启用能力" value={`${data.enabledCapabilityCount} / ${data.capabilities.length}`} hint="Agent 可调用的业务能力" />
        <StatCard label="生效路由" value={`${data.activeRouteCount} 条`} hint="已绑定能力与模型的路径" tone={data.activeRouteCount > 0 ? "on" : "off"} />
        <StatCard label="已选模型" value={`${selectedModelCount} 个`} hint="能力路由使用的模型配置" />
        <StatCard label="Ollama 端点" value={`${data.enabledEndpointCount} / ${data.endpoints.length}`} hint="可访问的 Ollama 服务" />
      </div>

      <section className="route-rail" aria-label="路由链路">
        <RailStep label="能力" value={`${data.enabledCapabilityCount} 项启用`} />
        <i aria-hidden="true" />
        <RailStep label="路由" value={`${data.activeRouteCount} 条生效`} />
        <i aria-hidden="true" />
        <RailStep label="模型" value={`${selectedModelCount} 个已选模型`} />
        <i aria-hidden="true" />
        <RailStep label="Ollama" value={`${data.enabledEndpointCount} 个端点`} />
      </section>

      {data.activeRouteCount === 0 && <NextStepGuide
        hasEndpoint={data.endpoints.length > 0}
        onNavigate={onNavigate}
      />}

      <McpConfigCard
        credential={data.mcpCredential}
        onCopied={data.setMessage}
        onGoToSettings={() => onNavigate("settings")}
      />
    </>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "on" | "off" }) {
  return (
    <article className={tone ? `stat-card ${tone}` : "stat-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}

function RailStep({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

/** 链路未就绪时给出下一步该去哪一页，避免新用户面对空表格。 */
function NextStepGuide({ hasEndpoint, onNavigate }: { hasEndpoint: boolean; onNavigate: (page: PageKey) => void }) {
  // 模型在能力编辑中直接选择，首次接入无需另走一遍模型部署页面。
  const step = !hasEndpoint
    ? { text: "还没有可用的 Ollama 端点，先登记服务地址。", page: "ollama" as const, action: "去配置外部能力" }
    : { text: "在能力编辑的外部能力路由中选择 Ollama 端点与模型，完成接入。", page: "capabilities" as const, action: "去编辑能力" };

  return (
    <section className="next-step">
      <div><h2>还差一步</h2><p>{step.text}</p></div>
      <button onClick={() => onNavigate(step.page)}>{step.action}</button>
    </section>
  );
}
