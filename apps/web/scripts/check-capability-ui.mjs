// 与 check-ui 共用运行方式；全部使用虚拟 API，避免修改用户的模型配置。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER ?? "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // 模拟真实请求延迟，检查 hover、按下、保存中与完成后的尺寸和坐标。
  async function checkSwitchStable(locator) {
    await page.mouse.move(0, 0);
    const before = await locator.boundingBox();
    const stable = async () => {
      const current = await locator.boundingBox();
      for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(current[key] - before[key]) < 1, `开关 ${key} 在点击期间保持稳定`);
    };
    await locator.hover();
    await page.waitForTimeout(220);
    await stable();
    await locator.click();
    assert.equal(await locator.getAttribute("aria-busy"), "true");
    await stable();
    await page.waitForFunction(() => !document.querySelector('.capability-switch[aria-busy="true"]'));
    await stable();
    const alignment = await locator.evaluate((element) => {
      const cell = element.closest("td");
      const header = cell.closest("table").querySelectorAll("th")[cell.cellIndex];
      return [element.getBoundingClientRect().x, header.getBoundingClientRect().x + parseFloat(getComputedStyle(header).paddingLeft)];
    });
    assert.ok(Math.abs(alignment[0] - alignment[1]) < 1, "开关与状态标题左对齐");
  }
  let saved;
  let failSave = true;
  let failToggle = false;
  let toggled;
  let endpointSaved;
  let failEndpointToggle = false;
  const endpoint = { id: "endpoint", name: "测试 Ollama", baseUrl: "http://ollama:11434", enabled: true };
  const capability = { id: "cap", name: "图像理解", key: "image_describe", description: "原描述", enabled: true, version: 1, definition: { externalProvider: "ollama", defaultPrompt: "描述图片并回答图片相关问题。", defaultKey: "image_describe", defaultName: "默认名称", defaultDescription: "默认描述".repeat(35), parameters: [{ name: "imageBase64", type: "string", required: true, description: "图片内容" }] } };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/endpoints/endpoint/enabled")) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body), ["enabled"]);
      if (failEndpointToggle) await route.fulfill({ status: 400, json: { error: { message: "端点开关保存失败" } } });
      else { endpoint.enabled = body.enabled; await route.fulfill({ json: endpoint }); }
      return;
    }
    if (path.endsWith("/endpoints/endpoint") && route.request().method() === "PUT") {
      endpointSaved = route.request().postDataJSON();
      Object.assign(endpoint, endpointSaved);
      await route.fulfill({ json: endpoint });
      return;
    }
    if (path.endsWith("/enabled")) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      toggled = route.request().postDataJSON();
      if (failToggle) await route.fulfill({ status: 409, json: { error: { message: "能力开关保存失败" } } });
      else { capability.enabled = toggled.enabled; capability.version += 1; await route.fulfill({ json: capability }); }
      return;
    }
    if (path.endsWith("/configuration")) {
      saved = route.request().postDataJSON();
      await route.fulfill(failSave ? { status: 409, json: { error: { message: "配置已被修改，请重新加载" } } } : { json: capability });
      return;
    }
    const resource = path.split("/").at(-1);
    const data = {
      capabilities: [capability], endpoints: [endpoint, { id: "second", name: "另一个 Ollama", baseUrl: "http://second:11434", enabled: true }],
      deployments: [{ id: "deployment", endpointId: "endpoint", modelName: "vision:old", timeoutMs: 60000, supportsVision: true, enabled: true }],
      routes: [{ id: "route", capabilityId: "cap", deploymentId: "deployment", priority: 100, promptTemplate: "原提示词", enabled: true }],
      test: { ok: true, models: [route.request().postDataJSON()?.baseUrl === "http://second:11434" ? "other:model" : "vision:new"] },
      settings: { maxImageBytes: 10485760, maxConcurrentRequests: 4, allowNetworkAccess: true }, security: []
    };
    await route.fulfill({ json: data[resource] ?? [] });
  });
  await page.goto(process.env.UI_URL ?? "http://localhost:5173");
  await page.locator("#token").fill("ui-test");
  await page.getByRole("button", { name: "进入控制台" }).click();
  assert.deepEqual(await page.locator(".page-nav a").allTextContents(), ["控制台", "能力设置", "外部能力", "设置"]);
  await page.getByRole("link", { name: "外部能力", exact: true }).click();
  assert.equal(await page.getByRole("heading", { name: "模型部署", exact: true }).count(), 0);
  const endpointSwitch = page.getByRole("switch", { name: "启用测试 Ollama" });
  assert.equal(await endpointSwitch.evaluate((element) => getComputedStyle(element).borderWidth), "0px");
  await checkSwitchStable(endpointSwitch);
  await page.locator('.capability-switch[aria-checked="false"]').waitFor();
  failEndpointToggle = true;
  await endpointSwitch.click();
  await page.locator(".toast-error").filter({ hasText: "端点开关保存失败" }).waitFor();
  assert.equal(await endpointSwitch.getAttribute("aria-checked"), "false");
  failEndpointToggle = false;
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  assert.equal(await page.getByRole("checkbox", { name: "立即启用" }).count(), 0);
  await page.getByRole("textbox", { name: "端点名称" }).fill("测试 Ollama");
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal("enabled" in endpointSaved, false, "端点编辑不覆盖列表开关");
  assert.equal(await endpointSwitch.getAttribute("aria-checked"), "false");
  await endpointSwitch.click();
  await page.locator('.capability-switch[aria-checked="true"]').first().waitFor();
  await page.getByRole("link", { name: "能力设置", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "新增路由" }).count(), 0);
  const capabilitySwitch = page.getByRole("switch", { name: "启用图像理解" });
  assert.equal(await capabilitySwitch.getAttribute("aria-checked"), "true");
  assert.equal(await capabilitySwitch.evaluate((element) => getComputedStyle(element).borderWidth), "0px");
  await checkSwitchStable(capabilitySwitch);
  await page.locator('.capability-switch[aria-checked="false"]').waitFor();
  assert.deepEqual(Object.keys(toggled).sort(), ["enabled", "version"]);
  failToggle = true;
  await capabilitySwitch.click();
  await page.locator(".toast-error").filter({ hasText: "能力开关保存失败" }).waitFor();
  assert.equal(await capabilitySwitch.getAttribute("aria-checked"), "false", "失败不改变开关状态");
  failToggle = false;
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "启用能力" }).count(), 0);
  assert.deepEqual(await page.getByRole("tab").allTextContents(), ["编辑", "参数说明", "外部能力路由"]);
  assert.equal(await page.getByRole("tab", { name: "默认值" }).count(), 0);
  const nameField = page.getByRole("textbox", { name: "名称", exact: true });
  const keyField = page.getByRole("textbox", { name: "工具名（能力标识）", exact: true });
  const descriptionField = page.getByRole("textbox", { name: "描述", exact: true });
  assert.equal(await keyField.inputValue(), "", "已采用默认值的字段显示 placeholder");
  assert.equal(await keyField.getAttribute("placeholder"), capability.definition.defaultKey);
  assert.equal(await descriptionField.getAttribute("placeholder"), capability.definition.defaultDescription);
  assert.equal(await nameField.inputValue(), capability.name, "自定义值继续显示");
  await keyField.fill("bad.name");
  assert.equal(await keyField.evaluate((element) => element.checkValidity()), false, "非空非法工具名仍被校验");
  await keyField.fill(" image-analyze ");
  assert.equal(await keyField.evaluate((element) => element.checkValidity()), true);
  await keyField.fill("");
  await descriptionField.fill("编辑后描述");
  await page.getByRole("tab", { name: "参数说明" }).click();
  assert.match(await page.getByRole("tabpanel").innerText(), /imageBase64/);
  await page.getByRole("tab", { name: "参数说明" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "外部能力路由" }).getAttribute("aria-selected"), "true");
  await page.locator('select option[value="vision:new"]').waitFor({ state: "attached" });
  const endpointSelect = page.getByRole("combobox", { name: "Ollama 端点", exact: true });
  const modelSelect = page.getByRole("combobox", { name: "模型", exact: true });
  await modelSelect.selectOption("vision:new");
  await endpointSelect.selectOption("second");
  assert.equal(await modelSelect.inputValue(), "", "切换端点清空模型，防止误用前一端点的模型");
  assert.deepEqual(await modelSelect.locator("option").allTextContents(), ["请选择", "other:model"]);
  await endpointSelect.selectOption("endpoint");
  await modelSelect.selectOption("vision:new");
  await page.getByRole("tab", { name: "编辑", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "描述", exact: true }).inputValue(), "编辑后描述");
  await page.getByRole("tab", { name: "外部能力路由" }).click();
  await page.getByRole("button", { name: "新增路由" }).click();
  const cards = page.locator(".route-draft");
  const firstCard = await cards.first().boundingBox();
  const secondCard = await cards.last().boundingBox();
  assert.ok(Math.abs(firstCard.y - secondCard.y) < 1 && secondCard.x > firstCard.x + firstCard.width, "桌面路由卡片分两列");
  await page.getByRole("tab", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "保存配置" }).click();
  assert.equal(await page.getByRole("tab", { name: "外部能力路由" }).getAttribute("aria-selected"), "true", "隐藏字段失败时切换到对应页签");
  assert.equal(saved, undefined, "无效路由不能提交");
  await page.getByRole("button", { name: "移除路由" }).last().click();
  await page.getByRole("tab", { name: "编辑", exact: true }).click();
  await nameField.fill("");
  await keyField.fill("   ");
  await descriptionField.fill("");
  assert.ok(await keyField.evaluate((element) => element.checkValidity()), "纯空白工具名允许服务端回退默认值");
  await page.setViewportSize({ width: 320, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "默认值合并后窄屏无横向溢出");
  await page.screenshot({ path: join(tmpdir(), "model-relay-defaults.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.locator(".form-error").waitFor();
  assert.equal(saved.name, "");
  assert.equal(saved.key, "   ");
  assert.equal(saved.description, "", "空字段提交给服务端回退默认值");
  assert.equal("enabled" in saved, false, "能力编辑不覆盖列表开关");
  assert.equal("promptTemplate" in saved.routes[0], false, "提示词由代码定义");
  assert.equal(saved.routes[0].modelName, "vision:new", "清空编辑字段不会丢失路由草稿");
  assert.equal(saved.routes[0].id, "route");
  assert.equal(saved.routes[0].timeoutMs, 60000);
  assert.match(await page.locator(".form-error").innerText(), /重新加载/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "外部能力路由" }).click();
  assert.equal(await page.getByRole("textbox", { name: "默认提示词" }).count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "移动端无横向溢出");
  await page.screenshot({ path: join(tmpdir(), "model-relay-capability-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(tmpdir(), "model-relay-capability.png"), fullPage: true });
  failSave = false;
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.locator(".toast-success").filter({ hasText: "配置已保存" }).waitFor();
  console.log("Capability UI checks passed: model dropdown and endpoint isolation, stable aligned capability/endpoint switches, compact route cards, fixed task payload, default placeholders and empty fields, three tabs, feedback, mobile.");
} finally { await browser.close(); }
