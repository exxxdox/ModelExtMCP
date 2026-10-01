import { Fragment, useState, type FormEvent } from "react";
import { defaultCapabilityDraft, isUsingCodeDefaults, type CapabilityDraft } from "../capability-defaults";
import type { AdminApi, Capability, Deployment, EditorState, Endpoint, ResourceName, Route } from "../types";
import { Check, Field, SelectField } from "./ui";
import { useNotify } from "./Notifications";

const DEFAULT_PROMPT = "请准确描述图片内容，并回答调用者关于图片的问题。";

const EDITOR_TITLES: Record<ResourceName, string> = {
  capabilities: "能力",
  endpoints: "Ollama 端点",
  deployments: "模型部署",
  routes: "能力路由"
};

export type EditorProps = {
  editor: Exclude<EditorState, null>;
  capabilities: Capability[];
  endpoints: Endpoint[];
  deployments: Deployment[];
  routes: Route[];
  api: AdminApi;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

export type CapabilityContractProps = {
  capability: Capability | undefined;
  /** 只在编辑已有能力时给出：新增配置没有可回退的基线。 */
  onRestoreDefaults?: () => void;
  /** 依据库里的当前值判断，不反映表单里还没保存的改动——所以它只用于提示，不用于禁用按钮。 */
  isCustomized?: boolean;
};

/** 能力只读定义：由服务端代码提供，管理端只能看，用来解释这个能力怎么被调用，并提供代码基线。 */
function CapabilityContract({ capability, onRestoreDefaults, isCustomized }: CapabilityContractProps) {
  const definition = capability?.definition;
  if (!definition) return null;

  return (
    <section className="contract">
      <h3>不可编辑的调用说明</h3>
      <dl className="contract-facts">
        <div><dt>执行器</dt><dd><code>{definition.executorType}</code></dd></div>
        <div><dt>代码定义标识</dt><dd><code>{definition.definitionKey}</code></dd></div>
      </dl>
      <p className="contract-note">能力由服务端代码实现，参数与执行方式固定，只能在上面修改 Agent 看到的名称、标识与说明。</p>
      <div className="contract-defaults">
        <div className="contract-defaults-head">
          <h4>代码默认值</h4>
          {onRestoreDefaults && (
            // 不禁用：表单是不受控输入，这里读不到它的实时值；一旦按旧值禁用，改过之后再想恢复就点不动了。
            <button type="button" className="secondary" onClick={onRestoreDefaults}>恢复默认值</button>
          )}
        </div>
        <dl className="contract-facts">
          <div><dt>名称</dt><dd>{definition.defaultName}</dd></div>
          <div><dt>标识</dt><dd><code>{definition.defaultKey}</code></dd></div>
          <div><dt>Agent 可见说明</dt><dd>{definition.defaultDescription}</dd></div>
        </dl>
        {isCustomized && <p className="contract-note">已保存的值与上面的默认值不同。</p>}
        <p className="contract-note">恢复只把默认值填回上面的表单，仍需点「保存配置」才会写入。</p>
      </div>
      <table className="param-table">
        <thead><tr><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr></thead>
        <tbody>
          {definition.parameters.map((parameter) => (
            <tr key={parameter.name}>
              <td className="strong"><code>{parameter.name}</code></td>
              <td><code>{parameter.type}</code></td>
              <td>{parameter.required ? "是" : "否"}</td>
              <td>{parameter.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 新增/编辑四类资源的共用一个弹窗；字段差异由 resource 决定。 */
export function Editor({ editor, capabilities, endpoints, deployments, routes, api, onClose, onSaved }: EditorProps) {
  const notify = useNotify();
  const existing = [...capabilities, ...endpoints, ...deployments, ...routes].find((item) => item.id === editor.id) as Record<string, unknown> | undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 恢复默认后的草稿：Field 是不受控输入，只有重挂载才会显示新值，所以先存一份再换 key。
  const [capabilityDraft, setCapabilityDraft] = useState<CapabilityDraft | undefined>(undefined);
  const [draftRevision, setDraftRevision] = useState(0);

  const capability = capabilities.find((item) => item.id === editor.id);
  const capabilityDefinition = capability?.definition ?? null;
  const isCustomized = capability !== undefined
    && capabilityDefinition !== null
    && !isUsingCodeDefaults(capability, capabilityDefinition);

  function restoreCapabilityDefaults(): void {
    if (!capabilityDefinition) return;
    setCapabilityDraft(defaultCapabilityDraft(capabilityDefinition));
    setDraftRevision((revision) => revision + 1);
    notify("已恢复默认值，保存配置后生效", "info");
  }

  function buildBody(data: FormData): Record<string, unknown> {
    if (editor.resource === "capabilities") {
      return {
        key: data.get("key"),
        name: data.get("name"),
        description: data.get("description"),
        enabled: data.get("enabled") === "on",
        ...(existing?.version ? { version: existing.version } : {})
      };
    }
    if (editor.resource === "endpoints") {
      return { name: data.get("name"), baseUrl: data.get("baseUrl"), enabled: data.get("enabled") === "on" };
    }
    if (editor.resource === "deployments") {
      return {
        endpointId: data.get("endpointId"),
        modelName: data.get("modelName"),
        supportsVision: data.get("supportsVision") === "on",
        timeoutMs: Number(data.get("timeoutMs")) * 1000,
        enabled: data.get("enabled") === "on"
      };
    }
    return {
      capabilityId: data.get("capabilityId"),
      deploymentId: data.get("deploymentId"),
      priority: Number(data.get("priority")),
      promptTemplate: data.get("promptTemplate"),
      enabled: data.get("enabled") === "on"
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const body = buildBody(new FormData(event.currentTarget));
    setSaving(true);
    setError(null);
    try {
      await api(`${editor.resource}${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PUT" : "POST", body: JSON.stringify(body) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      // 错误保留在表单，浮层消失后仍能对照修改输入。
      notify(caught instanceof Error ? caught.message : "保存失败", "error");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={editor.resource === "capabilities" ? "modal capability-editor" : "modal"} role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modal-heading">
          <div><p>{editor.id ? "编辑配置" : "新增配置"}</p><h2 id="editor-title">{EDITOR_TITLES[editor.resource]}</h2></div>
          <button onClick={onClose} aria-label="关闭">×</button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          {editor.resource === "capabilities" && <Fragment key={draftRevision}>
            <Field name="name" label="名称" defaultValue={capabilityDraft?.name ?? String(existing?.name ?? "")} required />
            <Field name="key" label="工具名（能力标识）" defaultValue={capabilityDraft?.key ?? String(existing?.key ?? "")} placeholder="image_describe" required />
            <p className="field-hint">一个能力就是一个 MCP 工具，这个名字就是工具名，Agent 按名字调用；改名后仍按旧名字调用的 Agent 会失败。只能用英文小写字母、数字、下划线和短横线。</p>
            <Field name="description" label="Agent 可见说明" defaultValue={capabilityDraft?.description ?? String(existing?.description ?? "")} multiline required />
            <p className="field-hint">这段文字就是 MCP 工具描述的全部内容，Agent 只靠它判断什么时候该调用这个工具，请写清「什么时候用它」。</p>
            <CapabilityContract capability={capability} onRestoreDefaults={capabilityDefinition ? restoreCapabilityDefaults : undefined} isCustomized={isCustomized} />
          </Fragment>}
          {editor.resource === "endpoints" && <>
            <Field name="name" label="端点名称" defaultValue={String(existing?.name ?? "")} placeholder="本机 Ollama" required />
            <Field name="baseUrl" label="服务根地址" defaultValue={String(existing?.baseUrl ?? "")} placeholder="http://host.docker.internal:11434" required />
          </>}
          {editor.resource === "deployments" && <>
            <SelectField name="endpointId" label="Ollama 端点" defaultValue={String(existing?.endpointId ?? "")} options={endpoints.map((item) => ({ value: item.id, label: item.name }))} />
            <Field name="modelName" label="模型名称" defaultValue={String(existing?.modelName ?? "")} placeholder="qwen2.5vl:7b" required />
            <Field name="timeoutMs" label="超时（秒）" type="number" defaultValue={String(Number(existing?.timeoutMs ?? 60_000) / 1000)} required />
            <Check name="supportsVision" label="已确认支持图片" defaultChecked={existing ? Boolean(existing.supportsVision) : true} />
          </>}
          {editor.resource === "routes" && <>
            <SelectField name="capabilityId" label="能力" defaultValue={String(existing?.capabilityId ?? "")} options={capabilities.map((item) => ({ value: item.id, label: item.name }))} />
            <SelectField name="deploymentId" label="模型部署" defaultValue={String(existing?.deploymentId ?? "")} options={deployments.map((item) => ({ value: item.id, label: item.modelName }))} />
            <Field name="priority" label="优先级" type="number" defaultValue={String(existing?.priority ?? 100)} required />
            <Field name="promptTemplate" label="默认提示词" defaultValue={String(existing?.promptTemplate ?? DEFAULT_PROMPT)} multiline required />
            <p className="field-hint">路由只管这一步模型调用：选模型、定超时、给默认提示词。调用者自己带了 prompt 时以 prompt 为准，只有没带时才用这里的默认提示词。</p>
          </>}
          <Check name="enabled" label="立即启用" defaultChecked={existing ? Boolean(existing.enabled) : true} />
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>取消</button>
            <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存配置"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
