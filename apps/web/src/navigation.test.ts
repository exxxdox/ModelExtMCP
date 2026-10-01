import assert from "node:assert/strict";
import { test } from "node:test";
import { hashForPage, pageFromHash, PAGES } from "./navigation.js";

test("pageFromHash reads the page key from a hash route", () => {
  assert.equal(pageFromHash("#/ollama"), "ollama");
  assert.equal(pageFromHash("#/capabilities"), "capabilities");
  assert.equal(pageFromHash("#/settings"), "settings");
});

test("pageFromHash falls back to the dashboard for empty or unknown routes", () => {
  for (const hash of ["", "#", "#/", "#/unknown"]) {
    assert.equal(pageFromHash(hash), "dashboard", `hash ${JSON.stringify(hash)}`);
  }
});

test("pageFromHash resolves nested paths by their first segment", () => {
  assert.equal(pageFromHash("#/ollama/nested"), "ollama");
});

test("hashForPage round-trips through pageFromHash", () => {
  for (const page of PAGES) {
    assert.equal(pageFromHash(hashForPage(page.key)), page.key);
  }
});

test("page keys and labels stay unique so the nav renders unambiguous tabs", () => {
  assert.equal(new Set(PAGES.map((page) => page.key)).size, PAGES.length);
  assert.equal(new Set(PAGES.map((page) => page.label)).size, PAGES.length);
});

test("capabilities is second and external capabilities preserves the Ollama route", () => {
  assert.equal(PAGES[1]?.key, "capabilities");
  assert.equal(PAGES.find((page) => page.key === "ollama")?.label, "外部能力");
  assert.equal(hashForPage("ollama"), "#/ollama");
});
