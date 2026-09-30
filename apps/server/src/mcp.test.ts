import assert from "node:assert/strict";
import { test } from "node:test";
import type { Capability } from "./domain.js";
import { describeCapabilityTools } from "./mcp.js";

function capability(overrides: Partial<Capability>): Capability {
  return {
    id: "capability-id",
    definitionKey: "image.describe",
    key: "analyze_image",
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

test("one enabled capability becomes one tool named after its key", () => {
  const tools = describeCapabilityTools([capability({ key: "analyze_image", name: "图像理解" })]);

  assert.deepEqual(tools.map((tool) => tool.name), ["analyze_image"]);
  assert.equal(tools[0]?.title, "图像理解");
});

test("the agent-visible description is the whole tool description", () => {
  const tools = describeCapabilityTools([capability({ description: "只在需要读图表时使用" })]);

  assert.equal(tools[0]?.description, "只在需要读图表时使用");
});

test("a new capability becomes a new tool instead of an entry inside another tool's description", () => {
  const tools = describeCapabilityTools([
    capability({ key: "analyze_image", description: "描述图片内容" }),
    capability({ id: "other", definitionKey: "chart.read", key: "read_chart", description: "读出图表里的数值" })
  ]);

  assert.deepEqual(tools.map((tool) => tool.name), ["analyze_image", "read_chart"]);
  // 每个工具只讲自己：另一个能力的名字与说明不得出现在本工具的描述里。
  assert.equal(tools[0]?.description, "描述图片内容");
  assert.doesNotMatch(tools[0]?.description ?? "", /read_chart|图表/);
});

test("an admin-edited description replaces the code default the agent reads", () => {
  const tools = describeCapabilityTools([capability({ description: "改成只读图表" })]);

  assert.equal(tools[0]?.description, "改成只读图表");
});

test("disabled capabilities are not registered as tools at all", () => {
  const tools = describeCapabilityTools([capability({ enabled: false })]);

  assert.deepEqual(tools, []);
});

test("no capability yields an empty tool list instead of a placeholder entry", () => {
  assert.deepEqual(describeCapabilityTools([]), []);
});
