import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, rmdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const root = resolve(import.meta.dirname, ".."), dpi = Number(process.argv.find(a => a.startsWith("--dpi="))?.slice(6) || 1);
const executable = process.argv.find(a => a.startsWith("--exe="))?.slice(6);
const { buildProductionSymbolPlan, transformCode } = createRequire(import.meta.url)("./production-symbol-compaction.cjs");
const symbolPlan = executable ? buildProductionSymbolPlan(root) : null;
const evaluateRuntime = (target, expression, ...options) => evaluateRaw(target, symbolPlan && target !== independent ? transformCode(expression, symbolPlan, "layout-ui.js") : expression, ...options);
const runDir = join(root, ".diagnostics", `workspace-layout-config-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project"), settingsPath = join(config, "app-settings.json");
for (const dir of [config, project]) mkdirSync(dir, { recursive: true });
const report = { ok: false, dpi, electronStarts: 0, realModelRequests: 0, modelPosts: 0, catalogGets: 0, checks: [], layouts: [], screenshots: [] };
const server = createServer((req, res) => {
  if (req.method === "POST" && req.url.includes("/images/")) report.modelPosts++;
  if (req.url === "/v1/models") report.catalogGets++;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(req.url === "/v1/models" ? { data: ["gpt-image-2", "grok-imagine-image-2.0", "gemini-3.1-flash-image"].map(id => ({ id })) } : { success: true, data: { id: 1, username: "fixture", quota: 1000000, items: [] } }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
writeFileSync(settingsPath, JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-key", accountBaseUrl: `http://127.0.0.1:${server.address().port}`, relayBaseUrl: `http://127.0.0.1:${server.address().port}`, imageBaseUrl: `http://127.0.0.1:${server.address().port}`, imageApiKey: "local-fixture-key", imageModel: "grok-imagine-image-2.0", imageModelPool: ["grok-imagine-image-2.0", "gpt-image-2"], agentModel: "gpt-6.1-sol", imageConnectionVersion: 1, imageRatio: "1:1", imageResolution: "1K", imageQuality: "auto", glassTheme: "light-classic", agentPanelWidth: 650, glassReducedMotion: true }));
writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [], messages: [], selectedNodeIds: [] }));
writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "P", projects: [{ id: "P", name: "布局配置验收 · 很长的项目标题仍应完整可达", path: project, sessionPath: join(project, "session.json"), external: true }] }));
const shim = join(runDir, "local-shim.cjs"); writeFileSync(shim, "// Isolated UI fixture never starts Extension or installs dependencies.\n");
let vite, electron, client, independent, devUrl = "", debugPort;
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => waitForRuntimeExpression(client, expression, { evaluate: evaluateRuntime, timeoutMs: 12000 });
async function check(name, fn) { assert.ok(await fn(), name); report.checks.push(name); }
async function point(selector) { return ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); }
async function click(selector) { const p = await point(selector); assert.ok(p, selector); for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 }); await delay(80); }
async function clickText(selector, text) { const p = await ev(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); assert.ok(p, text); for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 }); await delay(100); }
async function key(key, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await client.send("Input.dispatchKeyEvent", { type, key, code: key, modifiers, ...(key === "Enter" ? { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) } : {}) }); await delay(100); }
async function text(selector, value) { await click(selector); await key("a", 2); await client.send("Input.insertText", { text: value }); await delay(100); }
async function shot(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`)); report.screenshots.push(`${name}.png`); }
async function choose(label, value) { await click(`button[aria-label="${label}"]`); await click(`[role="option"][data-glass-select-value="${value}"]`); await wait(`document.querySelector('.project-agent-image-config-body')?.textContent.includes('已保存')`); }
async function start() {
  debugPort = await allocateDebugPort();
  const args = ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", `--remote-debugging-port=${debugPort}`, `--force-device-scale-factor=${dpi}`, `--user-data-dir=${join(runDir, "user-data")}`];
  electron = spawn(executable || process.execPath, executable ? args : [join(root, "node_modules/electron/cli.js"), ...args, "electron-main.cjs"], { cwd: executable ? dirname(executable) : root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: shim } });
  report.electronStarts++;
  const target = await pollForDebugTarget({ port: debugPort, attempts: 180, intervalMs: 100, findTarget: targets => targets.find(t => t.type === "page" && !t.url.includes("agent-window")) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable"); await client.send("Page.bringToFront");
  await wait("Boolean(document.querySelector('.project-agent-composer textarea') && document.querySelector('.canvas-all-tools-trigger'))"); await delay(300);
}
async function stop() {
  await client.send("Runtime.evaluate", { expression: "void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),100)", awaitPromise: false });
  client.close(); client = null;
  if (electron.exitCode === null) await Promise.race([new Promise(resolve => electron.once("exit", resolve)), delay(10000)]);
  assert.notEqual(electron.exitCode, null, "isolated app closes normally and flushes settings");
}
try {
  if (!executable) {
    const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
    vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
    await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  }
  await start();
  for (const [width, height] of [[884,640],[1280,820],[1920,1080],[884,640],[1920,1080]]) {
    const resized = await ev(`window.naimageConfig.debugWindowBounds({width:${width},height:${height}})`); assert.equal(resized.ok, true);
    await wait(`Math.abs(document.querySelector('.project-agent-panel').getBoundingClientRect().width-${width === 884 ? 348 : 650})<2`); await delay(150);
    const layout = await ev(`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return{viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:box('.canvas-panel'),agent:box('.project-agent-panel'),input:box('.project-agent-composer textarea'),tools:box('.canvas-plugin-toolbar'),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    report.layouts.push(layout);
    assert.ok(layout.canvas.width >= 460, `minimum canvas width: ${JSON.stringify(layout)}`);
    assert.ok(layout.input.width > 160 && layout.input.right <= layout.agent.right + 1 && layout.input.bottom <= height + 1);
    assert.ok(layout.tools.x >= layout.canvas.x && layout.tools.right <= layout.canvas.right + 1 && !layout.overflow);
    assert.ok(Math.abs(layout.agent.width - (width === 884 ? 348 : 650)) <= 2, "temporary clamp restores preferred width");
    if (report.layouts.length <= 3) await shot(`layout-${width}`);
  }
  report.checks.push("884/1280/1920 actual window bounds, canvas/input/tools hit area, shrink restores 650px preference");
  await click('.canvas-all-tools-trigger'); await wait("document.activeElement?.getAttribute('aria-label')==='搜索画布工具'");
  const toolCount = await ev("document.querySelectorAll('.canvas-tools-menu [role=menuitem]').length"); assert.ok(toolCount >= 10);
  await text('[aria-label="搜索画布工具"]', "模板");
  await check("search filters existing commands", () => ev(`document.querySelectorAll('.canvas-tools-menu [role=menuitem]').length > 0 && document.querySelectorAll('.canvas-tools-menu [role=menuitem]').length < ${toolCount}`));
  await check("searched command labels retain a readable hit area beside shortcuts",()=>ev(`Array.from(document.querySelectorAll('.canvas-tools-menu .ui-menu-item-label')).every(e=>e.textContent.trim()&&e.getBoundingClientRect().width>=60)`));
  await shot("tools-search");
  const viewportBefore = await ev("document.querySelector('.canvas-stage').style.transform"), searchPoint = await point('.canvas-tools-search');
  await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...searchPoint, deltaX: 0, deltaY: 230 }); await delay(200);
  assert.equal(await ev("document.querySelector('.canvas-stage').style.transform"), viewportBefore, "menu wheel does not move canvas");
  await key("ArrowDown"); await check("search ArrowDown reaches an enabled command", () => ev("document.activeElement?.getAttribute('role')==='menuitem'"));
  await key("End"); await check("menu keyboard last item stays inside scroll area", () => ev("(()=>{const r=document.activeElement.getBoundingClientRect(),m=document.querySelector('.canvas-tools-menu').getBoundingClientRect();return r.top>=m.top&&r.bottom<=m.bottom+1})()"));
  await key("Escape"); await wait("!document.querySelector('.canvas-tools-menu')");
  assert.equal(await ev("document.activeElement?.classList.contains('canvas-all-tools-trigger')"), true);
  await click('.canvas-all-tools-trigger'); await text('[aria-label="搜索画布工具"]', "sparkai.social-content.open-templates"); await key("ArrowDown"); await key("Enter"); await delay(200);
  await check("tool uses existing registry and records recent command", () => ev(`Array.from(document.querySelectorAll('.workspace-asset-rail nav button[aria-pressed="true"]')).some(e=>e.textContent.includes('模板'))`)); await key("Escape"); await delay(150);
  assert.ok(JSON.parse(readFileSync(settingsPath, "utf8")).recentCanvasToolCommands.includes("sparkai.social-content.open-templates"));
  await click('.canvas-all-tools-trigger'); await check("recent command visible", () => ev("document.querySelector('.canvas-tools-menu')?.textContent.includes('最近使用')")); await key("Escape");
  const beforeCatalog = report.catalogGets;
  await click('.project-agent-config-trigger'); await wait("Boolean(document.querySelector('.project-agent-image-config'))"); await delay(250);
  assert.equal(report.catalogGets, beforeCatalog, "opening image config is offline/cache only");
  await check("manual default differs explicitly from Agent Image2 policy", () => ev("document.querySelector('.project-agent-image-config-summary')?.textContent.includes('手动默认 grok-imagine-image-2.0 · Agent 自动选择 gpt-image-2')"));
  await click('button[aria-label="生图质量"]');
  assert.equal(await ev("Boolean(document.querySelector('[data-glass-select-value=high]'))"), false, "pool intersection excludes unsupported quality"); await key("Escape");
  await choose("每批图片数量", "3"); await choose("默认生图比例", "3:2");
  // An empty directory at the atomic temp-file path causes a real owner write failure.
  const blockedPath = `${settingsPath}.tmp`; mkdirSync(blockedPath);
  await click('button[aria-label="每批图片数量"]'); await click('[data-glass-select-value="4"]');
  await wait("document.querySelector('.project-agent-image-config-body')?.textContent.includes('保存失败')");
  await click('.project-agent-image-config footer button'); await key("Escape");
  await check("failed autosave cannot silently close", () => ev("Boolean(document.querySelector('.project-agent-image-config')) && document.querySelector('.project-agent-image-config-body').textContent.includes('重试保存')")); await shot("save-failure-protected");
  rmdirSync(blockedPath); await clickText('.project-agent-image-config-body button', '重试保存');
  await wait("document.querySelector('.project-agent-image-config-body')?.textContent.includes('已保存')");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).imageCount, 4);
  await choose("每批图片数量", "2"); await choose("每批图片数量", "5");
  await click('.project-agent-image-config footer button'); await wait("!document.querySelector('.project-agent-image-config')");
  report.checks.push("cached open, quality pool, real save failure/retry/close protection and consecutive changes");
  await stop(); await start();
  await click('.project-agent-config-trigger'); await wait("Boolean(document.querySelector('.project-agent-image-config'))");
  assert.equal(await ev("document.querySelector('button[aria-label=\"每批图片数量\"]')?.textContent.includes('5 张')"), true);
  assert.equal(await ev("document.querySelector('button[aria-label=\"默认生图比例\"]')?.textContent.includes('3:2')"), true);
  await shot("restart-preferences"); await click('.project-agent-image-config footer button');
  await click('[aria-label="调整对话框位置"]');
  const independentPoint = await ev(`(()=>{const e=Array.from(document.querySelectorAll('.agent-placement-menu button')).find(e=>e.textContent.includes('独立浮动窗口'));const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...independentPoint, button: "left", clickCount: 1 });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 150, intervalMs: 100, findTarget: targets => targets.find(t => t.url.includes("agent-window.html")) });
  independent = new BasicCdpClient(target.webSocketDebuggerUrl); await independent.open(); await independent.send("Runtime.enable");
  await waitForRuntimeExpression(independent, "Boolean(document.querySelector('#agent-prompt'))", { evaluate: evaluateRuntime, timeoutMs: 12000 });
  const ip = await evaluateRuntime(independent, "(()=>{const r=document.querySelector('#agent-prompt').getBoundingClientRect();return{x:r.x+40,y:r.y+20}})()");
  for (const type of ["mousePressed", "mouseReleased"]) await independent.send("Input.dispatchMouseEvent", { type, ...ip, button: "left", clickCount: 1 });
  await independent.send("Input.insertText", { text: "/config" });
  for (const type of ["keyDown", "keyUp"]) await independent.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", modifiers: 2 });
  await wait("Boolean(document.querySelector('.project-agent-image-config'))");
  await check("independent Agent opens same persisted configuration", () => ev("document.querySelector('button[aria-label=\"每批图片数量\"]')?.textContent.includes('5 张')")); await shot("independent-config");
  await click('.project-agent-image-config footer button');
  assert.equal(report.modelPosts, 0); report.checks.push("actual Electron restart and main/independent owner sync, zero model POSTs");
  await stop(); report.ok = true;
} catch (error) { report.error = String(error.stack || error); process.exitCode = 1; if (client) try { await shot("failure"); } catch {} }
finally {
  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, report: join(runDir, "report.json") }));
  independent?.close(); client?.close(); await forceKillProcessTree(electron?.pid); await forceKillProcessTree(vite?.pid); server.closeAllConnections(); server.close();
}
