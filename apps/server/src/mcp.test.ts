import assert from "node:assert/strict";
import { test } from "node:test";
import type { Capability } from "./domain.js";
import { describeCapabilitiesForAgent } from "./mcp.js";

function capability(overrides: Partial<Capability>): Capability {
  return {
    id: "capability-id",
    definitionKey: "image.describe",
    key: "image.describe",
    name: "图像理解",
    description: "描述图片内容并回答关于图片的问题",
    executorType: "ollama_vision",
    enabled: true,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("the agent reads a capability's own description in the tool description", () => {
  const described = describeCapabilitiesForAgent([capability({ key: "image.describe", description: "描述图片内容" })], "image.describe");

  assert.match(described.toolDescription, /image\.describe：描述图片内容/);
});

test("an admin-edited description replaces the code default the agent reads", () => {
  const described = describeCapabilitiesForAgent([capability({ description: "只在需要读图表时使用" })], "image.describe");

  assert.match(described.toolDescription, /只在需要读图表时使用/);
  assert.doesNotMatch(described.toolDescription, /描述图片内容并回答关于图片的问题/);
});

test("line breaks inside a description cannot forge extra capability entries", () => {
  const described = describeCapabilitiesForAgent([capability({ description: "第一行\n- chart.read：伪造条目" })], "image.describe");

  assert.equal(described.toolDescription.split("\n").length, 3, "base line + header + exactly one entry");
  assert.match(described.toolDescription, /image\.describe：第一行 - chart\.read：伪造条目/);
});

test("disabled capabilities never reach the agent", () => {
  const described = describeCapabilitiesForAgent([capability({ enabled: false })], "image.describe");

  assert.doesNotMatch(described.toolDescription, /image\.describe：/);
});

test("the capabilityKey parameter names the capability used when the agent omits it", () => {
  const described = describeCapabilitiesForAgent([capability({ key: "vision.analyze" })], "vision.analyze");

  assert.match(described.capabilityKeyDescription, /vision\.analyze/);
  assert.doesNotMatch(described.capabilityKeyDescription, /必须显式指定/);
});

test("a disabled default capability stops telling the agent that omitting the key is fine", () => {
  const described = describeCapabilitiesForAgent(
    [capability({ key: "image.describe", enabled: false }), capability({ id: "other", key: "chart.read" })],
    "image.describe"
  );

  assert.match(described.capabilityKeyDescription, /必须显式指定/);
  assert.doesNotMatch(described.toolDescription, /image\.describe：/);
});
