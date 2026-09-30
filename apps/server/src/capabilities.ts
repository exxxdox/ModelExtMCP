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
 *
 * description 不是管理端内部的备注，而是 Agent 判断该不该调用这个能力的唯一依据：
 * 它会随 MCP 工具描述一起发给 Agent（见 mcp.ts）。因此注册表里的 default* 只是首次
 * 写入数据库的基线，改坏了可以随时恢复。
 */

/**
 * capabilityKey 的说明基线。运行时会在这句后面接上当前默认能力标识（见 mcp.ts），
 * 管理端只读参数表展示的也是这句，两边共用同一个常量才不会各说各话。
 */
export const CAPABILITY_KEY_PARAMETER_DESCRIPTION = "要调用的能力标识，省略时使用默认能力";

/** MCP 工具 analyze_image 的入参契约，同时也是能力参数说明的唯一来源。 */
export const IMAGE_INPUT_SCHEMA = z.object({
  capabilityKey: z.string().min(1).optional().describe(CAPABILITY_KEY_PARAMETER_DESCRIPTION),
  imageBase64: z.string().min(1).describe("JPEG、PNG 或 WebP 图片的 Base64 内容，可包含 data URL 前缀"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).describe("图片 MIME 类型"),
  prompt: z.string().max(4_000).optional().describe("希望模型回答的图片相关问题")
});

export type CapabilityDefinition = {
  definitionKey: string;
  /** 以下是首次写入数据库的默认值，管理员改过之后仍可据此恢复。 */
  defaultKey: string;
  defaultName: string;
  /** Agent 判断该不该调用这个能力的说明，会随 MCP 工具描述下发。 */
  defaultDescription: string;
  executorType: "ollama_vision";
  toolName: string;
  inputSchema: ZodType;
  /**
   * 管理端「测试」按钮用的静态样例输入。
   *
   * 为什么写死在代码里而不是让管理员填：测试的前提是「点一下就出结果」，不该先要求
   * 准备一张图。它必须能通过同一个 inputSchema，capabilities.test.ts 守住这条约束，
   * 免得上游契约改了而样例悄悄失效。
   */
  sampleInput: Record<string, unknown>;
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
  /** 代码基线：管理端用它展示默认值并提供恢复，与数据库中的当前值分开。 */
  defaultKey: string;
  defaultName: string;
  defaultDescription: string;
  parameters: CapabilityParameter[];
};

/** 1x1 红色 PNG，68 字节：够小，又能真实通过图片头校验走完整条链路。 */
const SAMPLE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const VISION_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    definitionKey: "image.describe",
    defaultKey: "image.describe",
    defaultName: "图像理解",
    defaultDescription: "描述图片内容并回答关于图片的问题",
    executorType: "ollama_vision",
    toolName: "analyze_image",
    inputSchema: IMAGE_INPUT_SCHEMA,
    sampleInput: {
      imageBase64: SAMPLE_PNG_BASE64,
      mimeType: "image/png",
      prompt: "这张图片是什么颜色？"
    }
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
    defaultKey: definition.defaultKey,
    defaultName: definition.defaultName,
    defaultDescription: definition.defaultDescription,
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
