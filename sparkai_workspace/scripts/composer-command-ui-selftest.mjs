import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = resolve(process.argv.find((arg) => arg.startsWith("--exe="))?.slice(6) || root);
const packaged = executable !== root;
const runDir = join(root, ".diagnostics", packaged ? "release" : "electron", `composer-command-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config"), projectDir = join(runDir, "project");
const report = { ok: false, packaged, realModelRequests: 0, checks: [], screenshots: [] };
const require = createRequire(import.meta.url);
const { buildProductionSymbolPlan, transformCode } = require("./production-symbol-compaction.cjs");
const plan = packaged ? buildProductionSymbolPlan(root) : null;
let vite, electron, main, independent;
const evaluate = (client, expression, ...options) => evaluateRaw(client, plan && client !== independent ? transformCode(expression, plan, "composer-ui-test.js") : expression, ...options);
const wait = (client, expression, timeoutMs = 15000) => waitForRuntimeExpression(client, expression, { evaluate, timeoutMs, intervalMs: 80 });
async function click(client, selector) {
  await wait(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const point = await evaluate(client, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({block:'nearest'});
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    const x = r.x+r.width/2, y = r.y+r.height/2;
    return {x,y, visible: !el.disabled && style.visibility !== 'hidden' && r.width>=12 && r.height>=12 && r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && el.contains(document.elementFromPoint(x,y))};
  })()`);
  assert.equal(point.visible, true, `Clipped, covered or disabled: ${selector}`);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await delay(120);
}
async function input(client, value) {
  const selector = client === independent ? "#agent-prompt" : ".project-agent-composer textarea";
  await wait(client, `Boolean(document.querySelector(${JSON.stringify(selector)})) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  await evaluate(client, `(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    el.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await wait(client, `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`);
  await delay(180);
}
async function key(client, key, code, modifiers = 0) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await delay(160);
}
async function dialogKey(client, accept) {
  let listener;
  const handled = new Promise((resolveDialog, rejectDialog) => {
    const timer = setTimeout(() => rejectDialog(new Error("Expected confirmation dialog did not open")), 8000);
    listener = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method !== "Page.javascriptDialogOpening") return;
      clearTimeout(timer);
      report.nativeConfirmations = (report.nativeConfirmations || 0) + 1;
      client.send("Page.handleJavaScriptDialog", { accept }).then(resolveDialog, rejectDialog);
    };
    client.socket.addEventListener("message", listener);
  });
  try { await Promise.all([key(client, "Enter", "Enter", 2), handled]); }
  finally { client.socket.removeEventListener("message", listener); }
}
async function shot(client, name) {
  const file = `${name}.png`;
  await capturePngScreenshotToFile(client, join(runDir, file), { captureBeyondViewport: false });
  report.screenshots.push(file);
}
async function select(label, value) {
  await click(main, `.project-agent-image-config button[aria-label="${label}"]`);
  await click(main, `[role="option"][data-glass-select-value="${value}"]`);
  await wait(main, "document.querySelector('.project-agent-image-config-body')?.textContent.includes('已保存')");
}
async function closeConfig() {
  await click(main, ".project-agent-image-config footer button");
  await wait(main, "!document.querySelector('.project-agent-image-config')");
}
try {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(projectDir, "output/imagegen"), { recursive: true });
  const sharp = require("sharp");
  for (let index = 1; index <= 2; index++) await sharp({ create: { width: 512, height: 512, channels: 3, background: index === 1 ? "#ddbb88" : "#88bbee" } }).png().toFile(join(projectDir, `output/imagegen/fixture-${index}.png`));
  const now = new Date().toISOString();
  const node = { id: "composer-source", displayCode: "I001", title: "配置命令验收素材", prompt: "local fixture", type: "image", status: "done", imageState: "done", imageContainer: true, imageContainerRole: "source", x: 100, y: 100, outputs: 2, branch: "basic", createdAt: now,
    assets: [1,2].map((index) => ({ assetId: `composer-asset-${index}`, index, type: "file", path: join(projectDir, `output/imagegen/fixture-${index}.png`), width: 512, height: 512 })) };
  writeFileSync(join(projectDir, "session.json"), JSON.stringify({ version: 5, nodes: [node], messages: [], selectedNodeId: "", selectedNodeIds: [], agentConversations: [{ id: "composer-chat", title: "界面验证", createdAt: now, updatedAt: now, messages: [] }], activeAgentConversationId: "composer-chat" }));
  writeFileSync(join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: "composer-project", projects: [{ id: "composer-project", name: "图片配置与命令验收", path: projectDir, sessionPath: join(projectDir, "session.json"), createdAt: now, updatedAt: now, external: true }] }));
  writeFileSync(join(configDir, "app-settings.json"), JSON.stringify({ imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2", "grok-imagine-image-2.0", "gemini-3.1-flash-image"], agentModel: "gpt-6.1-sol", agentModelPool: ["gpt-6.1-sol"], imageRatio: "1:1", imageResolution: "1K", imageCount: 1, imageQuality: "auto", serverToken: "fixture-token", serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "fixture-user", glassTheme: "light-classic", glassReducedMotion: true }));
  const debugPort = await allocateDebugPort();
  let url = "";
  if (!packaged) {
    const vitePort = await allocateDebugPort(); url = `http://127.0.0.1:${vitePort}`;
    vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort)], { cwd: root, stdio: "ignore", windowsHide: true });
    await waitForHttpServer(url, { attempts: 150, intervalMs: 100 });
  }
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`];
  electron = spawn(packaged ? executable : process.execPath, packaged ? args : [join(root, "node_modules/electron/cli.js"), ...args, "electron-main.cjs"], { cwd: packaged ? dirname(executable) : root, stdio: "ignore", windowsHide: true, env: { ...process.env, NAIMAGE_DEV_URL: url, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_AIDEBUG_AGENT_MODE: "mock", NAIMAGE_AIDEBUG_REAL_AGENT: "0", NAIMAGE_AIDEBUG_LIVE_IMAGE: "0", NAIMAGE_CONFIG_DIR: configDir, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log") } });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 200, intervalMs: 100, findTarget: (targets) => targets.find((item) => item.type === "page" && !item.url.includes("agent-window.html") && (url ? item.url.startsWith(url) : item.url.includes("index.html"))) });
  main = new BasicCdpClient(target.webSocketDebuggerUrl); await main.open(); await main.send("Runtime.enable"); await main.send("Page.enable");
  await wait(main, "Boolean(document.querySelector('.project-agent-config-trigger'))");
  assert.equal(await evaluate(main, "document.querySelectorAll('.project-agent-mode-trigger,.project-agent-model-trigger,.project-agent-frame-trigger').length"), 0);
  await shot(main, "01-composer");
  await click(main, ".project-agent-config-trigger");
  await wait(main, "Boolean(document.querySelector('.project-agent-image-config'))");
  await select("默认生图比例", "3:2");
  await select("默认生图清晰度", "2K");
  await select("每批图片数量", "3");
  await select("生图质量", "high");
  await click(main, 'button[aria-label="设为默认生图模型：grok-imagine-image-2.0"]');
  await wait(main, "Boolean(document.querySelector('button[aria-label=\"默认生图模型：grok-imagine-image-2.0\"]'))");
  await shot(main, "02-image-config");
  const settings = JSON.parse(readFileSync(join(configDir, "app-settings.json"), "utf8"));
  assert.equal(settings.imageRatio, "3:2"); assert.equal(settings.imageResolution, "2K"); assert.equal(settings.imageCount, 3); assert.equal(settings.imageQuality, "high"); assert.equal(settings.imageModel, "grok-imagine-image-2.0");
  report.checks.push("configuration saved through canonical settings");
  await closeConfig();
  await evaluate(main, "window.__composerReloadMarker = true");
  await main.send("Page.reload");
  await wait(main, "!window.__composerReloadMarker && Boolean(document.querySelector('.project-agent-config-trigger'))");
  await input(main, "/config"); await key(main, "Enter", "Enter", 2);
  await wait(main, "document.querySelector('.project-agent-image-config-summary')?.textContent.includes('grok-imagine-image-2.0')");
  assert.equal(await evaluate(main, "document.querySelector('button[aria-label=\"默认生图比例\"]')?.textContent.includes('3:2')"), true);
  report.checks.push("reload restored configuration and /config opened it"); await closeConfig();
  await input(main, "/"); await wait(main, "document.querySelectorAll('.project-agent-command-menu > button').length === 8");
  await key(main, "ArrowDown", "ArrowDown");
  assert.equal(await evaluate(main, "document.querySelector('.project-agent-command-menu [aria-selected=\"true\"]')?.id"), await evaluate(main, "document.querySelectorAll('.project-agent-command-menu > button')[1]?.id"));
  await shot(main, "03-commands");
  await key(main, "Escape", "Escape"); await wait(main, "!document.querySelector('.project-agent-command-menu')");
  await input(main, "/go"); await key(main, "Tab", "Tab");
  await wait(main, "document.querySelector('.project-agent-composer textarea')?.value === '/goal '");
  await key(main, "Enter", "Enter", 2); await wait(main, "document.querySelector('.project-agent-command-notice')?.textContent.includes('处理要求')");
  await input(main, "/unknown"); await key(main, "Enter", "Enter", 2); await wait(main, "document.querySelector('.project-agent-command-notice')?.textContent.includes('未知命令')");
  await input(main, "/pause"); await key(main, "Enter", "Enter", 2); await wait(main, "document.querySelector('.project-agent-command-notice')?.textContent.includes('没有运行')");
  await input(main, "/status"); await key(main, "Enter", "Enter", 2); await wait(main, "document.querySelector('.project-agent-command-notice')?.textContent.includes('当前空闲')");
  await input(main, "/help"); await key(main, "Enter", "Enter", 2); await wait(main, "document.querySelectorAll('.project-agent-command-menu > button').length === 8"); await key(main, "Escape", "Escape");
  report.checks.push("suggestions, arrows, Tab, Escape, /help, /status and invalid commands");
  await input(main, "/status");
  await evaluate(main, "document.querySelector('.project-agent-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}))");
  assert.equal(await evaluate(main, "Boolean(document.querySelector('.project-agent-command-notice'))"), false);
  report.checks.push("IME composing Enter did not execute a command");
  await input(main, "/goal 把全部素材改成白色背景"); await key(main, "Enter", "Enter", 2);
  await wait(main, "Boolean(document.querySelector('.goal-confirmation-dialog'))");
  assert.equal(await evaluate(main, "document.querySelector('.goal-confirmation-body')?.textContent.includes('2 张母图')"), true);
  await shot(main, "04-goal-confirmation");
  await click(main, ".goal-confirmation-dialog header button");
  await wait(main, "!document.querySelector('.goal-confirmation-dialog')");
  assert.equal(await evaluate(main, "document.querySelector('.project-agent-composer textarea')?.value"), "/goal 把全部素材改成白色背景");
  report.checks.push("Goal used existing confirmation and cancellation preserved draft");
  await input(main, "");
  if (!packaged) await evaluate(main, "window.naimageConfig.debugWindowBounds({width:884,height:640})");
  else await main.send("Emulation.setDeviceMetricsOverride", { width: 884, height: 640, screenWidth: 884, screenHeight: 640, deviceScaleFactor: 1, mobile: false });
  await wait(main, "innerWidth === 884 && innerHeight === 640");
  await shot(main, "05-composer-small");
  await click(main, ".project-agent-config-trigger"); await shot(main, "06-config-small");
  const bounds = await evaluate(main, "(() => { const r=document.querySelector('.project-agent-image-config').getBoundingClientRect(); return {viewportWidth:innerWidth,viewportHeight:innerHeight,width:r.width,height:r.height,visible:r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1,overflow:document.documentElement.scrollWidth>innerWidth}; })()");
  assert.equal(bounds.visible, true); assert.equal(bounds.overflow, false); report.smallConfig = bounds; await closeConfig();
  await input(main, "/"); await shot(main, "07-commands-small"); await key(main, "Escape", "Escape"); await input(main, "");
  const nodesBeforeNew = await evaluate(main, "document.querySelectorAll('.flow-node').length");
  await input(main, "/new"); await key(main, "Enter", "Enter", 2);
  await wait(main, "Boolean(document.querySelector('.confirm-dialog'))");
  await click(main, ".confirm-dialog footer button:last-child");
  await wait(main, "!document.querySelector('.confirm-dialog')");
  assert.equal(await evaluate(main, "document.querySelectorAll('.flow-node').length"), nodesBeforeNew);
  report.checks.push("/new reused confirmation and preserved canvas");
  await click(main, '[aria-label="调整对话框位置"]');
  await evaluate(main, "Array.from(document.querySelectorAll('.agent-placement-menu button')).find(button=>button.textContent.includes('独立浮动窗口')).click()");
  const agentTarget = await pollForDebugTarget({ port: debugPort, attempts: 150, intervalMs: 100, findTarget: (targets) => targets.find((item) => item.type === "page" && item.url.includes("agent-window.html")) });
  independent = new BasicCdpClient(agentTarget.webSocketDebuggerUrl); await independent.open(); await independent.send("Runtime.enable"); await independent.send("Page.enable");
  await wait(independent, "document.getElementById('agent-prompt')?.disabled === false");
  assert.equal(await evaluate(independent, "Boolean(document.getElementById('goal-mode') || document.getElementById('standard-mode'))"), false);
  await input(independent, "/"); await wait(independent, "document.querySelectorAll('.command-menu > button').length === 8"); await shot(independent, "08-independent-commands");
  await input(independent, "/config"); await key(independent, "Enter", "Enter", 2); await wait(main, "Boolean(document.querySelector('.project-agent-image-config'))"); await shot(main, "09-independent-opened-config"); await closeConfig();
  await input(independent, "/unknown"); await key(independent, "Enter", "Enter", 2); await wait(independent, "document.querySelector('.command-notice').textContent.includes('未知命令')");
  await input(independent, "/goal 修改全部素材"); await dialogKey(independent, false);
  report.checks.push("independent shared commands, config while main collapsed, Goal cancel");
  const preSendLog = readFileSync(join(runDir, "electron.log"), "utf8");
  assert.equal((preSendLog.match(/agent ipc chat received/g) || []).length, 0);
  report.checks.push("configuration, canceled Goal and commands sent zero model requests");
  await input(independent, "核对界面并回复收到，禁止调用生图工具。"); await key(independent, "Enter", "Enter", 2);
  await wait(independent, "document.getElementById('agent-feed')?.textContent.includes('核对界面并回复收到')");
  await wait(independent, "document.getElementById('agent-prompt')?.value === ''", 60000);
  await wait(independent, "document.getElementById('stop-button')?.hidden === true", 60000);
  report.checks.push("ordinary prompt still reached original Agent runtime in Mock");
  await shot(independent, "10-independent-chat");
  report.ok = true;
} catch (error) {
  report.error = String(error.stack || error); process.exitCode = 1;
  if (main) try { await shot(main, "failure"); } catch {}
} finally {
  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: join(runDir, "report.json") }));
  independent?.close(); main?.close(); await forceKillProcessTree(electron?.pid); await forceKillProcessTree(vite?.pid);
}
