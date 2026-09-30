import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Capability = {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  version: number;
};

type Endpoint = { id: string; name: string; baseUrl: string; enabled: boolean };
type Deployment = {
  id: string;
  endpointId: string;
  modelName: string;
  supportsVision: boolean;
  timeoutMs: number;
  enabled: boolean;
};
type Route = {
  id: string;
  capabilityId: string;
  deploymentId: string;
  priority: number;
  promptTemplate: string;
  enabled: boolean;
};
type Credential = { kind: "admin" | "mcp"; token: string; updatedAt: string };
type RuntimeSettings = { maxImageBytes: number; maxConcurrentRequests: number; updatedAt: string };
type EndpointTestResult = { ok: true; models: string[] };
type EndpointTestState = { kind: "testing" | "success" | "error"; text: string };
type DiscoveredModel = { endpointId: string; endpointName: string; modelName: string };
type ResourceName = "capabilities" | "endpoints" | "deployments" | "routes";
type EditorState = { resource: ResourceName; id?: string } | null;

const defaultPrompt = "请准确描述图片内容，并回答调用者关于图片的问题。";

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("adminToken") ?? "");
  const [draftToken, setDraftToken] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [endpointTests, setEndpointTests] = useState<Record<string, EndpointTestState>>({});
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[] | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [revealedCredentials, setRevealedCredentials] = useState<Set<Credential["kind"]>>(() => new Set());
  const [editor, setEditor] = useState<EditorState>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api/v1/${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init?.headers
      }
    });
    if (response.status === 401) {
      sessionStorage.removeItem("adminToken");
      setToken("");
      throw new Error("访问令牌无效");
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? "请求失败");
    }
    return (response.status === 204 ? undefined : response.json()) as Promise<T>;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextCapabilities, nextEndpoints, nextDeployments, nextRoutes, nextCredentials, nextRuntimeSettings] = await Promise.all([
        api<Capability[]>("capabilities"),
        api<Endpoint[]>("endpoints"),
        api<Deployment[]>("deployments"),
        api<Route[]>("routes"),
        api<Credential[]>("security"),
        api<RuntimeSettings>("settings")
      ]);
      setCapabilities(nextCapabilities);
      setEndpoints(nextEndpoints);
      setDeployments(nextDeployments);
      setRoutes(nextRoutes);
      setCredentials(nextCredentials);
      setRuntimeSettings(nextRuntimeSettings);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [api, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const endpointMap = useMemo(() => new Map(endpoints.map((item) => [item.id, item])), [endpoints]);
  const deploymentMap = useMemo(() => new Map(deployments.map((item) => [item.id, item])), [deployments]);
  const capabilityMap = useMemo(() => new Map(capabilities.map((item) => [item.id, item])), [capabilities]);
  const activeRouteCount = routes.filter((route) => route.enabled).length;

  async function remove(resource: ResourceName, id: string): Promise<void> {
    if (!window.confirm("确定删除这条配置？被其他配置引用时不会删除。")) return;
    try {
      await api(`${resource}/${id}`, { method: "DELETE" });
      setMessage("已删除");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function rotateCredential(kind: Credential["kind"]): Promise<void> {
    const label = kind === "admin" ? "管理员令牌" : "MCP API Key";
    if (!window.confirm(`轮转后，旧的${label}会立即失效。确定继续？`)) return;
    try {
      const next = await api<Credential>(`security/${kind}/rotate`, { method: "POST", body: "{}" });
      setCredentials((current) => current.map((item) => item.kind === kind ? next : item));
      setRevealedCredentials((current) => new Set(current).add(kind));
      if (kind === "admin") {
        // 管理员令牌轮转后立即更新当前会话，避免下一次请求被退出。
        sessionStorage.setItem("adminToken", next.token);
        setToken(next.token);
      }
      setMessage(`${label}已轮转，请更新使用方配置`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "轮转失败");
    }
  }

  async function copyCredential(credential: Credential): Promise<void> {
    try {
      await navigator.clipboard.writeText(credential.token);
      setMessage(credential.kind === "admin" ? "管理员令牌已复制" : "MCP API Key 已复制");
    } catch {
      setMessage("浏览器未允许复制，请显示后手动复制");
    }
  }

  async function testEndpoint(endpoint: Endpoint): Promise<void> {
    setEndpointTests((current) => ({ ...current, [endpoint.id]: { kind: "testing", text: "测试中…" } }));
    try {
      const result = await api<EndpointTestResult>("endpoints/test", {
        method: "POST",
        body: JSON.stringify({ baseUrl: endpoint.baseUrl })
      });
      setEndpointTests((current) => ({
        ...current,
        [endpoint.id]: { kind: "success", text: `连接正常，发现 ${result.models.length} 个模型` }
      }));
    } catch (error) {
      setEndpointTests((current) => ({
        ...current,
        [endpoint.id]: { kind: "error", text: error instanceof Error ? error.message : "连接失败" }
      }));
    }
  }

  async function refreshModelList(): Promise<void> {
    const activeEndpoints = endpoints.filter((endpoint) => endpoint.enabled);
    if (activeEndpoints.length === 0) {
      setMessage("请先添加并启用一个 Ollama 端点");
      return;
    }
    setRefreshingModels(true);
    try {
      const results = await Promise.allSettled(activeEndpoints.map(async (endpoint) => ({
        endpoint,
        result: await api<EndpointTestResult>("endpoints/test", {
          method: "POST",
          body: JSON.stringify({ baseUrl: endpoint.baseUrl })
        })
      })));
      const nextModels = results.flatMap((result) => result.status === "fulfilled"
        ? result.value.result.models.map((modelName) => ({ endpointId: result.value.endpoint.id, endpointName: result.value.endpoint.name, modelName }))
        : []);
      setDiscoveredModels(nextModels);
      const failedCount = results.filter((result) => result.status === "rejected").length;
      setMessage(failedCount > 0
        ? `已刷新 ${activeEndpoints.length - failedCount} 个端点，${failedCount} 个端点连接失败`
        : `模型列表已刷新，共发现 ${nextModels.length} 个模型`);
    } finally {
      setRefreshingModels(false);
    }
  }

  async function addDiscoveredModel(model: DiscoveredModel): Promise<void> {
    try {
      await api<Deployment>("deployments", {
        method: "POST",
        body: JSON.stringify({
          endpointId: model.endpointId,
          modelName: model.modelName,
          supportsVision: true,
          timeoutMs: 60_000,
          enabled: true
        })
      });
      setMessage(`${model.modelName} 已添加为视觉模型`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加模型失败");
    }
  }

  function signIn(event: FormEvent): void {
    event.preventDefault();
    const next = draftToken.trim();
    if (!next) return;
    sessionStorage.setItem("adminToken", next);
    setToken(next);
  }

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="signal-mark" aria-hidden="true"><span /><span /><span /></div>
          <p className="product-name">Model Relay</p>
          <h1>连接看不见图片的 Agent</h1>
          <p className="lede">配置 Ollama 视觉模型，并把图像理解能力通过 MCP 安全地提供给 Agent。当前令牌可在容器启动日志中找到。</p>
          <form onSubmit={signIn}>
            <label htmlFor="token">管理员令牌</label>
            <div className="login-row">
              <input id="token" type="password" value={draftToken} onChange={(event) => setDraftToken(event.target.value)} autoFocus />
              <button type="submit">进入控制台</button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="signal-mark small"><span /><span /><span /></div><strong>Model Relay</strong></div>
        <div className="top-actions">
          <span className={activeRouteCount > 0 ? "health ready" : "health"}>{activeRouteCount > 0 ? `${activeRouteCount} 条路由可用` : "等待配置路由"}</span>
          <button className="text-button" onClick={() => { sessionStorage.removeItem("adminToken"); setToken(""); }}>退出</button>
        </div>
      </header>

      <main className="workspace">
        <section className="intro">
          <div>
            <p className="kicker">视觉能力路由</p>
            <h1>让 Agent 借用正确的眼睛</h1>
            <p>请求从能力出发，沿路由进入指定的 Ollama 模型。优先级越小，越先尝试。</p>
          </div>
          <button className="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "刷新中…" : "刷新状态"}</button>
        </section>

        <section className="route-rail" aria-label="路由链路">
          <RailStep label="能力" value={`${capabilities.filter((item) => item.enabled).length} 项启用`} />
          <i aria-hidden="true" />
          <RailStep label="路由" value={`${activeRouteCount} 条生效`} />
          <i aria-hidden="true" />
          <RailStep label="模型部署" value={`${deployments.filter((item) => item.enabled).length} 个在线配置`} />
          <i aria-hidden="true" />
          <RailStep label="Ollama" value={`${endpoints.filter((item) => item.enabled).length} 个端点`} />
        </section>

        {message && <div className="notice" role="status">{message}<button onClick={() => setMessage(null)} aria-label="关闭">×</button></div>}

        <section className="config-section security-section">
          <SectionHeader title="访问凭据" description="查看或轮转管理端与 MCP 调用端的独立凭据。" />
          <div className="credential-grid">
            {credentials.map((credential) => {
              const revealed = revealedCredentials.has(credential.kind);
              const label = credential.kind === "admin" ? "管理员令牌" : "MCP API Key";
              return <article className="credential" key={credential.kind}>
                <div><h3>{label}</h3><p>{credential.kind === "admin" ? "用于登录控制台和管理 API" : "用于 Agent 连接 /mcp"}</p></div>
                <div className="credential-value"><code>{revealed ? credential.token : `••••••••••••${credential.token.slice(-6)}`}</code></div>
                <p className="credential-time">最近轮转：{new Date(credential.updatedAt).toLocaleString()}</p>
                <div className="credential-actions">
                  <button className="secondary" onClick={() => setRevealedCredentials((current) => { const next = new Set(current); revealed ? next.delete(credential.kind) : next.add(credential.kind); return next; })}>{revealed ? "隐藏" : "显示"}</button>
                  <button className="secondary" onClick={() => void copyCredential(credential)}>复制</button>
                  <button className="rotate" onClick={() => void rotateCredential(credential.kind)}>轮转</button>
                </div>
              </article>;
            })}
          </div>
        </section>

        {runtimeSettings && <RuntimeSettingsPanel settings={runtimeSettings} api={api} onSaved={(next) => { setRuntimeSettings(next); setMessage("运行限制已保存，新请求将使用最新配置"); }} />}

        <section className="config-section">
          <SectionHeader title="能力" description="Agent 能理解和调用的业务能力。" action="新增能力" onAdd={() => setEditor({ resource: "capabilities" })} />
          <div className="table-wrap"><table><thead><tr><th>名称</th><th>标识</th><th>说明</th><th>状态</th><th /></tr></thead><tbody>
            {capabilities.map((item) => <tr key={item.id}><td className="strong">{item.name}</td><td><code>{item.key}</code></td><td>{item.description}</td><td><Status enabled={item.enabled} /></td><td><RowActions onEdit={() => setEditor({ resource: "capabilities", id: item.id })} onDelete={() => void remove("capabilities", item.id)} /></td></tr>)}
          </tbody></table></div>
        </section>

        <section className="config-section">
          <SectionHeader title="Ollama 端点" description="可访问的 Ollama 服务根地址。" action="新增端点" onAdd={() => setEditor({ resource: "endpoints" })} />
          <div className="table-wrap"><table><thead><tr><th>名称</th><th>地址</th><th>状态</th><th>连接</th><th /></tr></thead><tbody>
            {endpoints.length === 0 && <EmptyRow columns={5} text="先添加一个 Ollama 端点" />}
            {endpoints.map((item) => { const test = endpointTests[item.id]; return <tr key={item.id}><td className="strong">{item.name}</td><td><code>{item.baseUrl}</code></td><td><Status enabled={item.enabled} /></td><td><span className={`connection ${test?.kind ?? "idle"}`}>{test?.text ?? "尚未测试"}</span></td><td><div className="row-actions"><button onClick={() => void testEndpoint(item)} disabled={test?.kind === "testing"}>测试连接</button><button onClick={() => setEditor({ resource: "endpoints", id: item.id })}>编辑</button><button className="danger" onClick={() => void remove("endpoints", item.id)}>删除</button></div></td></tr>; })}
          </tbody></table></div>
        </section>

        <section className="config-section">
          <SectionHeader title="模型部署" description="端点上的具体视觉模型及超时设置。" action="新增模型" onAdd={() => setEditor({ resource: "deployments" })} secondaryAction={refreshingModels ? "刷新中…" : "刷新模型列表"} onSecondary={() => void refreshModelList()} secondaryDisabled={refreshingModels} />
          <div className="table-wrap"><table><thead><tr><th>模型</th><th>端点</th><th>超时</th><th>视觉</th><th>状态</th><th /></tr></thead><tbody>
            {deployments.length === 0 && <EmptyRow columns={6} text="添加端点后，再登记视觉模型" />}
            {deployments.map((item) => <tr key={item.id}><td className="strong">{item.modelName}</td><td>{endpointMap.get(item.endpointId)?.name ?? "未知端点"}</td><td>{Math.round(item.timeoutMs / 1000)} 秒</td><td>{item.supportsVision ? "支持" : "未验证"}</td><td><Status enabled={item.enabled} /></td><td><RowActions onEdit={() => setEditor({ resource: "deployments", id: item.id })} onDelete={() => void remove("deployments", item.id)} /></td></tr>)}
          </tbody></table></div>
          {discoveredModels && <DiscoveredModels models={discoveredModels} deployments={deployments} onAdd={addDiscoveredModel} onDelete={(deploymentId) => remove("deployments", deploymentId)} />}
        </section>

        <section className="config-section">
          <SectionHeader title="能力路由" description="把能力绑定到模型；同一能力可配置多条回退路由。" action="新增路由" onAdd={() => setEditor({ resource: "routes" })} />
          <div className="table-wrap"><table><thead><tr><th>能力</th><th>模型</th><th>端点</th><th>优先级</th><th>状态</th><th /></tr></thead><tbody>
            {routes.length === 0 && <EmptyRow columns={6} text="绑定能力与模型后，MCP 才能处理图片" />}
            {routes.map((item) => { const deployment = deploymentMap.get(item.deploymentId); return <tr key={item.id}><td className="strong">{capabilityMap.get(item.capabilityId)?.name ?? "未知能力"}</td><td>{deployment?.modelName ?? "未知模型"}</td><td>{deployment ? endpointMap.get(deployment.endpointId)?.name : "—"}</td><td>{item.priority}</td><td><Status enabled={item.enabled} /></td><td><RowActions onEdit={() => setEditor({ resource: "routes", id: item.id })} onDelete={() => void remove("routes", item.id)} /></td></tr>; })}
          </tbody></table></div>
        </section>
      </main>

      {editor && <Editor editor={editor} capabilities={capabilities} endpoints={endpoints} deployments={deployments} routes={routes} api={api} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); setMessage("配置已保存"); await refresh(); }} />}
    </div>
  );
}

function RailStep({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function Status({ enabled }: { enabled: boolean }) {
  return <span className={enabled ? "status on" : "status"}><b />{enabled ? "启用" : "停用"}</span>;
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return <div className="row-actions"><button onClick={onEdit}>编辑</button><button className="danger" onClick={onDelete}>删除</button></div>;
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <tr><td colSpan={columns} className="empty">{text}</td></tr>;
}

function SectionHeader({ title, description, action, onAdd, secondaryAction, onSecondary, secondaryDisabled }: { title: string; description: string; action?: string; onAdd?: () => void; secondaryAction?: string; onSecondary?: () => void; secondaryDisabled?: boolean }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div><div className="section-actions">{secondaryAction && onSecondary && <button className="secondary" onClick={onSecondary} disabled={secondaryDisabled}>{secondaryAction}</button>}{action && onAdd && <button className="secondary" onClick={onAdd}>＋ {action}</button>}</div></div>;
}

function DiscoveredModels({ models, deployments, onAdd, onDelete }: { models: DiscoveredModel[]; deployments: Deployment[]; onAdd: (model: DiscoveredModel) => Promise<void>; onDelete: (deploymentId: string) => Promise<void> }) {
  const deploymentMap = new Map(deployments.map((deployment) => [`${deployment.endpointId}:${deployment.modelName}`, deployment]));
  return <div className="discovered-models">
    <div className="discovered-heading"><h3>Ollama 模型列表</h3><span>{models.length} 个</span></div>
    {models.length === 0 ? <p className="discovered-empty">启用的端点未返回任何模型。</p> : <div className="model-chips">{models.map((model) => {
      const deployment = deploymentMap.get(`${model.endpointId}:${model.modelName}`);
      return <div className="model-chip" key={`${model.endpointId}:${model.modelName}`}><div><strong>{model.modelName}</strong><span>{model.endpointName}</span></div>{deployment ? <button className="danger-text" onClick={() => void onDelete(deployment.id)}>删除配置</button> : <button onClick={() => void onAdd(model)}>添加为视觉模型</button>}</div>;
    })}</div>}
  </div>;
}

function RuntimeSettingsPanel({ settings, api, onSaved }: { settings: RuntimeSettings; api: <T>(path: string, init?: RequestInit) => Promise<T>; onSaved: (settings: RuntimeSettings) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const maxImageMb = Number(data.get("maxImageMb"));
    const maxConcurrentRequests = Number(data.get("maxConcurrentRequests"));
    setSaving(true);
    setError(null);
    try {
      const next = await api<RuntimeSettings>("settings", {
        method: "PUT",
        body: JSON.stringify({
          maxImageBytes: Math.round(maxImageMb * 1_024 * 1_024),
          maxConcurrentRequests
        })
      });
      onSaved(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return <section className="config-section runtime-section">
    <SectionHeader title="运行限制" description="限制单次图片大小和同时处理的模型请求数。" />
    <form className="runtime-form" onSubmit={(event) => void submit(event)} key={settings.updatedAt}>
      <label className="field"><span>单张图片上限（MB）</span><input name="maxImageMb" type="number" min="0.01" max="50" step="0.01" defaultValue={(settings.maxImageBytes / 1_024 / 1_024).toFixed(2)} required /><small>范围 0.01–50 MB，超过限制的请求会在转发前拒绝。</small></label>
      <label className="field"><span>最大并发请求数</span><input name="maxConcurrentRequests" type="number" min="1" max="32" step="1" defaultValue={settings.maxConcurrentRequests} required /><small>范围 1–32，超出的请求会等待已有任务完成。</small></label>
      <div className="runtime-save">{error && <p className="form-error">{error}</p>}<button type="submit" disabled={saving}>{saving ? "保存中…" : "保存运行限制"}</button></div>
    </form>
  </section>;
}

type EditorProps = {
  editor: Exclude<EditorState, null>;
  capabilities: Capability[];
  endpoints: Endpoint[];
  deployments: Deployment[];
  routes: Route[];
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

function Editor({ editor, capabilities, endpoints, deployments, routes, api, onClose, onSaved }: EditorProps) {
  const existing = [...capabilities, ...endpoints, ...deployments, ...routes].find((item) => item.id === editor.id) as Record<string, unknown> | undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titles: Record<ResourceName, string> = { capabilities: "能力", endpoints: "Ollama 端点", deployments: "模型部署", routes: "能力路由" };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    let body: Record<string, unknown>;
    if (editor.resource === "capabilities") body = { key: data.get("key"), name: data.get("name"), description: data.get("description"), enabled: data.get("enabled") === "on", ...(existing?.version ? { version: existing.version } : {}) };
    else if (editor.resource === "endpoints") body = { name: data.get("name"), baseUrl: data.get("baseUrl"), enabled: data.get("enabled") === "on" };
    else if (editor.resource === "deployments") body = { endpointId: data.get("endpointId"), modelName: data.get("modelName"), supportsVision: data.get("supportsVision") === "on", timeoutMs: Number(data.get("timeoutMs")) * 1000, enabled: data.get("enabled") === "on" };
    else body = { capabilityId: data.get("capabilityId"), deploymentId: data.get("deploymentId"), priority: Number(data.get("priority")), promptTemplate: data.get("promptTemplate"), enabled: data.get("enabled") === "on" };
    setSaving(true);
    setError(null);
    try {
      await api(`${editor.resource}${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PUT" : "POST", body: JSON.stringify(body) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modal-heading"><div><p>{editor.id ? "编辑配置" : "新增配置"}</p><h2 id="editor-title">{titles[editor.resource]}</h2></div><button onClick={onClose} aria-label="关闭">×</button></div>
        <form onSubmit={(event) => void submit(event)}>
          {editor.resource === "capabilities" && <>
            <Field name="name" label="名称" defaultValue={String(existing?.name ?? "")} required />
            <Field name="key" label="能力标识" defaultValue={String(existing?.key ?? "")} placeholder="image.describe" required />
            <Field name="description" label="Agent 可见说明" defaultValue={String(existing?.description ?? "")} multiline required />
          </>}
          {editor.resource === "endpoints" && <>
            <Field name="name" label="端点名称" defaultValue={String(existing?.name ?? "")} placeholder="本机 Ollama" required />
            <Field name="baseUrl" label="服务根地址" defaultValue={String(existing?.baseUrl ?? "")} placeholder="http://host.docker.internal:11434" required />
          </>}
          {editor.resource === "deployments" && <>
            <SelectField name="endpointId" label="Ollama 端点" defaultValue={String(existing?.endpointId ?? "")} options={endpoints.map((item) => ({ value: item.id, label: item.name }))} />
            <Field name="modelName" label="模型名称" defaultValue={String(existing?.modelName ?? "")} placeholder="qwen2.5vl:7b" required />
            <Field name="timeoutMs" label="超时（秒）" type="number" defaultValue={String(Number(existing?.timeoutMs ?? 60_000) / 1000)} required />
            <Check name="supportsVision" label="已确认支持图片" defaultChecked={existing ? Boolean(existing.supportsVision) : true} />
          </>}
          {editor.resource === "routes" && <>
            <SelectField name="capabilityId" label="能力" defaultValue={String(existing?.capabilityId ?? "")} options={capabilities.map((item) => ({ value: item.id, label: item.name }))} />
            <SelectField name="deploymentId" label="模型部署" defaultValue={String(existing?.deploymentId ?? "")} options={deployments.map((item) => ({ value: item.id, label: item.modelName }))} />
            <Field name="priority" label="优先级" type="number" defaultValue={String(existing?.priority ?? 100)} required />
            <Field name="promptTemplate" label="默认提示词" defaultValue={String(existing?.promptTemplate ?? defaultPrompt)} multiline required />
          </>}
          <Check name="enabled" label="立即启用" defaultChecked={existing ? Boolean(existing.enabled) : true} />
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存配置"}</button></div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, multiline, ...props }: { label: string; multiline?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="field"><span>{label}</span>{multiline ? <textarea name={props.name} defaultValue={String(props.defaultValue ?? "")} required={props.required} /> : <input {...props} />}</label>;
}

function SelectField({ label, options, ...props }: { label: string; options: Array<{ value: string; label: string }> } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <label className="field"><span>{label}</span><select {...props} required><option value="">请选择</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Check({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="check"><input {...props} type="checkbox" /><span>{label}</span></label>;
}
