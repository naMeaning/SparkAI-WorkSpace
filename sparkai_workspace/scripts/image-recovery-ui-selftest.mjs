import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const root = resolve(import.meta.dirname, ".."), runDir = join(root, ".diagnostics", `image-recovery-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project");
for (const dir of [config, project]) mkdirSync(dir, { recursive: true });
const png = (await sharp({ create: { width: 64, height: 64, channels: 4, background: "#39a6de" } }).png().toBuffer()).toString("base64");
const report = { ok: false, electronStarts: 0, posts: 0, polls: 0, downloads: 0, realModelRequests: 0, checks: [], screenshots: [] };
let client, electron, vite, devUrl, ready = false, scenario = "accepted";
const ev = expression => evaluateRuntime(client, expression);
const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url.includes("/images/")) {
    report.posts++; for await (const _ of req) {}
    if (scenario === "disconnect") { req.socket.destroy(); return; }
    if (["400", "429", "502"].includes(scenario)) { res.statusCode = Number(scenario); res.end('{"error":{"message":"fixture rejection"}}'); return; }
    if (scenario === "missing") { res.end('{"status":"queued"}'); return; }
    res.end(JSON.stringify({ task_id: `task-${scenario}`, status: "queued" }));
  } else if (req.url.startsWith("/v1/images/tasks/")) {
    report.polls++;
    if (!ready) { res.end('{"status":"running"}'); return; }
    if (report.polls === 1) { res.statusCode = 429; res.end("{}"); return; }
    res.end(JSON.stringify({ status: "completed", result: { data: [{ b64_json: png }, ...(scenario === "partial" ? [{ b64_json: Buffer.from("corrupt").toString("base64") }] : [])] } }));
  } else if (req.url === "/v1/models") res.end('{"data":[{"id":"gpt-image-2"},{"id":"gpt-6.1-sol"}]}');
  else res.end('{"success":true,"data":{"id":1,"username":"fixture","quota":1000000,"items":[]}}');
});
async function wait(fn, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await delay(100); } throw new Error(`Timed out: ${label}`); }
function journal() { const file = join(project, ".naimage/image-operations/journal.json"); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).operations : []; }
async function start() {
  const debugPort = await allocateDebugPort(); report.electronStarts++;
  electron = spawn(process.execPath, [join(root, "node_modules/electron/cli.js"), `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], {
    cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_CONFIG_DIR: config,
      NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1",
      NAIMAGE_DEBUG_DIR: join(runDir, `runtime-${report.electronStarts}`), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "mock-shim.cjs") }
  });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 250, intervalMs: 100, findTarget: ts => ts.find(t => t.type === "page") });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea'))", { evaluate: evaluateRuntime, timeoutMs: 60000 });
}
async function stop(crash = false) {
  if (!electron) return;
  if (!crash) { try { await client.send("Runtime.evaluate", { expression: "void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),100)", awaitPromise: false }); } catch {} }
  client?.close(); client = null;
  if (!crash) await delay(800);
  await forceKillProcessTree(electron.pid); electron = null;
}
async function command(command, args = {}) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, args }) });
  return response.json();
}
async function snap(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`)); report.screenshots.push(`${name}.png`); }
async function generate(id, awaitResult = true) {
  const expression = `window.naimageServer.generateImage(${JSON.stringify({ projectId: "P", conversationId: "conversation-recovery", runId: id, operationId: id, model: "gpt-image-2", prompt: "Local recovery fixture", count: scenario === "partial" ? 2 : 1, quality: "auto", ratio: "1:1", resolution: "1K" })})`;
  if (awaitResult) return ev(expression);
  await client.send("Runtime.evaluate", { expression, awaitPromise: false });
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(runDir, "mock-shim.cjs"), "setInterval(() => {}, 60000);\n");
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [], messages: [], conversations: [], layoutGroups: [] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "P", projects: [{ id: "P", name: "原图片恢复验收", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", accountBaseUrl: base, relayBaseUrl: base, updateBaseUrl: base, serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-key", imageConnectionVersion: 1,
    imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"], imageModelBindings: [{ model: "gpt-image-2", customBaseUrl: base, customApiKey: "fixture-key", gateway: "sub2api", protocol: "openai-images", transportMode: "async" }],
    imageModelConfigs: [{ model: "gpt-image-2", pollIntervalMs: 100, maxWaitMs: 5000 }], agentModel: "gpt-6.1-sol", glassTheme: "light-classic", imageQuality: "auto" }));
  const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
  await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  // Let Electron persist its per-profile OS encryption key before simulating
  // a crash. A brand-new profile killed before Local State flush is a different
  // credential bootstrap failure, not task recovery.
  await start();
  await ev(`(async()=>{const current=await window.naimageConfig.loadSettings();return window.naimageConfig.saveSettings(current.settings)})()`);
  assert.ok(existsSync(join(config, "app-settings.secrets.json")), "fixture credentials encrypted by actual Main");
  await stop(); await start();
  await generate("accepted-before-restart", false);
  await wait(() => journal().some(item => item.taskId === "task-accepted"), "accepted persisted before restart");
  assert.equal(report.posts, 1); report.checks.push("actual Main records acceptance before waiting");
  await stop(true); ready = true; await start();
  const original = journal().find(item => item.operationId === "accepted-before-restart");
  const list = await command("image.operations"); assert.equal(list.ok, true); assert.ok(JSON.stringify(list).includes(original.key));
  // Open the actual canvas menu and use the same recovery owner as the CLI.
  const blank = await ev(`(()=>{const r=document.querySelector('.canvas-panel').getBoundingClientRect();return {x:r.x+120,y:r.y+200}})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...blank, button: "right", clickCount: 1 });
  await waitForRuntimeExpression(client, "Array.from(document.querySelectorAll('[role=\"menuitem\"]')).some(e=>e.textContent.includes('恢复图片结果'))", { evaluate: evaluateRuntime, timeoutMs: 5000 });
  const menuPoint = await ev(`(()=>{const r=Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.includes('恢复图片结果')).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...menuPoint, button: "left", clickCount: 1 });
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('[aria-label=\"恢复图片结果\"]'))", { evaluate: evaluateRuntime, timeoutMs: 5000 });
  await snap("original-task-after-restart");
  const blockedSession = join(project, "session.json.tmp"); mkdirSync(blockedSession);
  const recoverPoint = await ev(`(()=>{const r=Array.from(document.querySelectorAll('[aria-label="恢复图片结果"] button')).find(e=>e.textContent.includes('查询原任务并保存')).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...recoverPoint, button: "left", clickCount: 1 });
  await wait(() => journal().find(item => item.key === original.key)?.state === "saved", "GUI recovers original result");
  await wait(async () => (await ev("document.querySelectorAll('.flow-node').length")) === 1, "recovered canvas node");
  await wait(async () => (await ev(`document.querySelector('[aria-label="恢复图片结果"] [role="alert"]')?.textContent.includes('保存')`)), "project write failure is visible");
  await wait(async () => (await ev(`document.querySelector('[aria-label="恢复图片结果"]')?.textContent.includes('已保存 1 张') && Array.from(document.querySelectorAll('[aria-label="恢复图片结果"] button')).some(e=>e.textContent.includes('恢复已有结果'))`)), "failure refreshes the original asset stage and offers local recovery");
  assert.equal(JSON.parse(readFileSync(join(project, "session.json"), "utf8")).nodes.length, 0, "failed project write has no false persisted result");
  await snap("project-save-failure"); rmdirSync(blockedSession);
  const beforeRetryPolls = report.polls;
  const saveRetry = await command("image.recover", { key: original.key, expectedProjectId: "P" }); assert.equal(saveRetry.ok, true);
  assert.equal(report.polls, beforeRetryPolls, "local project save retry does not query or create again");
  report.checks.push("real project write failure, visible error and local retry preserve one asset without POST/poll");
  await snap("recovered-result"); assert.equal(report.posts, 1);
  const repeated = await command("image.recover", { key: original.key, expectedProjectId: "P" }); assert.equal(repeated.ok, true);
  assert.equal(await ev("document.querySelectorAll('.flow-node').length"), 1); report.checks.push("Electron restart + GUI + repeated command: one asset and one POST");
  // Exercise the shipped PowerShell CLI against an isolated copied Skill.
  const skill = join(runDir, "cli-skill"); mkdirSync(skill, { recursive: true }); cpSync(join(root, "integrations/naimage-control/scripts"), join(skill, "scripts"), { recursive: true });
  writeFileSync(join(skill, ".naimage-connection.json"), JSON.stringify({ endpointPath: join(config, "automation/endpoint.json"), executablePath: "unused" }));
  const cli = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(skill, "scripts/naimage.ps1"), "image.operations"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; cli.stdout.on("data", c => output += c); cli.stderr.on("data", c => output += c);
  assert.equal(await new Promise(resolve => cli.on("exit", resolve)), 0, output); assert.ok(output.includes(original.key)); report.checks.push("actual CLI image.operations");
  scenario = "cancel"; ready = false;
  const cancelPosts = report.posts;
  await generate("cancel-local-wait", false);
  await wait(() => journal().some(item => item.operationId === "cancel-local-wait" && item.taskId), "cancel scene accepted");
  const stopped = await ev(`window.naimageAgent.stop({runId:'cancel-local-wait',projectId:'P',conversationId:'conversation-recovery'})`);
  assert.equal(stopped.stopped, 1); await delay(200); assert.equal(report.posts, cancelPosts + 1);
  await stop(); ready = true; await start();
  const canceled = journal().find(item => item.operationId === "cancel-local-wait");
  const canceledRecovery = await command("image.recover", { key: canceled.key, expectedProjectId: "P" }); assert.equal(canceledRecovery.ok, true);
  assert.equal(report.posts, cancelPosts + 1); assert.equal(await ev("document.querySelectorAll('.flow-node').length"), 2);
  report.checks.push("cancel local wait after acceptance, actual restart recovers original task without POST");
  for (scenario of ["400", "429", "502", "disconnect", "missing"]) {
    const before = report.posts, result = await generate(`failure-${scenario}`); assert.equal(result.ok, false, scenario); assert.equal(report.posts, before + 1, `${scenario}: exactly one POST`);
    const operation = journal().find(item => item.operationId === `failure-${scenario}`); assert.ok(operation, scenario);
    const recovery = await ev(`window.naimageServer.recoverImage({projectId:'P',key:${JSON.stringify(operation.key)}})`); assert.equal(recovery.ok, false); assert.equal(report.posts, before + 1);
    report.checks.push(`${scenario}: single create, failed recovery never replays`);
  }
  scenario = "partial"; const partial = await generate("partial-two-slots"); assert.equal(partial.assets?.length, 1); assert.equal(journal().find(item => item.operationId === "partial-two-slots").state, "partial");
  assert.equal(JSON.stringify(partial).includes("b64_json"), false); report.checks.push("partial success and public result excludes upstream payload");
  await stop(); await start();
  assert.equal(await ev("document.querySelectorAll('.flow-node').length"), 2); const before = report.posts;
  const again = await command("image.recover", { key: original.key, expectedProjectId: "P" }); assert.equal(again.ok, true); assert.equal(report.posts, before); assert.equal(await ev("document.querySelectorAll('.flow-node').length"), 2);
  report.checks.push("second Electron restart: saved project and stable asset identity");
  const journalText = readFileSync(join(project, ".naimage/image-operations/journal.json"), "utf8");
  for (const secret of ["fixture-key", "fixture-session", "http://", "b64_json"]) assert.equal(journalText.includes(secret), false, secret);
  report.ok = true;
} catch (error) { report.error = String(error.stack || error); process.exitCode = 1; if (client) try { await snap("failure"); } catch {} }
finally { await stop(); await forceKillProcessTree(vite?.pid); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, report: join(runDir, "report.json") })); }
