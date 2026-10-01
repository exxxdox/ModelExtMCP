import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type NotificationTone = "success" | "error" | "info";
export type Notify = (message: string, tone?: NotificationTone) => void;
type Notice = { id: number; message: string; tone: NotificationTone };
const NotificationContext = createContext<Notify>(() => {});
const TITLES = { success: "操作成功", error: "操作失败", info: "提示" };
export const useNotify = (): Notify => useContext(NotificationContext);

/** 独立于页面和数据刷新，确保登录失败、弹窗操作和连续操作的反馈不会被切页覆盖。 */
export function Notifications({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  const notify = useCallback<Notify>((message, tone = "success") => {
    const id = ++nextId.current;
    setNotices((current) => [...current, { id, message, tone }]);
  }, []);
  const dismiss = (id: number): void => setNotices((current) => current.filter((notice) => notice.id !== id));

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <div className="toast-region" aria-label="操作反馈">
        {notices.map((notice) => (
          <div key={notice.id} className={`toast toast-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}
            onAnimationEnd={(event) => {
              // 进度条也有动画，只让浮层自己的生命周期结束移除提示。
              if (event.target === event.currentTarget && event.animationName === "toast-lifetime") dismiss(notice.id);
            }}>
            <span className="toast-icon" aria-hidden="true">{notice.tone === "success" ? "✓" : notice.tone === "error" ? "!" : "i"}</span>
            <div className="toast-content"><strong className="toast-title">{TITLES[notice.tone]}</strong><p>{notice.message}</p></div>
            <button className="toast-close" aria-label="关闭提示" onClick={() => dismiss(notice.id)}>×</button>
            <span className="toast-progress" aria-hidden="true" />
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
