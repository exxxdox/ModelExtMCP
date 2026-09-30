import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOllamaUrl } from "./api.js";

test("normalizeOllamaUrl keeps only a safe service root", () => {
  assert.equal(normalizeOllamaUrl("http://ollama:11434/"), "http://ollama:11434");
  assert.throws(() => normalizeOllamaUrl("ftp://ollama/"), /HTTP/);
  assert.throws(() => normalizeOllamaUrl("http://user:pass@ollama:11434/"), /凭据/);
  assert.throws(() => normalizeOllamaUrl("http://ollama:11434/api/chat"), /根地址/);
});
