import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // 固定根目录，确保从 monorepo 根目录或 Docker 构建时行为一致。
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      // 控制台复制的 MCP 配置使用页面自身的 origin，开发时也要能打通 /mcp。
      "/mcp": "http://localhost:3000"
    }
  }
});
