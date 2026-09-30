import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIMARY_CAPABILITY_DEFINITION_KEY, VISION_CAPABILITY_DEFINITIONS, viewCapabilityDefinition } from "./capabilities.js";

test("built-in capabilities use unique, code-owned definition keys", () => {
  const keys = VISION_CAPABILITY_DEFINITIONS.map((definition) => definition.definitionKey);

  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes(PRIMARY_CAPABILITY_DEFINITION_KEY));
});

test("the image capability exposes its MCP tool contract as read-only parameters", () => {
  const view = viewCapabilityDefinition(VISION_CAPABILITY_DEFINITIONS[0]!);

  assert.equal(view.toolName, "analyze_image");
  assert.equal(view.executorType, "ollama_vision");
  assert.deepEqual(view.parameters.map((parameter) => parameter.name), ["capabilityKey", "imageBase64", "mimeType", "prompt"]);
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

test("the view is JSON serializable so the admin API can return it directly", () => {
  const view = viewCapabilityDefinition(VISION_CAPABILITY_DEFINITIONS[0]!);

  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});
