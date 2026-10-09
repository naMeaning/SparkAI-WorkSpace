import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exeArg = process.argv.find((arg) => arg.startsWith("--exe="));
const executable = exeArg ? resolve(exeArg.slice(6)) : "";
const runDir = join(repoRoot, ".diagnostics", executable ? "release" : "electron", `agent-post-image-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const projectDir = join(runDir, "project");
const logPath = join(runDir, "electron.log");
let viteProcess, electronProcess, client, agentClient;
const require = createRequire(import.meta.url);
const { buildProductionSymbolPlan, transformCode } = require("./production-symbol-compaction.cjs");
const symbolPlan = executable ? buildProductionSymbolPlan(repoRoot) : null;
const evaluate = (targetClient, expression, ...options) => evaluateRaw(targetClient,
  symbolPlan && targetClient !== agentClient ? transformCode(expression, symbolPlan, "partial-ui-test.js") : expression, ...options);
const report = { ok: false, packaged: Boolean(executable), realModelRequests: 0, screenshots: [] };
try {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: "post-image-ui", projects: [
    { id: "post-image-ui", name: "成图后对话故障验证", path: projectDir, sessionPath: join(projectDir, "session.json"), createdAt: now, updatedAt: now, external: true }
  ] }));
  writeFileSync(join(configDir, "app-settings.json"), JSON.stringify({ agentModel: "gpt-6.1-sol", imageModel: "grok-imagine-image-2.0",
    serverToken: "aidebug-token", serverAuthProtocol: "legacy", serverSessionCookie: "aidebug-session", serverUserId: "aidebug-user",
    agentModelPool: ["gpt-6.1-sol"], imageModelPool: ["grok-imagine-image-2.0"], glassTheme: "pure-white", imageRatio: "1:1", imageResolution: "1K" }));
  const debugPort = await allocateDebugPort();
  let devUrl = "";
  if (!executable) {
    const vitePort = await allocateDebugPort();
    devUrl = `http://127.0.0.1:${vitePort}`;
    viteProcess = spawn(process.execPath, [join(repoRoot, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort)],
      { cwd: repoRoot, windowsHide: true, stdio: "ignore" });
    await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  }
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`];
  electronProcess = spawn(executable || process.execPath, executable ? args : [join(repoRoot, "node_modules/electron/cli.js"), ...args, "electron-main.cjs"], {
    cwd: executable ? dirname(executable) : repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_AIDEBUG_REAL_AGENT: "0",
      NAIMAGE_AIDEBUG_LIVE_IMAGE: "0", NAIMAGE_CONFIG_DIR: configDir, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: logPath }
  });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 180, intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && !/agent-window\.html/.test(item.url) && (devUrl ? item.url.startsWith(devUrl) : /index\.html/.test(item.url))) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea'))", { evaluate, timeoutMs: 18000, intervalMs: 100 });
  await evaluate(client, `(() => {
    const textarea = document.querySelector('.project-agent-composer textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'AIDEBUG_POST_IMAGE_502 生成一张本地验证图片');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-send:not(:disabled)'))", { evaluate, timeoutMs: 4000, intervalMs: 50 });
  const button = await evaluate(client, "(() => { const r = document.querySelector('.project-agent-send').getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()");
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...button, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...button, button: "left", clickCount: 1 });
  await waitForRuntimeExpression(client, "document.querySelector('.project-agent-status')?.textContent.includes('后续对话未完成') && document.querySelector('.project-agent-panel')?.textContent.includes('最终回复未完成')", { evaluate, timeoutMs: 60000, intervalMs: 150 });
  report.main = await evaluate(client, `(() => {
    const panel = document.querySelector('.project-agent-panel');
    const receipt = Array.from(panel.querySelectorAll('.agent-message')).find((item) => item.textContent.includes('最终回复未完成'));
    const r = receipt?.getBoundingClientRect();
    const canvasImages = Array.from(document.querySelectorAll('.canvas-stage img, .workflow-node img, .canvas-node img')).filter((img) => img.complete && img.naturalWidth > 0);
    return { status: document.querySelector('.project-agent-status').textContent.trim(), receipt: receipt?.textContent.trim(),
      receiptError: receipt?.classList.contains('error'), errors: panel.querySelectorAll('.agent-message.error').length,
      imageCompleted: panel.textContent.includes('图片生成完成'), viewCompleted: panel.textContent.includes('图片读取完成'),
      imageResults: panel.querySelectorAll('.agent-tool-trace-completion').length,
      receiptBounds: r ? { width:r.width, height:r.height, right:r.right, bottom:r.bottom } : null,
      renderedCanvasImages: canvasImages.length, viewport: {width:innerWidth,height:innerHeight} };
  })()`);
  assert.equal(report.main.errors, 0);
  assert.equal(report.main.receiptError, false);
  assert.equal(report.main.imageCompleted, true);
  assert.equal(report.main.viewCompleted, true);
  assert.ok(report.main.receiptBounds.width > 100 && report.main.receiptBounds.right <= report.main.viewport.width);
  assert.ok(report.main.renderedCanvasImages >= 1);
  const mainShot = join(runDir, "main-partial.png");
  await capturePngScreenshotToFile(client, mainShot, { captureBeyondViewport: false });
  report.screenshots.push("main-partial.png");
  // Exercise the owner action: opening the raw IPC skips the Renderer state
  // subscription and cannot prove the real detached-window interaction.
  await evaluate(client, "document.querySelector('[aria-label=\"调整对话框位置\"]').click()");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.agent-placement-menu'))", { evaluate, timeoutMs: 4000, intervalMs: 50 });
  await evaluate(client, "Array.from(document.querySelectorAll('.agent-placement-menu button')).find(button => button.textContent.includes('独立浮动窗口')).click()");
  const agentTarget = await pollForDebugTarget({ port: debugPort, attempts: 120, intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && /agent-window\.html/.test(item.url)) });
  agentClient = new BasicCdpClient(agentTarget.webSocketDebuggerUrl);
  await agentClient.open();
  await agentClient.send("Runtime.enable");
  await agentClient.send("Page.enable");
  await waitForRuntimeExpression(agentClient, "document.getElementById('status-text')?.textContent.includes('后续对话未完成')", { evaluate, timeoutMs: 15000, intervalMs: 100 });
  report.independent = await evaluate(agentClient, "({status:document.getElementById('status-text').textContent, errors:document.querySelectorAll('.message.error').length, receipt:document.body.textContent.includes('最终回复未完成')})");
  assert.equal(report.independent.errors, 0);
  assert.equal(report.independent.receipt, true);
  await capturePngScreenshotToFile(agentClient, join(runDir, "independent-partial.png"), { captureBeyondViewport: false });
  report.screenshots.push("independent-partial.png");
  const log = readFileSync(logPath, "utf8");
  report.imageRequests = (log.match(/aidebug image /g) || []).length;
  report.modelRequests = (log.match(/aidebug model start /g) || []).length;
  // Main uses one image provider request; subsequent calls only read/describe it.
  assert.equal(report.modelRequests, 3);
  const protocol = JSON.parse(readFileSync(join(projectDir, ".naimage/agent/conversations.json"), "utf8"));
  const items = Object.values(protocol.protocols).flatMap((state) => state.turns.flatMap((turn) => turn.items));
  assert.equal(items.filter((item) => item.type === "function_call" && item.name === "image_gen").length, 1);
  assert.equal(items.filter((item) => item.type === "function_call" && item.name === "view_image").length, 1);
  report.protocolRetained = true;
  await evaluate(client, "window.naimageAgentWindow.close()");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('button[aria-label=\"打开设置\"]'))", { evaluate, timeoutMs: 4000, intervalMs: 100 });
  await evaluate(client, "document.querySelector('button[aria-label=\"打开设置\"]').click()");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('button[data-settings-section=\"tools\"]'))", { evaluate, timeoutMs: 6000, intervalMs: 100 });
  await evaluate(client, "document.querySelector('button[data-settings-section=\"tools\"]').click()");
  await waitForRuntimeExpression(client, "Array.from(document.querySelectorAll('.settings-drawer button')).some(button => button.textContent.includes('查看日志'))", { evaluate, timeoutMs: 5000, intervalMs: 100 });
  await evaluate(client, "Array.from(document.querySelectorAll('.settings-drawer button')).find(button => button.textContent.includes('查看日志')).click()");
  await waitForRuntimeExpression(client, "document.querySelector('textarea[aria-label=\"诊断日志\"]')?.value.includes('后续未完成')", { evaluate, timeoutMs: 5000, intervalMs: 100 });
  report.logs = await evaluate(client, "(() => { const field=document.querySelector('textarea[aria-label=\"诊断日志\"]'); const r=field.getBoundingClientRect(); return {readonly:field.readOnly, partial:field.value.includes('后续未完成'), visible:r.width>150 && r.top>=0 && r.bottom<=innerHeight, exportButton:Array.from(document.querySelectorAll('.settings-drawer button')).some(button=>button.textContent.includes('导出日志'))}; })()");
  assert.equal(report.logs.visible, true);
  assert.equal(report.logs.readonly, true);
  assert.equal(report.logs.exportButton, true);
  await capturePngScreenshotToFile(client, join(runDir, "diagnostics.png"), { captureBeyondViewport: false });
  report.screenshots.push("diagnostics.png");
  report.ok = true;
} catch (error) {
  report.error = String(error.stack || error);
  if (client) { try { await capturePngScreenshotToFile(client, join(runDir, "failure.png")); } catch {} }
  process.exitCode = 1;
} finally {
  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ ...report, report: join(runDir, "report.json") }) + "\n");
  agentClient?.close(); client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
