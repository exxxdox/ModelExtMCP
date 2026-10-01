import { useCallback, useEffect, useMemo, useState } from "react";
import { createAdminApi } from "../api-client";
import { useNotify, type Notify } from "../components/Notifications";
import type {
  AdminApi,
  Capability,
  Credential,
  Deployment,
  DiscoveredModel,
  Endpoint,
  EndpointTestResult,
  EndpointTestState,
  ResourceName,
  Route,
  RuntimeSettings
} from "../types";

/**
 * 管理端的数据层。页面拆分后每个页面只需要读自己那部分数据，
 * 但刷新、鉴权失败、凭据轮转这些横切逻辑必须只有一份，
 * 否则各页面会各自维护令牌并产生不一致状态。
 */
export type AdminData = {
  capabilities: Capability[];
  endpoints: Endpoint[];
  deployments: Deployment[];
  routes: Route[];
  credentials: Credential[];
  runtimeSettings: RuntimeSettings | null;
  endpointTests: Record<string, EndpointTestState>;
  discoveredModels: DiscoveredModel[] | null;
  refreshingModels: boolean;
  revealedCredentials: Set<Credential["kind"]>;
  loading: boolean;
  endpointMap: Map<string, Endpoint>;
  deploymentMap: Map<string, Deployment>;
  capabilityMap: Map<string, Capability>;
  activeRouteCount: number;
  enabledCapabilityCount: number;
  enabledEndpointCount: number;
  enabledDeploymentCount: number;
  mcpCredential: Credential | undefined;
  api: AdminApi;
  refresh: (announce?: boolean) => Promise<void>;
  remove: (resource: ResourceName, id: string) => Promise<void>;
  rotateCredential: (kind: Credential["kind"]) => Promise<void>;
  copyCredential: (credential: Credential) => Promise<void>;
  toggleCredentialReveal: (kind: Credential["kind"]) => void;
  testEndpoint: (endpoint: Endpoint) => Promise<void>;
  refreshModelList: () => Promise<void>;
  setEndpointEnabled: (endpoint: Endpoint) => Promise<void>;
  setCapabilityEnabled: (capability: Capability) => Promise<void>;
  setRuntimeSettings: (settings: RuntimeSettings) => void;
  setMessage: Notify;
};

export function useAdminData(token: string, onUnauthorized: () => void, onAdminTokenRotated: (token: string) => void): AdminData {
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
  const [loading, setLoading] = useState(false);
  const setMessage = useNotify();

  const api = useMemo(() => createAdminApi({ token, onUnauthorized }), [token, onUnauthorized]);

  const refresh = useCallback(async (announce = false) => {
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
      // 刷新不清理独立反馈，避免保存和添加成功提示刚出现就消失。
      if (announce) setMessage("状态已刷新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [api, token, setMessage]);

  useEffect(() => { void refresh(); }, [refresh]);

  const endpointMap = useMemo(() => new Map(endpoints.map((item) => [item.id, item])), [endpoints]);
  const deploymentMap = useMemo(() => new Map(deployments.map((item) => [item.id, item])), [deployments]);
  const capabilityMap = useMemo(() => new Map(capabilities.map((item) => [item.id, item])), [capabilities]);

  const setCapabilityEnabled = useCallback(async (capability: Capability): Promise<void> => {
    try {
      // 独立开关只修改启用状态，避免将列表旧值覆盖进描述或路由。
      const next = await api<Capability>(`capabilities/${capability.id}/enabled`, {
        method: "PATCH", body: JSON.stringify({ enabled: !capability.enabled, version: capability.version })
      });
      setCapabilities((current) => current.map((item) => item.id === next.id ? next : item));
      setMessage(`${next.name}已${next.enabled ? "启用" : "停用"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "切换失败", "error");
    }
  }, [api, setMessage]);

  const setEndpointEnabled = useCallback(async (endpoint: Endpoint): Promise<void> => {
    try {
      // 状态单独保存，端点地址与名称不参与列表开关操作。
      const next = await api<Endpoint>(`endpoints/${endpoint.id}/enabled`, {
        method: "PATCH", body: JSON.stringify({ enabled: !endpoint.enabled })
      });
      setEndpoints((current) => current.map((item) => item.id === next.id ? next : item));
      // 启用端点的集合改变后，下一次能力编辑需要重新发现模型。
      setDiscoveredModels(null);
      setMessage(`${next.name}已${next.enabled ? "启用" : "停用"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "切换失败", "error");
    }
  }, [api, setMessage]);

  const remove = useCallback(async (resource: ResourceName, id: string): Promise<void> => {
    if (!window.confirm("确定删除这条配置？被其他配置引用时不会删除。")) return;
    try {
      await api(`${resource}/${id}`, { method: "DELETE" });
      setMessage("已删除");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败", "error");
    }
  }, [api, refresh, setMessage]);

  const rotateCredential = useCallback(async (kind: Credential["kind"]): Promise<void> => {
    const label = kind === "admin" ? "管理员令牌" : "MCP API Key";
    if (!window.confirm(`轮转后，旧的${label}会立即失效。确定继续？`)) return;
    try {
      const next = await api<Credential>(`security/${kind}/rotate`, { method: "POST", body: "{}" });
      setCredentials((current) => current.map((item) => item.kind === kind ? next : item));
      setRevealedCredentials((current) => new Set(current).add(kind));
      if (kind === "admin") {
        // 管理员令牌轮转后必须立即替换会话里的旧令牌，否则下一次请求会 401 退出登录。
        sessionStorage.setItem("adminToken", next.token);
        onAdminTokenRotated(next.token);
      }
      setMessage(`${label}已轮转，请更新使用方配置`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "轮转失败", "error");
    }
  }, [api, onAdminTokenRotated, setMessage]);

  const copyCredential = useCallback(async (credential: Credential): Promise<void> => {
    try {
      await navigator.clipboard.writeText(credential.token);
      setMessage(credential.kind === "admin" ? "管理员令牌已复制" : "MCP API Key 已复制");
    } catch {
      setMessage("浏览器未允许复制，请显示后手动复制", "error");
    }
  }, [setMessage]);

  const toggleCredentialReveal = useCallback((kind: Credential["kind"]): void => {
    setRevealedCredentials((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const testEndpoint = useCallback(async (endpoint: Endpoint): Promise<void> => {
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
      setMessage(`${endpoint.name} 连接正常，发现 ${result.models.length} 个模型`);
    } catch (error) {
      setMessage(`${endpoint.name}：${error instanceof Error ? error.message : "连接失败"}`, "error");
      setEndpointTests((current) => ({
        ...current,
        [endpoint.id]: { kind: "error", text: error instanceof Error ? error.message : "连接失败" }
      }));
    }
  }, [api, setMessage]);

  const refreshModelList = useCallback(async (): Promise<void> => {
    const activeEndpoints = endpoints.filter((endpoint) => endpoint.enabled);
    if (activeEndpoints.length === 0) {
      setMessage("请先添加并启用一个 Ollama 端点", "info");
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
        : `模型列表已刷新，共发现 ${nextModels.length} 个模型`, failedCount > 0 ? "error" : "success");
    } finally {
      setRefreshingModels(false);
    }
  }, [api, endpoints, setMessage]);

  return {
    capabilities,
    endpoints,
    deployments,
    routes,
    credentials,
    runtimeSettings,
    endpointTests,
    discoveredModels,
    refreshingModels,
    revealedCredentials,
    loading,
    endpointMap,
    deploymentMap,
    capabilityMap,
    // 能力停用后路由仍保留，但不再计入可用路径。
    activeRouteCount: routes.filter((route) => {
      const deployment = deploymentMap.get(route.deploymentId);
      return route.enabled && capabilityMap.get(route.capabilityId)?.enabled && deployment?.enabled
        && deployment.supportsVision && endpointMap.get(deployment.endpointId)?.enabled;
    }).length,
    enabledCapabilityCount: capabilities.filter((item) => item.enabled).length,
    enabledEndpointCount: endpoints.filter((item) => item.enabled).length,
    enabledDeploymentCount: deployments.filter((item) => item.enabled).length,
    mcpCredential: credentials.find((credential) => credential.kind === "mcp"),
    api,
    refresh,
    remove,
    rotateCredential,
    copyCredential,
    toggleCredentialReveal,
    testEndpoint,
    refreshModelList,
    setEndpointEnabled,
    setCapabilityEnabled,
    setRuntimeSettings,
    setMessage
  };
}
