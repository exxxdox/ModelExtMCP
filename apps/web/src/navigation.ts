/**
 * 页面拆分后的导航定义。
 * 用 hash 而不是引入路由依赖：hash 不触发服务端请求，单容器部署下后端
 * 只需回退到 index.html，刷新和分享链接都能落到同一页面。
 */
export type PageKey = "dashboard" | "ollama" | "capabilities" | "settings";

export type PageDefinition = {
  key: PageKey;
  /** 导航栏文案，同时也是页面标题。 */
  label: string;
};

// 页面副标题由各页面自己提供，导航仅保留实际读取的标识与文案。
export const PAGES: readonly PageDefinition[] = [
  { key: "dashboard", label: "控制台" },
  { key: "capabilities", label: "能力设置" },
  // 保留已有 hash，避免页面改名后用户保存的 Ollama 链接失效。
  { key: "ollama", label: "外部能力" },
  { key: "settings", label: "设置" }
];

const DEFAULT_PAGE: PageKey = "dashboard";

/** 从 `#/xxx` 形式的 hash 解析页面；未知或空值回退到控制台，避免白屏。 */
export function pageFromHash(hash: string): PageKey {
  const [segment] = hash.replace(/^#/, "").replace(/^\//, "").split("/");
  const match = PAGES.find((page) => page.key === segment);
  return match?.key ?? DEFAULT_PAGE;
}

export function hashForPage(key: PageKey): string {
  return `#/${key}`;
}
