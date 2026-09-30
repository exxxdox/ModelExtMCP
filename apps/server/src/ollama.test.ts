import assert from "node:assert/strict";
import { test } from "node:test";
import { validateImage } from "./ollama.js";

test("validateImage accepts a matching PNG", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
  assert.equal(validateImage({ imageBase64: png, mimeType: "image/png" }, 1024), png);
});

test("validateImage rejects a forged MIME type", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64");
  assert.throws(() => validateImage({ imageBase64: jpeg, mimeType: "image/png" }, 1024), /IMAGE_TYPE_MISMATCH/);
});
