import assert from "node:assert/strict";
import { test } from "node:test";
import { testOllamaEndpoint, validateImage } from "./ollama.js";

test("validateImage accepts a matching PNG", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
  assert.equal(validateImage({ imageBase64: png, mimeType: "image/png" }, 1024), png);
});

test("validateImage rejects a forged MIME type", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64");
  assert.throws(() => validateImage({ imageBase64: jpeg, mimeType: "image/png" }, 1024), /IMAGE_TYPE_MISMATCH/);
});

test("testOllamaEndpoint returns model names from the tags endpoint", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "http://ollama:11434/api/tags");
    return new Response(JSON.stringify({ models: [{ name: "qwen2.5vl:7b" }, { name: "llava:latest" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    assert.deepEqual(await testOllamaEndpoint("http://ollama:11434"), {
      ok: true,
      models: ["qwen2.5vl:7b", "llava:latest"]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
