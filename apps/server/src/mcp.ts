import { randomUUID } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { VisionService } from "./service.js";

const imageInputSchema = z.object({
  capabilityKey: z.string().default("image.describe").describe("要调用的能力标识，默认 image.describe"),
  imageBase64: z.string().min(1).describe("JPEG、PNG 或 WebP 图片的 Base64 内容，可包含 data URL 前缀"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).describe("图片 MIME 类型"),
  prompt: z.string().max(4_000).optional().describe("希望模型回答的图片相关问题")
});

export function createVisionMcpHandler(service: VisionService) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: "model-ext-mcp", version: "0.1.0" });
      server.registerTool(
        "analyze_image",
        {
          title: "Analyze image with a configured vision model",
          description: "When the current model cannot see images, send an image to a configured Ollama vision model.",
          inputSchema: imageInputSchema
        },
        async (input) => {
          try {
            const result = await service.analyze(input.capabilityKey, input, randomUUID());
            return {
              content: [{ type: "text" as const, text: result.text }],
              structuredContent: result
            };
          } catch (error) {
            const code = error instanceof Error ? error.message : "VISION_ANALYSIS_FAILED";
            return {
              isError: true,
              content: [{ type: "text" as const, text: `图像分析失败：${code}` }]
            };
          }
        }
      );
      return server;
    },
    { responseMode: "json" }
  );
}
