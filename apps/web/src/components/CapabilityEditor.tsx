import { useRef, useState, type FormEvent } from "react";
import type { EditorProps } from "./Editor";
import { Check, Field, SelectField } from "./ui";
import { useNotify } from "./Notifications";

const TABS = ["编辑", "参数说明", "外部能力路由"] as const;

export function CapabilityEditor({ editor, capabilities, endpoints, deployments, routes, discoveredModels, refreshingModels, onRefreshModels, api, onClose, onSaved }: EditorProps) {
  const capability = capabilities.find((item) => item.id === editor.id);
  const definition = capability?.definition;
  // 端点集合当前全部属于 Ollama；提供者由能力定义约束，不能自行切换。
  const availableEndpoints = definition?.externalProvider === "ollama" ? endpoints : [];
  const notify = useNotify();
  const [tab, setTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  // 每条路由保留独立草稿；稳定 key 防止删除前一条后，不受控输入串到下一条。
  const [routeDrafts, setRouteDrafts] = useState(() => routes.filter((item) => item.capabilityId === editor.id).map((item) => {
    const deployment = deployments.find((model) => model.id === item.deploymentId);
    return { id: item.id, enabled: item.enabled, priority: item.priority, draftKey: item.id, endpointId: deployment?.endpointId ?? "", modelName: deployment?.modelName ?? "", timeoutMs: deployment?.timeoutMs ?? 60000, supportsVision: deployment?.supportsVision ?? false };
  }));

  function selectTab(index: number): void {
    setTab(index);
    if (index === 2 && discoveredModels === null && !refreshingModels) void onRefreshModels();
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    // 所有页签保持挂载以保留草稿；验证失败先切到对应页签，避免隐藏字段无法聚焦。
    const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:invalid, select:invalid, textarea:invalid");
    if (invalid) {
      setTab(Number(invalid.closest<HTMLElement>("[data-tab]")?.dataset.tab ?? 0));
      requestAnimationFrame(() => invalid.reportValidity());
      return;
    }
    const data = new FormData(form);
    setSaving(true);
    setError(null);
    try {
      await api(`capabilities/${editor.id}/configuration`, {
        method: "PUT",
        body: JSON.stringify({
          key: data.get("key"), name: data.get("name"), description: data.get("description"),
          version: capability?.version,
          routes: routeDrafts.map((route) => {
            const prefix = `route-${route.draftKey}-`;
            return {
              ...(route.id ? { id: route.id } : {}), endpointId: data.get(`${prefix}endpointId`),
              modelName: data.get(`${prefix}modelName`), timeoutMs: Number(data.get(`${prefix}timeoutMs`)) * 1000,
              priority: Number(data.get(`${prefix}priority`)),
              enabled: data.get(`${prefix}enabled`) === "on", supportsVision: data.get(`${prefix}supportsVision`) === "on"
            };
          })
        })
      });
      await onSaved();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "保存失败";
      setError(message);
      notify(message, "error");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape" && !saving) onClose(); }}>
      <section className="modal capability-editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modal-heading">
          <div><p>编辑配置</p><h2 id="editor-title">{capability?.name ?? "能力"}</h2></div>
          <button onClick={onClose} disabled={saving} aria-label="关闭">×</button>
        </div>
        <form noValidate onSubmit={(event) => void submit(event)}>
          <fieldset className="capability-fields" disabled={saving}>
            <div className="editor-tabs" role="tablist" aria-label="能力配置" ref={tabsRef}>
              {TABS.map((label, index) => <button key={label} type="button" role="tab" id={`capability-tab-${index}`} aria-controls={`capability-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onClick={() => selectTab(index)} onKeyDown={(event) => {
                const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
                if (next !== null) { event.preventDefault(); selectTab(next); tabsRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }
              }}>{label}</button>)}
            </div>
            <div role="tabpanel" id="capability-panel-0" aria-labelledby="capability-tab-0" data-tab="0" hidden={tab !== 0}>
              {/* 已采用默认值的字段保持为空以显示 placeholder；单项清空即可恢复该项默认值。 */}
              <p className="field-hint capability-default-hint">留空时自动使用输入框中的默认值。</p>
              <Field name="name" label="名称" defaultValue={capability?.name === definition?.defaultName ? "" : capability?.name ?? ""} placeholder={definition?.defaultName} maxLength={80} required={!definition} />
              <Field name="key" label="工具名（能力标识）" defaultValue={capability?.key === definition?.defaultKey ? "" : capability?.key ?? ""} placeholder={definition?.defaultKey} pattern="\s*(?:[a-z][a-z0-9_\-]{1,63})?\s*" maxLength={64} required={!definition} />
              <p className="field-hint">Agent 按工具名调用。须以小写字母开头，支持小写字母、数字、下划线和短横线，长度 2–64。</p>
              <Field name="description" label="描述" defaultValue={capability?.description === definition?.defaultDescription ? "" : capability?.description ?? ""} placeholder={definition?.defaultDescription} maxLength={500} multiline required={!definition} />
              <p className="field-hint">这段描述用于告诉 Agent 什么时候调用该能力。</p>
            </div>
            <div role="tabpanel" id="capability-panel-1" aria-labelledby="capability-tab-1" data-tab="1" hidden={tab !== 1}>
              {definition ? <>
                <p className="field-hint">调用参数由能力固定提供。</p>
                <div className="table-wrap"><table className="param-table">
                  <thead><tr><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr></thead>
                  <tbody>{definition.parameters.map((parameter) => <tr key={parameter.name}><td><code>{parameter.name}</code></td><td>{parameter.type}</td><td>{parameter.required ? "是" : "否"}</td><td>{parameter.description}</td></tr>)}</tbody>
                </table></div>
              </> : <p className="field-hint">该能力暂无参数说明。</p>}
            </div>
            <div role="tabpanel" id="capability-panel-2" aria-labelledby="capability-tab-2" data-tab="2" hidden={tab !== 2}>
              <div className="route-toolbar"><p className="field-hint">此能力使用 Ollama。选择端点与模型，多条路由按优先级从小到大依次尝试。</p><button type="button" className="secondary" disabled={refreshingModels} onClick={() => void onRefreshModels()}>{refreshingModels ? "刷新中…" : "刷新模型列表"}</button></div>
              <p className="field-hint route-task">模型任务：{definition?.defaultPrompt ?? "暂无可用的能力定义"}</p>
              {availableEndpoints.length === 0 && <p className="form-error">请先在「外部能力」添加 Ollama 端点。</p>}
              {routeDrafts.length === 0 && <p className="field-hint">暂无路由。添加后选择模型即可使用外部能力。</p>}
              {/* 窄卡片并排展示，端点与模型占整行，短数值并排减少纵向滚动。 */}
              <div className="route-list">{routeDrafts.map((route, index) => {
                const prefix = `route-${route.draftKey}-`;
                // 模型选项来自所选端点的发现结果；保留当前配置供离线查看，不混入其他历史部署。
                const modelNames = [...new Set([...(discoveredModels ?? []).filter((model) => model.endpointId === route.endpointId).map((model) => model.modelName), ...(route.modelName ? [route.modelName] : [])])];
                return <section className="route-draft" key={route.draftKey}>
                  <div className="route-toolbar"><h3>Ollama 路由 {index + 1}</h3><button type="button" className="danger" onClick={() => { setRouteDrafts((items) => items.filter((item) => item.draftKey !== route.draftKey)); notify("路由已移除，保存配置后生效", "info"); }}>移除路由</button></div>
                  <SelectField name={`${prefix}endpointId`} label="Ollama 端点" value={route.endpointId} onChange={(event) => { const endpointId = event.target.value; setRouteDrafts((items) => items.map((item) => item.draftKey === route.draftKey ? { ...item, endpointId, modelName: "" } : item)); }} options={availableEndpoints.map((item) => ({ value: item.id, label: `${item.name}${item.enabled ? "" : "（停用）"}` }))} />
                  <SelectField name={`${prefix}modelName`} label="模型" value={route.modelName} onChange={(event) => { const modelName = event.target.value; setRouteDrafts((items) => items.map((item) => item.draftKey === route.draftKey ? { ...item, modelName } : item)); }} options={modelNames.map((name) => ({ value: name, label: name }))} />
                  {route.endpointId && modelNames.length === 0 && <p className="field-hint">该端点暂无可选模型，请刷新模型列表。</p>}
                  <div className="route-numbers"><Field name={`${prefix}timeoutMs`} label="超时（秒）" type="number" min="1" max="300" step="1" defaultValue={route.timeoutMs / 1000} required />
                  <Field name={`${prefix}priority`} label="优先级" type="number" min="0" max="10000" step="1" defaultValue={route.priority} required /></div>
                  <Check name={`${prefix}supportsVision`} label="已确认模型支持图片" defaultChecked={route.supportsVision} />
                  <Check name={`${prefix}enabled`} label="启用路由" defaultChecked={route.enabled} />
                </section>;
              })}</div>
              <button type="button" className="secondary" disabled={availableEndpoints.length === 0} onClick={() => setRouteDrafts((items) => [...items, { id: "", draftKey: crypto.randomUUID(), endpointId: "", modelName: "", timeoutMs: 60000, supportsVision: true, priority: 100, enabled: true }])}>＋ 新增路由</button>
            </div>
          </fieldset>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>取消</button><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存配置"}</button></div>
        </form>
      </section>
    </div>
  );
}
