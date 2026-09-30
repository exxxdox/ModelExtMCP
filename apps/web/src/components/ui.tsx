import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** 各页面共用的展示组件：页面头、区块头、状态与表单控件。 */

export type PageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export type SectionHeaderProps = {
  title: string;
  description: string;
  action?: string;
  onAdd?: () => void;
  secondaryAction?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
};

export function SectionHeader({ title, description, action, onAdd, secondaryAction, onSecondary, secondaryDisabled }: SectionHeaderProps) {
  return (
    <div className="section-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
      <div className="section-actions">
        {secondaryAction && onSecondary && <button className="secondary" onClick={onSecondary} disabled={secondaryDisabled}>{secondaryAction}</button>}
        {action && onAdd && <button className="secondary" onClick={onAdd}>＋ {action}</button>}
      </div>
    </div>
  );
}

export function Status({ enabled }: { enabled: boolean }) {
  return <span className={enabled ? "status on" : "status"}><b />{enabled ? "启用" : "停用"}</span>;
}

export function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return <div className="row-actions"><button onClick={onEdit}>编辑</button><button className="danger" onClick={onDelete}>删除</button></div>;
}

export function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <tr><td colSpan={columns} className="empty">{text}</td></tr>;
}

export function Field({ label, multiline, ...props }: { label: string; multiline?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline
        ? <textarea name={props.name} defaultValue={String(props.defaultValue ?? "")} required={props.required} />
        : <input {...props} />}
    </label>
  );
}

export function SelectField({ label, options, ...props }: { label: string; options: Array<{ value: string; label: string }> } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <select {...props} required>
        <option value="">请选择</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function Check({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="check"><input {...props} type="checkbox" /><span>{label}</span></label>;
}
