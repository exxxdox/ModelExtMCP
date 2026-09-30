import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBytes, formatDuration, summarizeCapabilityTest, truncateImages } from "./capability-test.js";
import type { CapabilityTestOutcome } from "./types.js";

function outcome(overrides: Partial<CapabilityTestOutcome>): CapabilityTestOutcome {
  return {
    ok: true,
    capabilityKey: "image.describe",
    requestId: "request-id",
    input: { mimeType: "image/png", prompt: "什么颜色？", imageBytes: 68 },
    attempts: [],
    totalMs: 320,
    ...overrides
  };
}

test("a successful test reports how many routes it took", () => {
  const summary = summarizeCapabilityTest(outcome({
    attempts: [
      { priority: 10, endpointName: "host", baseUrl: "http://ollama:11434", modelName: "a", timeoutMs: 1000, requestUrl: "u", requestBody: { model: "a", stream: false, messages: [] }, status: "ok", durationMs: 12 }
    ]
  }));

  assert.equal(summary.tone, "ok");
  assert.match(summary.text, /1 次尝试/);
  assert.match(summary.text, /320 ms/);
});

test("a failure that never reached a route says so instead of blaming the upstream", () => {
  const summary = summarizeCapabilityTest(outcome({ ok: false, errorCode: "NO_ACTIVE_ROUTE" }));

  assert.equal(summary.tone, "error");
  assert.match(summary.text, /NO_ACTIVE_ROUTE/);
  assert.match(summary.text, /未发出请求/);
});

test("a failure with attempts tells the operator how far it got", () => {
  const attempt = { priority: 10, endpointName: "host", baseUrl: "http://ollama:11434", modelName: "a", timeoutMs: 1000, requestUrl: "u", requestBody: { model: "a", stream: false, messages: [] }, status: "error" as const, durationMs: 12 };
  const summary = summarizeCapabilityTest(outcome({ ok: false, errorCode: "OLLAMA_TIMEOUT", attempts: [attempt, { ...attempt, priority: 20 }] }));

  assert.match(summary.text, /OLLAMA_TIMEOUT/);
  assert.match(summary.text, /已尝试 2 条路由/);
});

test("durations and byte counts stay readable at both ends of the scale", () => {
  assert.equal(formatDuration(320), "320 ms");
  assert.equal(formatDuration(1250), "1.25 s");
  assert.equal(formatBytes(68), "68 B");
  assert.equal(formatBytes(4096), "4.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});

test("long base64 images are shortened without hiding that an image was sent", () => {
  const body = {
    model: "vision:test",
    stream: false,
    messages: [
      { role: "system", content: "你是图像理解服务。" },
      { role: "user", content: "什么颜色？", images: ["A".repeat(200)] }
    ]
  };

  const preview = truncateImages(body, 8);

  assert.equal(preview.messages[1]?.images?.[0], "AAAAAAAA…（共 200 字符）");
  assert.equal(preview.messages[0]?.content, "你是图像理解服务。");
  assert.equal(preview.messages[1]?.content, "什么颜色？");
  assert.equal(preview.model, "vision:test");
});

test("a short image is left as-is", () => {
  const preview = truncateImages({ model: "m", stream: false, messages: [{ role: "user", content: "x", images: ["abc"] }] }, 8);

  assert.deepEqual(preview.messages[0]?.images, ["abc"]);
});
