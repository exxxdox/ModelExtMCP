import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Editor } from "./components/Editor";
import { useAdminData } from "./hooks/useAdminData";
import { hashForPage, pageFromHash, PAGES, type PageKey } from "./navigation";
import { CapabilitiesPage } from "./pages/CapabilitiesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OllamaPage } from "./pages/OllamaPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { EditorState, ResourceName } from "./types";

/**
 * 应用外壳：负责登录、导航与共享数据，页面本身只渲染自己那部分。
 * 用 hash 保存当前页面，刷新或直接粘贴链接都能回到同一页。
 */
export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("adminToken") ?? "");
  const [draftToken, setDraftToken] = useState("");
  const [page, setPage] = useState<PageKey>(() => pageFromHash(window.location.hash));
  const [editor, setEditor] = useState<EditorState>(null);

  useEffect(() => {
    const syncFromHash = (): void => setPage(pageFromHash(window.location.hash));
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const navigate = useCallback((next: PageKey): void => {
    window.location.hash = hashForPage(next);
    // 同时写入状态：不依赖 hashchange 事件的触发时机，点击后立即切页。
    setPage(next);
  }, []);

  const handleUnauthorized = useCallback((): void => {
    sessionStorage.removeItem("adminToken");
    setToken("");
  }, []);

  const handleAdminTokenRotated = useCallback((next: string): void => setToken(next), []);

  const data = useAdminData(token, handleUnauthorized, handleAdminTokenRotated);

  const openEditor = useCallback((resource: ResourceName, id?: string): void => {
    setEditor({ resource, id });
  }, []);

  function signIn(event: FormEvent): void {
    event.preventDefault();
    const next = draftToken.trim();
    if (!next) return;
    sessionStorage.setItem("adminToken", next);
    setToken(next);
  }

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="signal-mark" aria-hidden="true"><span /><span /><span /></div>
          <p className="product-name">Model Relay</p>
          <h1>连接看不见图片的 Agent</h1>
          <p className="lede">配置 Ollama 视觉模型，并把图像理解能力通过 MCP 安全地提供给 Agent。当前令牌可在容器启动日志中找到。</p>
          <form onSubmit={signIn}>
            <label htmlFor="token">管理员令牌</label>
            <div className="login-row">
              <input id="token" type="password" value={draftToken} onChange={(event) => setDraftToken(event.target.value)} autoFocus />
              <button type="submit">进入控制台</button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="signal-mark small"><span /><span /><span /></div><strong>Model Relay</strong></div>
        <nav className="page-nav" aria-label="管理页面">
          {PAGES.map((item) => (
            <a
              key={item.key}
              href={hashForPage(item.key)}
              className={item.key === page ? "active" : undefined}
              aria-current={item.key === page ? "page" : undefined}
              onClick={(event) => { event.preventDefault(); navigate(item.key); }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="top-actions">
          <span className={data.activeRouteCount > 0 ? "health ready" : "health"}>{data.activeRouteCount > 0 ? `${data.activeRouteCount} 条路由可用` : "等待配置路由"}</span>
          <button className="text-button" onClick={handleUnauthorized}>退出</button>
        </div>
      </header>

      <main className="workspace">
        {data.message && <div className="notice" role="status">{data.message}<button onClick={() => data.setMessage(null)} aria-label="关闭">×</button></div>}

        {page === "dashboard" && <DashboardPage data={data} onNavigate={navigate} />}
        {page === "ollama" && <OllamaPage data={data} onOpenEditor={openEditor} />}
        {page === "capabilities" && <CapabilitiesPage data={data} onOpenEditor={openEditor} />}
        {page === "settings" && <SettingsPage data={data} />}
      </main>

      {editor && (
        <Editor
          editor={editor}
          capabilities={data.capabilities}
          endpoints={data.endpoints}
          deployments={data.deployments}
          routes={data.routes}
          api={data.api}
          onClose={() => setEditor(null)}
          onSaved={async () => { setEditor(null); data.setMessage("配置已保存"); await data.refresh(); }}
        />
      )}
    </div>
  );
}
