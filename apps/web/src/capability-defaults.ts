import type { Capability, CapabilityDefinition } from "./types.js";

/** 能力表单里管理员可改的三个字段，与数据库中的 key / name / description 一一对应。 */
export type CapabilityDraft = {
  key: string;
  name: string;
  description: string;
};

/**
 * 恢复默认用的草稿。
 *
 * 为什么要有它：能力写在代码注册表里，管理员改的是数据库行。没有基线时，一旦把
 * Agent 可见说明改坏就再也回不去——Agent 的判断依据会一直错下去。
 */
export function defaultCapabilityDraft(definition: CapabilityDefinition): CapabilityDraft {
  return {
    key: definition.defaultKey,
    name: definition.defaultName,
    description: definition.defaultDescription
  };
}

/** 当前值是否已等于代码默认值；用来决定「恢复默认值」按钮是否还需要可点。 */
export function isUsingCodeDefaults(capability: Capability, definition: CapabilityDefinition): boolean {
  return capability.key === definition.defaultKey
    && capability.name === definition.defaultName
    && capability.description === definition.defaultDescription;
}
