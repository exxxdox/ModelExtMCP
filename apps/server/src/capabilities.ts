import { z, type ZodType } from "zod";

/**
 * 内置能力注册表。
 *
 * 为什么能力写死在代码里：能力的可执行部分（工具参数、图片校验、调用 Ollama）
 * 都是代码实现的，数据库只保存管理员可改的展示信息（名称、标识、描述、启用状态）
 * 与路由。因此能力集合不提供新增与删除，而标识与描述可以改。
 *
 * definition_key 是不可变的代码标识，用来在改名与升级后仍然找到同一行数据；
 * key 是给 Agent 看的标识，管理员可以改。
 */

/** MCP 工具 analyze_image 的入参契约，同时也是能力参数说明的唯一来源。 */
export const IMAGE_INPUT_SCHEMA = z.object({
  capabilityKey: z.string().min(1).optional().describe("要调用的能力标识，省略时使用服务端配置的默认能力"),
  imageBase64: z.string().min(1).describe("JPEG、PNG 或 WebP 图片的 Base64 内容，可包含 data URL 前缀"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).describe("图片 MIME 类型"),
  prompt: z.string().max(4_000).optional().describe("希望模型回答的图片相关问题")
});

export type CapabilityDefinition = {
  definitionKey: string;
  /** 首次写入数据库时使用的 Agent 可见标识，之后允许修改。 */
  defaultKey: string;
  name: string;
  description: string;
  executorType: "ollama_vision";
  toolName: string;
  inputSchema: ZodType;
};

export type CapabilityParameter = {
  name: string;
  /** 展示用类型：枚举展开为 “a | b”，避免只显示 string。 */
  type: string;
  required: boolean;
  description: string;
};

/** 返回给管理端的只读定义，可直接 JSON 序列化。 */
export type CapabilityDefinitionView = {
  definitionKey: string;
  executorType: "ollama_vision";
  toolName: string;
  parameters: CapabilityParameter[];
};

export const VISION_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    definitionKey: "image.describe",
    defaultKey: "image.describe",
    name: "图像理解",
    description: "描述图片内容并回答关于图片的问题",
    executorType: "ollama_vision",
    toolName: "analyze_image",
    inputSchema: IMAGE_INPUT_SCHEMA
  }
];

/** 默认能力：Agent 未指定 capabilityKey 时走这里，也是回填旧库的目标。 */
export const PRIMARY_CAPABILITY_DEFINITION_KEY = VISION_CAPABILITY_DEFINITIONS[0]!.definitionKey;

export function findCapabilityDefinition(definitionKey: string): CapabilityDefinition | undefined {
  return VISION_CAPABILITY_DEFINITIONS.find((definition) => definition.definitionKey === definitionKey);
}

export function viewCapabilityDefinition(definition: CapabilityDefinition): CapabilityDefinitionView {
  const schema = z.toJSONSchema(definition.inputSchema, { io: "input" }) as {
    properties?: Record<string, { type?: string | string[]; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);

  return {
    definitionKey: definition.definitionKey,
    executorType: definition.executorType,
    toolName: definition.toolName,
    parameters: Object.entries(schema.properties ?? {}).map(([name, property]) => ({
      name,
      type: describeParameterType(property),
      required: required.has(name),
      description: property.description ?? ""
    }))
  };
}

function describeParameterType(property: { type?: string | string[]; enum?: unknown[] }): string {
  if (Array.isArray(property.enum) && property.enum.length > 0) return property.enum.map(String).join(" | ");
  if (Array.isArray(property.type)) return property.type.join(" | ");
  return property.type ?? "unknown";
}
