/** 与服务端管理 API 一一对应的数据形状，以及跨页面复用的交互状态类型。 */
export type CapabilityParameter = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

/** 能力由服务端代码提供，这份定义只读：参数与执行逻辑不可在管理端修改。 */
export type CapabilityDefinition = {
  definitionKey: string;
  executorType: "ollama_vision";
  /** 代码基线，用来展示默认值并支持一键恢复。 */
  defaultKey: string;
  defaultName: string;
  defaultDescription: string;
  parameters: CapabilityParameter[];
};

export type Capability = {
  id: string;
  definitionKey: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  version: number;
  /** 与代码注册表对不上时为 null，此时不展示只读说明。 */
  definition: CapabilityDefinition | null;
};

/** 发给 Ollama 的 chat 请求体，与服务端 buildOllamaRequest 的形状一致。 */
export type ChatRequestPreview = {
  model: string;
  stream: boolean;
  messages: Array<{ role: string; content: string; images?: string[] }>;
};

/** 一次能力测试里对某条路由的尝试记录：这些字段就是「实际参数」。 */
export type CapabilityTestAttempt = {
  priority: number;
  endpointName: string;
  baseUrl: string;
  modelName: string;
  timeoutMs: number;
  requestUrl: string;
  requestBody: ChatRequestPreview;
  status: "ok" | "error";
  errorCode?: string;
  durationMs: number;
  responseText?: string;
};

export type CapabilityTestOutcome = {
  ok: boolean;
  capabilityKey: string;
  requestId: string;
  input: { mimeType: string; prompt: string; imageBytes: number };
  attempts: CapabilityTestAttempt[];
  text?: string;
  errorCode?: string;
  totalMs: number;
};

export type Endpoint = { id: string; name: string; baseUrl: string; enabled: boolean };

export type Deployment = {
  id: string;
  endpointId: string;
  modelName: string;
  supportsVision: boolean;
  timeoutMs: number;
  enabled: boolean;
};

export type Route = {
  id: string;
  capabilityId: string;
  deploymentId: string;
  priority: number;
  promptTemplate: string;
  enabled: boolean;
};

export type Credential = { kind: "admin" | "mcp"; token: string; updatedAt: string };

export type RuntimeSettings = {
  maxImageBytes: number;
  maxConcurrentRequests: number;
  allowNetworkAccess: boolean;
  updatedAt: string;
};

export type EndpointTestResult = { ok: true; models: string[] };

export type EndpointTestState = { kind: "testing" | "success" | "error"; text: string };

export type DiscoveredModel = { endpointId: string; endpointName: string; modelName: string };

export type ResourceName = "capabilities" | "endpoints" | "deployments" | "routes";

export type EditorState = { resource: ResourceName; id?: string } | null;

/** 管理 API 调用签名，页面与编辑器都通过它发请求，避免各自拼 header。 */
export type AdminApi = <T>(path: string, init?: RequestInit) => Promise<T>;
