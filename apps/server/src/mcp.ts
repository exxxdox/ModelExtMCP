import { randomUUID } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { IMAGE_INPUT_SCHEMA } from "./capabilities.js";
import type { VisionService } from "./service.js";

export function createVisionMcpHandler(service: VisionService) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: "model-ext-mcp", version: "0.1.0" });
      server.registerTool(
        "analyze_image",
        {
          title: "Analyze image with a configured vision model",
          description: "When the current model cannot see images, send an image to a configured Ollama vision model.",
          inputSchema: IMAGE_INPUT_SCHEMA
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
