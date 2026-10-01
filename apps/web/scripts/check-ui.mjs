// 先启动 web dev；使用已有 Playwright（可通过 NODE_PATH 指向运行时包目录），不增加项目依赖。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER ?? "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // 使用隔离的虚拟数据，验证反馈时不修改真实配置或访问真实凭据。
  await page.route("**/api/v1/**", async (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1);
    if (route.request().headers().authorization === "Bearer invalid") {
      await route.fulfill({ status: 401, json: {} });
      return;
    }
    if (resource === "endpoints" && route.request().method() === "POST") {
      await route.fulfill({ status: 422, json: { error: { message: "端点地址不可用" } } });
      return;
    }
    await route.fulfill({ json: resource === "settings"
      ? { maxImageBytes: 10485760, maxConcurrentRequests: 4, allowNetworkAccess: true, updatedAt: "2026-10-01T00:00:00Z" }
      : resource === "security" ? [{ kind: "mcp", token: "ui-test-placeholder", updatedAt: "2026-10-01T00:00:00Z" }]
      : [] });
  });
  await page.goto(process.env.UI_URL ?? "http://localhost:5173");
  await page.locator("#token").fill("invalid");
  await page.getByRole("button", { name: "进入控制台" }).click();
  await page.locator(".toast-error").first().waitFor();
  assert.match(await page.locator(".toast-error").first().innerText(), /访问令牌无效/);
  await page.getByRole("button", { name: "关闭提示" }).first().click();
  await page.locator("#token").fill("ui-test");
  await page.getByRole("button", { name: "进入控制台" }).click();
  const json = page.locator(".mcp-json");
  await json.waitFor();
  assert.equal(await page.locator(".mcp-code").isVisible(), false, "JSON 默认收起");
  await json.locator("summary").click();
  assert.equal(await page.locator(".mcp-code").isVisible(), true, "JSON 可展开");
  await page.getByRole("button", { name: "显示密钥", exact: true }).click();
  assert.match(await page.locator(".mcp-code").innerText(), /ui-test-placeholder/);
  await json.locator("summary").click();
  assert.equal(await page.locator(".mcp-code").isVisible(), false, "JSON 可收起");
  await json.locator("summary").click();
  assert.ok(!(await page.locator(".mcp-code").innerText()).includes("ui-test-placeholder"), "再次展开不会泄露密钥");
  await json.locator("summary").click();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.locator(".brand .signal-mark").click();
  await page.getByRole("heading", { name: "控制台", exact: true }).waitFor();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("link", { name: "Model Relay 控制台" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "控制台", exact: true }).waitFor();
  await page.getByRole("button", { name: "刷新状态" }).click();
  const toast = page.locator(".toast-success").first();
  await toast.waitFor();
  await toast.hover();
  const before = await toast.evaluate((element) => element.getAnimations()[0].currentTime);
  await page.waitForTimeout(6500);
  assert.equal(await toast.count(), 1, "悬停超过生命周期仍显示");
  assert.equal(await toast.evaluate((element) => getComputedStyle(element).animationPlayState), "paused");
  const after = await toast.evaluate((element) => element.getAnimations()[0].currentTime);
  assert.ok(Math.abs(after - before) < 80, "悬停保留剩余时间");
  await page.screenshot({ path: join(tmpdir(), "model-relay-toast.png") });
  await page.mouse.move(0, 0);
  await toast.waitFor({ state: "detached", timeout: 7000 });

  await page.getByRole("button", { name: "刷新状态" }).click();
  await toast.waitFor();
  await toast.getByRole("button", { name: "关闭提示" }).focus();
  assert.equal(await toast.evaluate((element) => getComputedStyle(element).animationPlayState), "paused");
  await toast.getByRole("button", { name: "关闭提示" }).click();
  await toast.waitFor({ state: "detached" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "刷新状态" }).click();
  await toast.waitFor();
  await page.mouse.move(0, 0);
  await toast.waitFor({ state: "detached", timeout: 7000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.screenshot({ path: join(tmpdir(), "model-relay-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "移动端没有横向溢出");
  await page.screenshot({ path: join(tmpdir(), "model-relay-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "320px 大字号布局没有横向溢出");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "外部能力" }).click();
  await page.getByRole("button", { name: "新增端点" }).click();
  await page.getByRole("textbox", { name: "端点名称" }).fill("测试端点");
  await page.getByRole("textbox", { name: "服务根地址" }).fill("http://localhost:11434");
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.locator(".toast-error").waitFor();
  assert.equal(await page.locator(".form-error").innerText(), "端点地址不可用");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "保存运行设置" }).click();
  await page.locator(".toast-success").waitFor();
  assert.match(await page.locator(".toast-success").innerText(), /运行设置已保存/);
  await page.getByRole("link", { name: "控制台", exact: true }).click();
  await page.getByRole("button", { name: "刷新状态" }).click();
  await page.locator(".toast-success").filter({ hasText: "状态已刷新" }).waitFor();
  assert.equal(await page.locator(".toast-success").count(), 2, "刷新不覆盖已有操作反馈");
  console.log("UI checks passed: brand mouse/keyboard navigation, JSON collapse and secret hiding, login/save feedback, hover pause/resume, mobile layout, reduced motion.");
} finally {
  await browser.close();
}
