import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultCapabilityDraft, isUsingCodeDefaults } from "./capability-defaults.js";
import type { Capability, CapabilityDefinition } from "./types.js";

const definition: CapabilityDefinition = {
  definitionKey: "image.describe",
  executorType: "ollama_vision",
  toolName: "analyze_image",
  defaultKey: "image.describe",
  defaultName: "图像理解",
  defaultDescription: "描述图片内容并回答关于图片的问题",
  parameters: []
};

function capability(overrides: Partial<Capability>): Capability {
  return {
    id: "capability-id",
    definitionKey: "image.describe",
    key: "image.describe",
    name: "图像理解",
    description: "描述图片内容并回答关于图片的问题",
    enabled: true,
    version: 1,
    definition,
    ...overrides
  };
}

test("restoring defaults fills the form with the code-owned values", () => {
  assert.deepEqual(defaultCapabilityDraft(definition), {
    key: "image.describe",
    name: "图像理解",
    description: "描述图片内容并回答关于图片的问题"
  });
});

test("a capability matching the code defaults reports no pending restore", () => {
  assert.equal(isUsingCodeDefaults(capability({}), definition), true);
});

test("an admin-edited capability reports that defaults are still available", () => {
  assert.equal(isUsingCodeDefaults(capability({ name: "视觉理解" }), definition), false);
  assert.equal(isUsingCodeDefaults(capability({ key: "vision.analyze" }), definition), false);
  assert.equal(isUsingCodeDefaults(capability({ description: "自定义说明" }), definition), false);
});
