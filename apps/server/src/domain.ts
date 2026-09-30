export type Capability = {
  id: string;
  key: string;
  name: string;
  description: string;
  executorType: "ollama_vision";
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OllamaEndpoint = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModelDeployment = {
  id: string;
  endpointId: string;
  modelName: string;
  supportsVision: boolean;
  timeoutMs: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityRoute = {
  id: string;
  capabilityId: string;
  deploymentId: string;
  priority: number;
  promptTemplate: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedRoute = CapabilityRoute & {
  capabilityKey: string;
  capabilityName: string;
  endpointName: string;
  baseUrl: string;
  modelName: string;
  timeoutMs: number;
};
