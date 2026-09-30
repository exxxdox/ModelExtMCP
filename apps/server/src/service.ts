import type { AppDatabase } from "./database.js";
import { callOllama, type ImageInput, OllamaRequestError, validateImage } from "./ollama.js";

export type AnalysisResult = {
  text: string;
  capabilityKey: string;
  requestId: string;
};

class Semaphore {
  private active = 0;

  constructor(
    private readonly getMax: () => number,
    private readonly waiters: Array<() => void> = []
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.active >= this.getMax()) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      // 全部唤醒后由各请求重新检查动态上限，确保降低并发配置也不会放行过多请求。
      this.waiters.splice(0).forEach((resolve) => resolve());
    }
  }
}

export class VisionService {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly database: AppDatabase
  ) {
    this.semaphore = new Semaphore(() => this.database.getRuntimeSettings().maxConcurrentRequests);
  }

  /**
   * Agent 可以省略能力标识；此时用服务端配置的默认能力，避免调用方硬编码一个
   * 管理员随时可能改掉的字符串。
   */
  resolveCapabilityKey(capabilityKey: string | undefined): string {
    return capabilityKey?.trim() || this.database.getDefaultCapabilityKey();
  }

  async analyze(capabilityKey: string | undefined, input: ImageInput, requestId: string): Promise<AnalysisResult> {
    const resolvedKey = this.resolveCapabilityKey(capabilityKey);
    const imageBase64 = validateImage(input, this.database.getRuntimeSettings().maxImageBytes);
    const routes = this.database.resolveRoutes(resolvedKey);
    if (routes.length === 0) throw new Error("NO_ACTIVE_ROUTE");

    return this.semaphore.run(async () => {
      let lastError: Error | undefined;
      for (const route of routes) {
        try {
          const text = await callOllama(route, imageBase64, input.prompt);
          return { text, capabilityKey: resolvedKey, requestId };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("OLLAMA_ERROR");
          if (!(error instanceof OllamaRequestError) || !error.retryable) break;
        }
      }
      throw lastError ?? new Error("OLLAMA_ERROR");
    });
  }
}
