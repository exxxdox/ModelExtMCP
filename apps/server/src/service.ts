import type { AppDatabase } from "./database.js";
import type { ResolvedRoute } from "./domain.js";
import { buildOllamaRequest, callOllama, type ImageInput, type OllamaChatRequest, OllamaRequestError, validateImage } from "./ollama.js";

export type AnalysisResult = {
  text: string;
  capabilityKey: string;
  requestId: string;
};

/** 一次能力测试里对某条路由的完整尝试记录：管理端展示的「实际参数」就是这些字段。 */
export type CapabilityTestAttempt = {
  priority: number;
  endpointName: string;
  baseUrl: string;
  modelName: string;
  timeoutMs: number;
  /** 实际发出的 URL 与请求体，与线上调用同源，不做二次拼装。 */
  requestUrl: string;
  requestBody: OllamaChatRequest;
  status: "ok" | "error";
  errorCode?: string | undefined;
  durationMs: number;
  responseText?: string | undefined;
};

export type CapabilityTestOutcome = {
  ok: boolean;
  /** 这次测试实际调用的能力标识（也即 MCP 工具名）。 */
  capabilityKey: string;
  requestId: string;
  input: { mimeType: string; prompt: string; imageBytes: number };
  attempts: CapabilityTestAttempt[];
  text?: string | undefined;
  errorCode?: string | undefined;
  totalMs: number;
};

type DispatchOutcome =
  | { ok: true; text: string; attempts: CapabilityTestAttempt[] }
  | { ok: false; error: Error; attempts: CapabilityTestAttempt[] };

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
   * 能力标识必传：MCP 工具名就是能力标识，处理器与管理端测试都知道自己调的是哪个能力。
   * 不再有「省略就用默认能力」这条路径——它只会让「到底调了哪个能力」变得不确定。
   */
  async analyze(capabilityKey: string, input: ImageInput, requestId: string): Promise<AnalysisResult> {
    const imageBase64 = validateImage(input, this.database.getRuntimeSettings().maxImageBytes);
    const routes = this.database.resolveRoutes(capabilityKey);
    if (routes.length === 0) throw new Error("NO_ACTIVE_ROUTE");

    return this.semaphore.run(async () => {
      const outcome = await this.dispatch(routes, imageBase64, input.prompt);
      // MCP 调用方只该看到失败原因，不该看到内部尝试过程。
      if (!outcome.ok) throw outcome.error;
      return { text: outcome.text, capabilityKey, requestId };
    });
  }

  /**
   * 管理端的「测试」按钮走这里：同一套路由解析、同一套请求构造、同一个并发闸门，
   * 区别只在于把过程原样带回来。它不抛错——诊断结果本身就是返回值，
   * 否则管理端只能看到一句失败信息，看不到是哪条路由、哪个模型、卡在哪一步。
   */
  async testCapability(capabilityKey: string, input: ImageInput, requestId: string): Promise<CapabilityTestOutcome> {
    const startedAt = Date.now();
    // 图片字节数只有校验通过后才有意义；校验没通过时保持 0，不编造一个数字。
    const inputFacts = { mimeType: input.mimeType, prompt: input.prompt?.trim() ?? "", imageBytes: 0 };
    const finish = (rest: Omit<CapabilityTestOutcome, "capabilityKey" | "requestId" | "input" | "totalMs">): CapabilityTestOutcome =>
      ({ capabilityKey, requestId, input: inputFacts, totalMs: Date.now() - startedAt, ...rest });

    try {
      const imageBase64 = validateImage(input, this.database.getRuntimeSettings().maxImageBytes);
      inputFacts.imageBytes = Buffer.from(imageBase64, "base64").length;
      const routes = this.database.resolveRoutes(capabilityKey);
      if (routes.length === 0) throw new Error("NO_ACTIVE_ROUTE");

      return await this.semaphore.run(async () => {
        const outcome = await this.dispatch(routes, imageBase64, input.prompt);
        return outcome.ok
          ? finish({ ok: true, attempts: outcome.attempts, text: outcome.text })
          : finish({ ok: false, attempts: outcome.attempts, errorCode: outcome.error.message });
      });
    } catch (error) {
      return finish({ ok: false, attempts: [], errorCode: error instanceof Error ? error.message : "VISION_TEST_FAILED" });
    }
  }

  /**
   * 按优先级依次尝试路由，并把每次尝试原样记下来。
   *
   * 回退规则与线上完全一致：只有可重试的故障才换下一条路由，否则会用另一个模型
   * 掩盖输入或权限错误——测试视图必须反映这条规则，否则它给出的结论会骗人。
   */
  private async dispatch(routes: readonly ResolvedRoute[], imageBase64: string, prompt: string | undefined): Promise<DispatchOutcome> {
    const attempts: CapabilityTestAttempt[] = [];
    let lastError: Error = new Error("OLLAMA_ERROR");

    for (const route of routes) {
      const startedAt = Date.now();
      const routeFacts = {
        priority: route.priority,
        endpointName: route.endpointName,
        baseUrl: route.baseUrl,
        modelName: route.modelName,
        timeoutMs: route.timeoutMs
      };
      try {
        const call = await callOllama(route, imageBase64, prompt);
        attempts.push({
          ...routeFacts,
          requestUrl: call.requestUrl,
          requestBody: call.requestBody,
          status: "ok",
          durationMs: Date.now() - startedAt,
          responseText: call.text
        });
        return { ok: true, text: call.text, attempts };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("OLLAMA_ERROR");
        attempts.push({
          ...routeFacts,
          // 失败时没有回传的请求对象，用同一个构造函数补一份：失败不常见，这点重复可以忽略，
          // 换来的是「展示的请求」与「实发的请求」永远出自同一处代码。
          requestUrl: `${route.baseUrl}/api/chat`,
          requestBody: buildOllamaRequest(route, imageBase64, prompt),
          status: "error",
          errorCode: lastError.message,
          durationMs: Date.now() - startedAt
        });
        if (!(error instanceof OllamaRequestError) || !error.retryable) break;
      }
    }

    return { ok: false, error: lastError, attempts };
  }
}
