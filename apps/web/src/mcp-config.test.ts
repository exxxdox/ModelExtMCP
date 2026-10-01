import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMcpConfig, buildMcpConfigText, mcpServerUrl, redactApiKey } from "./mcp-config.js";

const base = { origin: "http://localhost:3000", apiKey: "mr_live_abcdef123456" };

test("mcpServerUrl appends the MCP path to the origin", () => {
  assert.equal(mcpServerUrl("http://localhost:3000"), "http://localhost:3000/mcp");
});

test("mcpServerUrl tolerates a trailing slash so a copied origin never doubles the separator", () => {
  assert.equal(mcpServerUrl("https://relay.example.com/"), "https://relay.example.com/mcp");
});

test("buildMcpConfig returns an HTTP MCP server entry with the bearer key", () => {
  const config = buildMcpConfig(base);

  assert.deepEqual(config, {
    mcpServers: {
      "model-relay": {
        type: "http",
        url: "http://localhost:3000/mcp",
        headers: { Authorization: "Bearer mr_live_abcdef123456" }
      }
    }
  });
});

test("buildMcpConfigText emits valid, indented JSON that round-trips", () => {
  const text = buildMcpConfigText(base);

  assert.deepEqual(JSON.parse(text), buildMcpConfig(base));
  assert.match(text, /\n {2}"mcpServers"/);
});

test("redactApiKey returns a non-empty placeholder that carries no part of the secret", () => {
  const redacted = redactApiKey();

  assert.ok(redacted.length > 0);
  assert.ok(!redacted.includes("abcdef123456"));
});

test("redacted config stays valid JSON and keeps the endpoint usable", () => {
  const text = buildMcpConfigText({ ...base, redacted: true });

  assert.ok(!text.includes("mr_live_abcdef123456"));
  const parsed = JSON.parse(text) as { mcpServers: Record<string, { url: string }> };
  assert.equal(parsed.mcpServers["model-relay"]?.url, "http://localhost:3000/mcp");
});
