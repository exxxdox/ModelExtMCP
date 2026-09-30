import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppDatabase } from "./database.js";
import { VisionService } from "./service.js";

function withDatabase(run: (database: AppDatabase) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "model-ext-mcp-service-"));
  const database = new AppDatabase(directory);
  try {
    run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("an omitted capability key falls back to the configured default capability", () => {
  withDatabase((database) => {
    const service = new VisionService(database);

    assert.equal(service.resolveCapabilityKey(undefined), database.getDefaultCapabilityKey());
  });
});

test("the fallback follows a renamed capability so agents without a key keep working", () => {
  withDatabase((database) => {
    const [capability] = database.listCapabilities();
    assert.ok(capability);
    database.updateCapability(capability.id, {
      key: "vision.analyze",
      name: capability.name,
      description: capability.description,
      enabled: true,
      version: capability.version
    });

    const service = new VisionService(database);

    assert.equal(service.resolveCapabilityKey(undefined), "vision.analyze");
  });
});

test("an explicit capability key is used as-is", () => {
  withDatabase((database) => {
    const service = new VisionService(database);

    assert.equal(service.resolveCapabilityKey("image.describe"), "image.describe");
  });
});
