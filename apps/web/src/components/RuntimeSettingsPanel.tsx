import { useState, type FormEvent } from "react";
import type { AdminApi, RuntimeSettings } from "../types";
import { Check, SectionHeader } from "./ui";
import { useNotify } from "./Notifications";

const BYTES_PER_MB = 1_024 * 1_024;

export type RuntimeSettingsPanelProps = {
  settings: RuntimeSettings;
  api: AdminApi;
  onSaved: (settings: RuntimeSettings) => void;
};

/** 图片大小与并发上限的表单；单位换算集中在这里，避免页面重复计算。 */
export function RuntimeSettingsPanel({ settings, api, onSaved }: RuntimeSettingsPanelProps) {
  const notify = useNotify();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const maxImageMb = Number(data.get("maxImageMb"));
    const maxConcurrentRequests = Number(data.get("maxConcurrentRequests"));
    setSaving(true);
    setError(null);
    try {
      const next = await api<RuntimeSettings>("settings", {
        method: "PUT",
        body: JSON.stringify({
          maxImageBytes: Math.round(maxImageMb * BYTES_PER_MB),
          maxConcurrentRequests,
          allowNetworkAccess: data.get("allowNetworkAccess") === "on"
        })
      });
      onSaved(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      // 浮层提示操作结果，表单仍保留错误供修正时查看。
      notify(caught instanceof Error ? caught.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="config-section">
      <SectionHeader title="运行设置" description="控制 MCP 端点的网络可达范围，以及图片大小与并发上限。" />
      <form className="runtime-form" onSubmit={(event) => void submit(event)} key={settings.updatedAt}>
        <div className="runtime-access">
          <Check name="allowNetworkAccess" label="允许网络访问 MCP 端点" defaultChecked={settings.allowNetworkAccess} />
          <small>关闭后只有本机与服务器同网段的地址能调用 /mcp，局域网内其他机器会被拒绝；管理页面与 API 不受影响，经反向代理转发时判定的是代理的地址。</small>
          <small>裸机部署想彻底只监听本机，请设置环境变量 HOST=127.0.0.1 后重启；容器部署下这样会连端口映射一起失效。</small>
        </div>
        <label className="field">
          <span>单张图片上限（MB）</span>
          <input name="maxImageMb" type="number" min="0.01" max="50" step="0.01" defaultValue={(settings.maxImageBytes / BYTES_PER_MB).toFixed(2)} required />
          <small>范围 0.01–50 MB，超过限制的请求会在转发前拒绝。</small>
        </label>
        <label className="field">
          <span>最大并发请求数</span>
          <input name="maxConcurrentRequests" type="number" min="1" max="32" step="1" defaultValue={settings.maxConcurrentRequests} required />
          <small>范围 1–32，超出的请求会等待已有任务完成。</small>
        </label>
        <div className="runtime-save">
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存运行设置"}</button>
        </div>
      </form>
    </section>
  );
}
