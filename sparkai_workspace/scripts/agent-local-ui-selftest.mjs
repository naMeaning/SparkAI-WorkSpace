import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, "..");
const runDir = join(root, ".diagnostics", `agent-local-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project"), projectId = "local-agent-ui", conversationId = "local-conversation";
for (const directory of [config, project]) mkdirSync(directory, { recursive: true });
const report = { ok: false, checks: [], screenshots: [], shutdowns: [], wire: [], cloudRequests: [], serverErrors: [], modelPosts: 0, realModelRequests: 0, realDownloads: 0, realDependencyInstalls: 0,
  fixture: "Actual Electron Main profile service, protected IPC, shared automation, single Agent runtime and real loopback Chat Completions SSE. Native chooser fixture only; no mock model runtime." };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const cloud = createServer((req, res) => { report.cloudRequests.push({ method: req.method, path: req.url }); res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "Cloud trap: local-only test" } })); });
await new Promise(done => cloud.listen(0, "127.0.0.1", done));
const modelServer = createServer(async (req, res) => {
  try {
    assert.equal(req.url, "/v1/chat/completions"); assert.equal(req.method, "POST");
    const chunks = []; for await (const bytes of req) chunks.push(bytes); const body = JSON.parse(Buffer.concat(chunks));
    report.modelPosts++;
    const names = (body.tools || []).map(tool => tool.function?.name);
    assert.equal(names.includes("web_search"), false); assert.equal(names.includes("image_gen"), false); assert.equal(names.includes("view_image"), false);
    report.wire.push({ model: body.model, stream: body.stream, tools: names, toolMessageCount: body.messages.filter(message => message.role === "tool").length }); checkpoint();
    assert.equal(body.stream, true);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    const send = delta => res.write(`data: ${JSON.stringify({ id: "local-ui", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    const finish = reason => { res.write(`data: ${JSON.stringify({ id: "local-ui", choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`); res.end(); };
    const latestUser = [...body.messages].reverse().find(message => message.role === "user"), prompt = JSON.stringify(latestUser?.content || "");
    const hasToolResult = body.messages.some(message => message.role === "tool" && message.tool_call_id === "local-experience-read");
    if (prompt.includes("phase4-tool") && !hasToolResult) {
      assert.ok(names.includes("experience"));
      send({ role: "assistant", tool_calls: [{ index: 0, id: "local-experience-read", type: "function", function: { name: "experience", arguments: '{"action":' } }] });
      await delay(35); send({ tool_calls: [{ index: 0, function: { arguments: '"read"}' } }] }); finish("tool_calls");
    } else {
      if (body.model === "fixture-text-only") assert.equal(names.length, 0);
      send({ role: "assistant", content: hasToolResult ? "本地经验已读取。" : "本地文字流已收到。" }); await delay(35); send({ content: "所有请求保持本机连接。" }); finish("stop");
    }
  } catch (error) { report.serverErrors.push(String(error.stack || error)); checkpoint(); if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(done => modelServer.listen(0, "127.0.0.1", done));
const modelPort = modelServer.address().port, modelBase = `http://127.0.0.1:${modelPort}/v1`;
const profiles = [
  { file: "tools.json", label: "本地工具夹具", modelId: "fixture-tools", capabilities: { tools: true, vision: false, contextWindowTokens: 131072, maxOutputTokens: 1024 } },
  { file: "text.json", label: "本地纯文字夹具", modelId: "fixture-text-only", capabilities: { tools: false, vision: false, contextWindowTokens: 131072, maxOutputTokens: 1024 } },
  { file: "small.json", label: "本地小窗口夹具", modelId: "fixture-small", capabilities: { tools: false, vision: false, contextWindowTokens: 1024, maxOutputTokens: 128 } }
];
for (const profile of profiles) writeFileSync(join(runDir, profile.file), JSON.stringify({ schemaVersion: 1, label: profile.label, kind: "local-openai-compatible", modelId: profile.modelId, capabilities: profile.capabilities, baseUrl: modelBase }));
const native = join(runDir, "next-native.json"), entry = join(runDir, "entry.cjs");
writeFileSync(entry, `const fs=require('node:fs');const {dialog,app}=require('electron');process.on('uncaughtException',e=>{fs.appendFileSync(${JSON.stringify(join(runDir, "startup-error.txt"))},e.stack+'\\n');app.exit(1);});dialog.showOpenDialog=async()=>{if(!fs.existsSync(${JSON.stringify(native)}))return {canceled:true,filePaths:[]};const v=JSON.parse(fs.readFileSync(${JSON.stringify(native)},'utf8'));fs.unlinkSync(${JSON.stringify(native)});return {canceled:false,filePaths:[v.file]};};require(${JSON.stringify(join(root, "electron-main.cjs"))});\n`);
writeFileSync(join(runDir, "no-server.cjs"), "process.exit(0);\n");
writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [], messages: [], layoutGroups: [], activeConversationId: conversationId, conversations: [{ id: conversationId, title: "离线 Agent 验证", messages: [] }] }));
writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: projectId, projects: [{ id: projectId, name: "离线 Agent 工作区", path: project, sessionPath: join(project, "session.json"), external: true }] }));
const cloudBase = `http://127.0.0.1:${cloud.address().port}`;
writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", accountBaseUrl: cloudBase, relayBaseUrl: cloudBase, updateBaseUrl: cloudBase, agentModel: "cloud-must-not-run", compactModel: "cloud-compact-must-not-run", imageModel: "cloud-image-must-not-run", glassTheme: "light-classic", agentPanelWidth: 370 }));
let vite, electron, client, agentClient, debugPort, devUrl;
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => waitForRuntimeExpression(client, expression, { evaluate: evaluateRuntime, timeoutMs: 35000, intervalMs: 100 });
async function until(predicate, name, timeoutMs = 40000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (report.serverErrors.length) throw new Error(report.serverErrors[0]); if (await predicate()) return; await delay(100); } throw new Error(`Timeout: ${name}`); }
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); }
async function click(selector, target = client) {
  await evaluateRuntime(target, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);
  const point = await evaluateRuntime(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing control');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  assert.equal(await evaluateRuntime(target, `Boolean(document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)}))`), true, `reachable ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await target.send("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await delay(100);
}
async function button(text, scope = "document") { await ev(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('missing button');e.dataset.agentLocalTest='current'})()`); await click('[data-agent-local-test="current"]'); await ev("document.querySelector('[data-agent-local-test]')?.removeAttribute('data-agent-local-test')"); }
async function screenshot(name, selector, target = client) {
  if (selector) { await evaluateRuntime(target, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`); await delay(100); const bounds = await evaluateRuntime(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return {visible:!!r&&r.width>40&&r.height>10&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`); assert.equal(bounds.visible, true, `${name} visible`); assert.equal(bounds.overflow, false, `${name} no clipping`); }
  await capturePngScreenshotToFile(target, join(runDir, `${name}.png`), { captureBeyondViewport: false }); report.screenshots.push(`${name}.png`);
}
async function command(command, args = {}, expectOk = true) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const response = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, args, timeoutMs: 20000 }), signal: AbortSignal.timeout(25000) })).json();
  if (expectOk) assert.equal(response.ok, true, JSON.stringify(response).slice(0, 500)); return response.result || response;
}
async function task(name, prompt = name) {
  const started = await command("agent.task.start", { expectedProjectId: projectId, conversationId, submissionId: name, prompt, sourceNodeIds: [] });
  let receipt;
  await until(async () => { receipt = (await command("agent.task.get", { expectedProjectId: projectId, conversationId, taskId: started.task.taskId })).task; return ["completed", "failed", "interrupted", "partial"].includes(receipt.phase); }, `${name} finished`);
  return receipt;
}
async function launch() {
  debugPort = await allocateDebugPort();
  electron = spawn(require("electron"), [entry, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") } });
  for (const stream of [electron.stdout, electron.stderr]) stream.on("data", bytes => appendFileSync(join(runDir, "electron-stderr.log"), bytes));
  const target = await pollForDebugTarget({ port: debugPort, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await wait("Boolean(document.querySelector('.auth-access-card')||document.querySelector('.project-agent-composer textarea'))");
}
async function stop() {
  if (!electron) return;
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {}); client?.close(); agentClient?.close(); client = null; agentClient = null;
  const exited = await waitForChildExit(electron, 18000); report.shutdowns.push({ exited, exitCode: electron.exitCode, forced: false }); assert.equal(exited, true); assert.equal(electron.exitCode, 0); electron = null;
}
try {
  const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [vite.stdout, vite.stderr]) stream.on("data", bytes => appendFileSync(join(runDir, "vite.log"), bytes));
  await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 }); await launch();
  let toolsId, textId, smallId, cloudAtLocal;
  await check("native import and explicit local selection admit workspace without a cloud user or inference", async () => {
    await wait("Boolean(document.querySelector('.auth-access-card'))"); await button("配置本地 Agent"); await wait("Boolean(document.querySelector('[data-agent-provider-manager]'))");
    writeFileSync(native, JSON.stringify({ file: join(runDir, "tools.json") })); await button("导入本地 Agent 连接"); await wait("Boolean(document.querySelector('[data-agent-provider-detail]'))");
    toolsId = (await command("agent.provider.list", { projectId })).profiles.find(item => item.modelId === "fixture-tools").profileId;
    assert.equal(report.modelPosts, 0); await screenshot("native-local-profile", 'select[aria-label="Agent 执行服务"]');
    await click('[data-agent-managed-runtime] > summary'); await wait('Boolean(document.querySelector(\'[data-managed-platform="agent"]\'))');
    assert.equal(await ev('document.querySelector(\'[data-managed-platform="agent"]\').textContent.includes("登记已有环境")'), false);
    await screenshot("managed-local-runtime", 'select[aria-label="本地 Agent 安装清单"]'); await click('[data-agent-managed-runtime] > summary');
    await click('[data-agent-local-image] > summary'); await click('[aria-label="启用 Agent 本机生图"]'); await wait('Boolean(document.querySelector(\'select[aria-label="ComfyUI 连接"]\'))');
    assert.equal(await ev('document.querySelector(\'select[aria-label="ComfyUI 连接"]\').value'), "", "Opening local image configuration never silently selects a connection");
    assert.equal(await ev('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="保存本机生图配置").disabled'), true);
    assert.equal(await ev('document.querySelector(\'[aria-label="ComfyUI 网络范围"]\').disabled'), true);
    assert.deepEqual(await ev('[...document.querySelector(\'[aria-label="ComfyUI 网络范围"]\').options].map(e=>e.value)'), ["local"]);
    await screenshot("explicit-local-image-configuration", 'select[aria-label="ComfyUI 连接"]');
    await click('[aria-label="启用 Agent 本机生图"]'); await click('[data-agent-local-image] > summary');
    assert.equal(report.modelPosts, 0); await button("应用 Agent 服务");
    await wait("Boolean(document.querySelector('.project-agent-composer textarea'))");
    assert.equal(await ev("document.querySelector('.auth-access-card')===null"), true); assert.equal(report.modelPosts, 0);
    cloudAtLocal = report.cloudRequests.length; report.cloudRequestsBeforeLocalSelection = cloudAtLocal; await screenshot("local-workspace", '[data-agent-provider-status]');
  });
  await check("real local SSE streams text and one structured tool call through the original runtime", async () => {
    const plain = await task("phase4-text"); assert.equal(plain.phase, "completed"); assert.equal(report.modelPosts, 1);
    const tool = await task("phase4-tool"); assert.equal(tool.phase, "completed"); assert.equal(report.modelPosts, 3);
    assert.equal(report.wire.at(-1).toolMessageCount, 1); await screenshot("local-tool-result", '[data-agent-provider-status]');
  });
  await check("missing tools and vision are explicit capabilities; strict offline produces no cloud requests", async () => {
    writeFileSync(native, JSON.stringify({ file: join(runDir, "text.json") })); const imported = await command("agent.provider.import"); textId = imported.profile.profileId;
    await command("agent.provider.select", { projectId, profileId: textId, strictOffline: true }); await wait(`document.querySelector('[data-agent-provider-status]')?.dataset.agentProviderStatus===${JSON.stringify(textId)}`);
    const receipt = await task("phase4-no-tools"); assert.equal(receipt.phase, "completed"); assert.equal(report.wire.at(-1).tools.length, 0);
    assert.equal(await ev("document.querySelector('[data-agent-provider-status]').textContent.includes('工具 关闭')"), true);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 884, height: 640, deviceScaleFactor: 1, mobile: false }); await delay(100); await screenshot("minimum-window-text-capability", '[data-agent-provider-status]');
    assert.equal(report.cloudRequests.length, cloudAtLocal);
  });
  await check("declared small context rejects before network without hidden model substitution", async () => {
    writeFileSync(native, JSON.stringify({ file: join(runDir, "small.json") })); smallId = (await command("agent.provider.import")).profile.profileId;
    await command("agent.provider.select", { projectId, profileId: smallId, strictOffline: true }); const before = report.modelPosts;
    const receipt = await task("phase4-context-limit", "仅测试本地上下文预算。".repeat(1000)); assert.notEqual(receipt.phase, "completed"); assert.equal(report.modelPosts, before);
    await command("agent.provider.select", { projectId, profileId: toolsId, strictOffline: true });
  });
  await check("independent window receives the same provider/model/capability/network summary", async () => {
    await wait(`document.querySelector('[data-agent-provider-status]')?.dataset.agentProviderStatus===${JSON.stringify(toolsId)}`);
    await click('[aria-label="调整对话框位置"]'); await ev("[...document.querySelectorAll('.agent-placement-menu button')].find(e=>e.textContent.includes('独立浮动窗口')).click()");
    const target = await pollForDebugTarget({ port: debugPort, attempts: 100, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && /agent-window\.html/.test(item.url)) });
    agentClient = new BasicCdpClient(target.webSocketDebuggerUrl); await agentClient.open(); await agentClient.send("Runtime.enable"); await agentClient.send("Page.enable");
    await waitForRuntimeExpression(agentClient, "document.getElementById('provider-summary')?.textContent.includes('严格离线')", { evaluate: evaluateRuntime, timeoutMs: 15000, intervalMs: 100 });
    assert.equal(await evaluateRuntime(agentClient, "document.getElementById('model-name').textContent"), "fixture-tools"); await screenshot("independent-local-provider", "#provider-summary", agentClient);
  });
  await check("normal restart preserves selected profile and no cloud login/model refresh", async () => {
    await stop(); const before = report.modelPosts; await launch(); await wait("Boolean(document.querySelector('.project-agent-composer textarea'))");
    const status = await command("agent.provider.status", { projectId }); assert.equal(status.selected.profileId, toolsId); assert.equal(status.selected.strictOffline, true);
    assert.equal(report.modelPosts, before); assert.equal(report.cloudRequests.length, cloudAtLocal); await screenshot("restart-local-profile", '[data-agent-provider-status]');
  });
  await check("offline service fails once and reconnect requires an explicit new task", async () => {
    modelServer.closeAllConnections(); await new Promise(done => modelServer.close(done)); const before = report.modelPosts;
    const receipt = await task("phase4-service-offline"); assert.notEqual(receipt.phase, "completed"); await delay(300); assert.equal(report.modelPosts, before);
    await new Promise(done => modelServer.listen(modelPort, "127.0.0.1", done)); const recovered = await task("phase4-service-restored"); assert.equal(recovered.phase, "completed"); assert.equal(report.modelPosts, before + 1);
    assert.equal(report.cloudRequests.length, cloudAtLocal);
  });
  await stop(); report.cloudRequestsAfterLocalSelection = report.cloudRequests.length - cloudAtLocal; report.ok = true; delete report.current; checkpoint();
} catch (error) { report.error = String(error.stack || error); report.dom = await ev("document.body.innerText.slice(-12000)").catch(() => "unavailable"); if (client) await capturePngScreenshotToFile(client, join(runDir, "failure.png"), { captureBeyondViewport: false }).catch(() => {}); checkpoint(); process.exitCode = 1; }
finally {
  if (electron) await stop().catch(error => { report.shutdownError = String(error); }); client?.close(); agentClient?.close(); vite?.kill();
  modelServer.closeAllConnections(); cloud.closeAllConnections(); await Promise.all([new Promise(done => modelServer.close(done)), new Promise(done => cloud.close(done))]); checkpoint();
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, modelPosts: report.modelPosts, cloudRequests: report.cloudRequests.length, screenshots: report.screenshots.length, report: join(runDir, "report.json"), error: report.error }, null, 2));
}
