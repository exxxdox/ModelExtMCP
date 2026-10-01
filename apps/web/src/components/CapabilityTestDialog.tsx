import { useCallback, useEffect, useState } from "react";
import { formatBytes, formatDuration, summarizeCapabilityTest, truncateImages } from "../capability-test";
import type { AdminApi, Capability, CapabilityTestAttempt, CapabilityTestOutcome } from "../types";
import { useNotify } from "./Notifications";

export type CapabilityTestDialogProps = {
  capability: Capability;
  api: AdminApi;
  onClose: () => void;
};

/** 一次尝试的展示：上面是「发出去的是什么」，下面是「回来的是什么」。 */
function AttemptCard({ attempt }: { attempt: CapabilityTestAttempt }) {
  const succeeded = attempt.status === "ok";
  return (
    <article className={succeeded ? "attempt ok" : "attempt"}>
      <header>
        <strong>{succeeded ? "成功" : "失败"}</strong>
        <code>{attempt.modelName}</code>
        <span>{formatDuration(attempt.durationMs)}</span>
      </header>
      <dl className="contract-facts">
        <div><dt>优先级</dt><dd>{attempt.priority}</dd></div>
        <div><dt>端点</dt><dd>{attempt.endpointName}</dd></div>
        <div><dt>服务地址</dt><dd><code>{attempt.baseUrl}</code></dd></div>
        <div><dt>超时</dt><dd>{formatDuration(attempt.timeoutMs)}</dd></div>
      </dl>
      <p className="attempt-label">实际请求</p>
      <pre className="attempt-body">{JSON.stringify(truncateImages(attempt.requestBody), null, 2)}</pre>
      <p className="attempt-label">{succeeded ? "模型返回" : "错误"}</p>
      <pre className="attempt-body">{succeeded ? attempt.responseText ?? "" : attempt.errorCode ?? "未知错误"}</pre>
    </article>
  );
}

/**
 * 能力测试弹窗：打开即用服务端代码里的静态样例打一次真实链路。
 *
 * 展示的重点是过程而不是结论——端点、模型、超时、实际请求体、每次尝试的结果，
 * 这样管理员看到的失败原因能直接指向要改的那一行配置。
 */
export function CapabilityTestDialog({ capability, api, onClose }: CapabilityTestDialogProps) {
  const notify = useNotify();
  const [outcome, setOutcome] = useState<CapabilityTestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const next = await api<CapabilityTestOutcome>(`capabilities/${capability.id}/test`, { method: "POST", body: "{}" });
      setOutcome(next);
      // HTTP 成功不代表模型调用成功，用业务结果决定反馈颜色。
      notify(summarizeCapabilityTest(next).text, next.ok ? "success" : "error");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "测试请求失败");
      notify(caught instanceof Error ? caught.message : "测试请求失败", "error");
      setOutcome(null);
    } finally {
      setRunning(false);
    }
  }, [api, capability.id, notify]);

  useEffect(() => { void run(); }, [run]);

  const summary = outcome ? summarizeCapabilityTest(outcome) : null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="test-title">
        <div className="modal-heading">
          <div><p>用服务端准备好的样例参数真实调用一次</p><h2 id="test-title">测试「{capability.name}」</h2></div>
          <button onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="modal-body">
          <div className="test-toolbar">
            {running && <span className="test-summary">测试中…</span>}
            {!running && summary && <span className={summary.tone === "ok" ? "test-summary ok" : "test-summary"}>{summary.text}</span>}
            <button type="button" className="secondary" onClick={() => void run()} disabled={running}>重新测试</button>
          </div>

          {error && <p className="form-error">{error}</p>}

          <section className="test-section">
            <h3>样例输入</h3>
            {outcome ? (
              <dl className="contract-facts">
                <div><dt>能力标识</dt><dd><code>{outcome.capabilityKey}</code></dd></div>
                <div><dt>图片</dt><dd>{formatBytes(outcome.input.imageBytes)} · <code>{outcome.input.mimeType}</code></dd></div>
                <div><dt>提示词</dt><dd>{outcome.input.prompt || "（未提供，用路由的默认提示词）"}</dd></div>
                {/* UUID 会把这格折成三行；短号够用来对日志，完整值仍在原始 JSON 里。 */}
                <div><dt>请求编号</dt><dd><code title={outcome.requestId}>{outcome.requestId.slice(0, 8)}</code></dd></div>
              </dl>
            ) : <p className="contract-note">等待返回…</p>}
          </section>

          <section className="test-section">
            <h3>路由尝试（按优先级）</h3>
            {outcome && outcome.attempts.length === 0 && (
              <p className="contract-note">没有任何路由被尝试：这个能力当前没有可用路由，或输入在进入上游之前就被拒绝了。</p>
            )}
            {outcome?.attempts.map((attempt) => <AttemptCard key={`${attempt.priority}-${attempt.modelName}`} attempt={attempt} />)}
          </section>

          {outcome?.text && (
            <section className="test-section">
              <h3>返回内容</h3>
              <pre className="attempt-body">{outcome.text}</pre>
            </section>
          )}

          {outcome && (
            <details className="test-section">
              <summary>完整诊断（原始 JSON）</summary>
              <pre className="attempt-body">{JSON.stringify(outcome, null, 2)}</pre>
            </details>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
      </section>
    </div>
  );
}
