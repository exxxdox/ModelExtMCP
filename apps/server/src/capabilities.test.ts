import assert from "node:assert/strict";
import { test } from "node:test";
import { MCP_TOOL_NAME_PATTERN, PRIMARY_CAPABILITY_DEFINITION_KEY, VISION_CAPABILITY_DEFINITIONS, viewCapabilityDefinition } from "./capabilities.js";
import { validateImage } from "./ollama.js";

test("built-in capabilities use unique, code-owned definition keys", () => {
  const keys = VISION_CAPABILITY_DEFINITIONS.map((definition) => definition.definitionKey);

  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes(PRIMARY_CAPABILITY_DEFINITION_KEY));
});

test("every capability default key is a legal MCP tool name", () => {
  for (const definition of VISION_CAPABILITY_DEFINITIONS) {
    // 能力标识就是 MCP 工具名，客户端把工具名原样交给模型，带点号等字符会让调用直接失败。
    assert.match(definition.defaultKey, MCP_TOOL_NAME_PATTERN, `${definition.definitionKey} 的默认标识不是合法工具名`);
  }
});

test("the image capability exposes its MCP tool contract as read-only parameters", () => {
  const view = viewCapabilityDefinition(VISION_CAPABILITY_DEFINITIONS[0]!);

  assert.equal(view.executorType, "ollama_vision");
  // 能力与工具一一对应，能力选择由工具名完成，因此参数里不再有 capabilityKey。
  assert.deepEqual(view.parameters.map((parameter) => parameter.name), ["imageBase64", "mimeType", "prompt"]);
  assert.equal(view.parameters.find((parameter) => parameter.name === "imageBase64")?.required, true);
  assert.equal(view.parameters.find((parameter) => parameter.name === "prompt")?.required, false);
});

test("constrained parameters show their allowed values instead of a bare string type", () => {
  const view = viewCapabilityDefinition(VISION_CAPABILITY_DEFINITIONS[0]!);

  assert.equal(view.parameters.find((parameter) => parameter.name === "mimeType")?.type, "image/jpeg | image/png | image/webp");
});

test("every parameter carries the description the MCP client sees", () => {
  const view = viewCapabilityDefinition(VISION_CAPABILITY_DEFINITIONS[0]!);

  for (const parameter of view.parameters) {
    assert.ok(parameter.description.length > 0, `parameter ${parameter.name} needs a description`);
  }
});

test("every capability ships a sample input its own contract accepts", () => {
  for (const definition of VISION_CAPABILITY_DEFINITIONS) {
    // 页面上的「测试」按钮直接拿这份样例去打真实链路，样例一旦和契约漂移，测试按钮就会先坏。
    const parsed = definition.inputSchema.parse(definition.sampleInput) as { imageBase64: string; mimeType: string };
    assert.doesNotThrow(() => validateImage(parsed as never, 10 * 1024 * 1024), `${definition.definitionKey} 的样例图片无法通过校验`);
  }
});

test("the read-only view carries the code defaults the admin console restores from", () => {
  const definition = VISION_CAPABILITY_DEFINITIONS[0]!;
  const view = viewCapabilityDefinition(definition);

  assert.equal(view.defaultKey, definition.defaultKey);
  assert.equal(view.defaultName, definition.defaultName);
  assert.equal(view.defaultDescription, definition.defaultDescription);
  assert.ok(view.defaultDescription.length > 0, "the agent needs a non-empty default description");
});

test("the view is JSON serializable so the admin API can return it directly", () => {
  const view = viewCapabilityDefinition(VISION_CAPABILITY_DEFINITIONS[0]!);

  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});
