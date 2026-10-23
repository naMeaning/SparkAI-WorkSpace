import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, "..");
const runDir = join(root, ".diagnostics", `comfyui-runtime-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project"), projectId = "runtime-ui-project";
const portable = join(runDir, "fixture", "ComfyUI_windows_portable");
for (const dir of [config, project, join(portable, "python_embeded"), join(portable, "ComfyUI")]) mkdirSync(dir, { recursive: true });
const report = { ok: false, checks: [], screenshots: [], shutdowns: [], realModelRequests: 0, realDownloads: 0, realDependencyInstalls: 0,
  fixture: "Real Main store, installer, archive extractor, IPC and renderer; loopback artifact bytes, stub Python process/health, native selection/consent fixtures in isolated entry only." };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const hash = value => createHash("sha256").update(value).digest("hex");
const files = [["python_embeded/python.exe", Buffer.from("MZ-stub-never-executed")], ["ComfyUI/main.py", Buffer.from("# fixture only\n")], ["ComfyUI/fixture.bin", randomBytes(2 * 1024 * 1024)]];
for (const [file, bytes] of files) writeFileSync(join(portable, file), bytes);
const archivePath = join(runDir, "fixture.7z");
execFileSync(require("7zip-bin").path7za, ["a", "-t7z", "-mx=0", archivePath, "ComfyUI_windows_portable"], { cwd: join(runDir, "fixture"), windowsHide: true, stdio: "ignore" });
const archive = readFileSync(archivePath), expandedBytes = files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
const downloads = [];
const artifactServer = createServer((req, res) => {
  const match = /^bytes=(\d+)-$/.exec(req.headers.range || ""), offset = match ? Number(match[1]) : 0;
  downloads.push({ method: req.method, path: req.url, offset, ifRange: req.headers["if-range"] || null });
  res.writeHead(offset ? 206 : 200, { "content-type": "application/octet-stream", "content-length": archive.length - offset, etag: '"fixture-runtime-v1"', ...(offset ? { "content-range": `bytes ${offset}-${archive.length - 1}/${archive.length}` } : {}) });
  let sent = offset;
  const timer = setInterval(() => { const end = Math.min(sent + 16384, archive.length); res.write(archive.subarray(sent, end)); sent = end; if (sent === archive.length) { clearInterval(timer); res.end(); } }, 20);
  res.on("close", () => clearInterval(timer));
});
await new Promise(done => artifactServer.listen(0, "127.0.0.1", done));
const manifestPath = join(runDir, "fixture-manifest.json");
const license = { id: "Fixture-only-MIT", url: "https://example.invalid/license" };
const manifest = { schemaVersion: 1, id: "ui-runtime-fixture", label: "本机环境验证夹具", version: "1.0.0", adapter: "comfyui-portable", runtime: { artifactId: "portable", cpu: true },
  requirements: { os: ["win32"], arch: ["x64"], gpu: ["cpu"], vramBytes: 0, diskBytes: archive.length + expandedBytes },
  artifacts: [{ id: "portable", kind: "runtime", format: "7z", filename: "fixture.7z", bytes: archive.length, expandedBytes, sha256: hash(archive), url: `http://127.0.0.1:${artifactServer.address().port}/fixture.7z`, license,
    components: [{ name: "Python fixture (not a runtime)", version: "0", license }, { name: "ComfyUI fixture (not a model)", version: "0", license }], dependencies: [], destination: "." }] };
writeFileSync(manifestPath, JSON.stringify(manifest));
const nativePath = join(runDir, "native-next.json"), consentPath = join(runDir, "consent-next.json");
const nativeLog = join(runDir, "native.jsonl"), processLog = join(runDir, "process.jsonl");
const entryPath = join(runDir, "entry.cjs");
writeFileSync(entryPath, `const fs=require('node:fs');const {EventEmitter}=require('node:events');const {dialog,app}=require('electron');process.on('uncaughtException',error=>{fs.appendFileSync(${JSON.stringify(join(runDir, "startup-error.txt"))},error.stack+'\\n');app.exit(1);});
dialog.showOpenDialog=async()=>{if(!fs.existsSync(${JSON.stringify(nativePath)}))return {canceled:true,filePaths:[]};const next=JSON.parse(fs.readFileSync(${JSON.stringify(nativePath)},'utf8'));fs.unlinkSync(${JSON.stringify(nativePath)});return {canceled:false,filePaths:[next.file]};};
dialog.showMessageBox=async options=>{let response=0;if(fs.existsSync(${JSON.stringify(consentPath)})){response=JSON.parse(fs.readFileSync(${JSON.stringify(consentPath)},'utf8')).response;fs.unlinkSync(${JSON.stringify(consentPath)});}fs.appendFileSync(${JSON.stringify(nativeLog)},JSON.stringify({title:options.title,detail:options.detail,response})+'\\n');return {response};};
const store=require(${JSON.stringify(join(root, "desktop/managed-artifact-store.cjs"))});const createStore=store.createManagedArtifactStore;store.createManagedArtifactStore=options=>createStore({...options,allowLoopbackForTests:true});
const runtime=require(${JSON.stringify(join(root, "desktop/comfyui-runtime-service.cjs"))});const createRuntime=runtime.createComfyUiRuntimeService;runtime.createComfyUiRuntimeService=options=>createRuntime({...options,allowLoopbackForTests:true,spawn:(file,args)=>{const child=new EventEmitter();child.pid=54321;fs.appendFileSync(${JSON.stringify(processLog)},JSON.stringify({event:'spawn',args})+'\\n');child.kill=signal=>{setImmediate(()=>{fs.appendFileSync(${JSON.stringify(processLog)},JSON.stringify({event:'exit',signal})+'\\n');child.emit('exit',0);child.emit('close',0);});return true;};return child;},healthCheck:async()=>true});
require(${JSON.stringify(join(root, "electron-main.cjs"))});\n`);
const account = createServer((req, res) => {
  if (req.method === "POST") { report.unexpectedModelRequests = (report.unexpectedModelRequests || 0) + 1; checkpoint(); }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url === "/v1/models" ? { data: [{ id: "fixture-chat" }, { id: "fixture-image" }] } : { success: true, data: { id: 1, username: "fixture", quota: 10000, items: [] } }));
});
await new Promise(done => account.listen(0, "127.0.0.1", done));
const accountBase = `http://127.0.0.1:${account.address().port}`;
let vite, electron, client, devUrl;
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => waitForRuntimeExpression(client, expression, { evaluate: evaluateRuntime, timeoutMs: 30000, intervalMs: 90 });
async function until(predicate, name) { const deadline = Date.now() + 30000; while (Date.now() < deadline) { if (await predicate()) return; await delay(90); } throw new Error(`Timeout: ${name}`); }
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); }
const selectFile = file => writeFileSync(nativePath, JSON.stringify({ file }));
const consent = response => writeFileSync(consentPath, JSON.stringify({ response }));
async function click(selector) {
  await ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);
  const point = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing control');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  assert.equal(await ev(`Boolean(document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)}))`), true, `reachable ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await delay(80);
}
async function button(label) { await ev(`(()=>{const e=[...document.querySelector('[data-comfyui-runtime-manager]').querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw new Error('missing '+${JSON.stringify(label)});e.dataset.runtimeTestAction='current'})()`); await click('[data-runtime-test-action="current"]'); await ev("document.querySelector('[data-runtime-test-action]')?.removeAttribute('data-runtime-test-action')"); }
async function key(name) { const codes = { Home: ["Home", 36], ArrowDown: ["ArrowDown", 40], Enter: ["Enter", 13] }; const [code, vk] = codes[name]; for (const type of ["keyDown", "keyUp"]) await client.send("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); }
async function choose(selector, value) { const index = await ev(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(e=>e.value===${JSON.stringify(value)})`); assert.ok(index >= 0); await click(selector); await key("Home"); for (let i = 0; i < index; i++) await key("ArrowDown"); await key("Enter"); await wait(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`); }
async function screenshot(name, selector) {
  if (selector) { await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`); await delay(120); const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`); assert.ok(box.left >= 0 && box.right <= box.width && box.top >= 0 && box.bottom <= box.height, `${name} visible`); }
  assert.equal(await ev("document.querySelector('.manual-image-task-body').scrollWidth<=document.querySelector('.manual-image-task-body').clientWidth+1"), true, "no horizontal clipping");
  await capturePngScreenshotToFile(client, join(runDir, `${name}.png`), { captureBeyondViewport: false }); report.screenshots.push(`${name}.png`);
}
async function command(name, args = {}, expectOk = true) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const response = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command: name, args, timeoutMs: 20000 }) })).json();
  if (expectOk) assert.equal(response.ok, true, JSON.stringify(response).slice(0, 600)); return response;
}
async function stop() { if (!electron) return; await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {}); client?.close(); client = null; const exited = await waitForChildExit(electron, 15000); report.shutdowns.push({ exited, exitCode: electron.exitCode, forced: false }); assert.equal(exited, true); assert.equal(electron.exitCode, 0); electron = null; }
async function launch() {
  const port = await allocateDebugPort();
  electron = spawn(require("electron"), [entryPath, `--remote-debugging-port=${port}`, `--user-data-dir=${join(runDir, "user-data")}`], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") } });
  for (const stream of [electron.stdout, electron.stderr]) stream.on("data", bytes => appendFileSync(join(runDir, "electron-stderr.log"), bytes));
  const target = await pollForDebugTarget({ port, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await wait("Boolean(document.querySelector('.project-agent-composer textarea')&&window.__naimageDebugAgentState)");
}
async function openManager() {
  await ev("window.__naimageDebugSetViewport({x:20,y:20,scale:0.65})");
  const point = await ev("(()=>{const r=document.querySelector('.workflow-canvas').getBoundingClientRect();for(let y=r.top+36;y<r.bottom-100;y+=55)for(let x=r.right-45;x>r.left+70;x-=65){const e=document.elementFromPoint(x,y);if(e?.closest('.workflow-canvas')&&!e.closest('.flow-node,button,.canvas-plugin-toolbar,.canvas-context-menu'))return {x,y};}return null})()");
  assert.ok(point); for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...point, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 });
  await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.trim()==='创建生图工作')");
  await ev("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='创建生图工作').dataset.runtimeMenu='current'"); await click('[data-runtime-menu="current"]');
  await wait("Boolean(document.querySelector('.manual-image-task-dialog'))"); await choose('[aria-label="图片执行连接"]', "comfyui");
  await click('[data-comfyui-runtime-manager-entry] > summary'); await wait("Boolean(document.querySelector('[data-comfyui-runtime-manager]'))");
}

try {
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [], layoutGroups: [], messages: [], activeConversationId: "runtime-conversation", conversations: [{ id: "runtime-conversation", title: "托管环境验证", messages: [] }] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: projectId, projects: [{ id: projectId, name: "安装平台验证", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  writeFileSync(join(runDir, "no-server.cjs"), "process.exit(0);\n");
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token", accountBaseUrl: accountBase, serverUrl: accountBase, relayBaseUrl: accountBase, updateBaseUrl: accountBase, agentModel: "fixture-chat", agentModelPool: ["fixture-chat"], imageModel: "fixture-image", imageModelPool: ["fixture-image"], glassTheme: "light-classic", agentPanelWidth: 350 }));
  const vitePort = await allocateDebugPort(); devUrl = `http://127.0.0.1:${vitePort}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [vite.stdout, vite.stderr]) stream.on("data", bytes => appendFileSync(join(runDir, "vite.log"), bytes));
  await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 }); await launch();
  let manifestId, planId, jobId, runtimeId, originalConnectionId, aliasConnectionId;
  await check("native manifest import and zero-network plan display complete metadata", async () => {
    await openManager(); assert.equal(downloads.length, 0);
    originalConnectionId = await ev("document.querySelector('[aria-label=\"ComfyUI 连接\"]').value");
    selectFile(manifestPath); await button("导入安装清单");
    await wait("document.querySelector('[data-comfyui-runtime-status]')?.textContent.includes('安装清单已导入')");
    manifestId = await ev("document.querySelector('[aria-label=\"ComfyUI 安装清单\"]').value");
    await button("生成安装计划"); await wait("Boolean(document.querySelector('[data-comfyui-runtime-plan]'))");
    planId = await ev("document.querySelector('[data-comfyui-runtime-plan]').dataset.planId");
    const text = await ev("document.querySelector('[data-comfyui-runtime-plan]').textContent");
    for (const value of ["Fixture-only-MIT", "127.0.0.1", "CPU", "下载", "展开", "显存", "所需磁盘"]) assert.ok(text.toLowerCase().includes(value.toLowerCase()), value);
    assert.equal(downloads.length, 0); await screenshot("plan-metadata", '[data-comfyui-runtime-artifacts]');
    await client.send("Emulation.setDeviceMetricsOverride", { width: 884, height: 640, deviceScaleFactor: 1, mobile: false }); await delay(150);
    await screenshot("plan-minimum-window", '[data-comfyui-runtime-artifacts]');
    await ev("[...document.querySelector('[data-comfyui-runtime-manager]').querySelectorAll('button')].find(e=>e.textContent.trim()==='审核并安装').dataset.runtimeInstall='current'");
    await screenshot("plan-consent-boundary-minimum", '[data-runtime-install="current"]');
  });
  await check("canceled Main consent and forged CLI authorization perform no download", async () => {
    consent(0); await button("审核并安装"); await wait("document.querySelector('[data-comfyui-runtime-status]')?.textContent.includes('已取消')"); assert.equal(downloads.length, 0);
    const forged = await command("comfyui.runtime.install", { planId, confirmed: true }, false); assert.equal(forged.ok, false); assert.equal(downloads.length, 0);
  });
  await check("actual GUI installs, pauses and resumes the same authorized Range job", async () => {
    consent(1); await button("审核并安装"); await wait("Boolean(document.querySelector('[data-job-id]'))"); jobId = await ev("document.querySelector('[data-job-id]').dataset.jobId");
    await until(() => downloads.length > 0, "download started"); await delay(350); await button("暂停下载");
    await wait(`document.querySelector('[data-job-id="${jobId}"]')?.dataset.jobState==='paused'`); await screenshot("paused-download", `[data-job-id="${jobId}"]`);
    const alias = await ev("window.naimageServer.comfyui({action:'connections-save',label:'Installing endpoint alias fixture',networkScope:'local',baseUrl:'http://localhost:18188',credentialType:'none',confirmed:true})");
    assert.equal(alias.ok, true); aliasConnectionId = alias.connection.connectionId;
    const template = (await command("comfyui.templates")).result.templates.find(item => item.id === "stock-generate");
    const denied = await ev(`window.naimageServer.generateImage(${JSON.stringify({ provider: "comfyui", projectId, conversationId: "runtime-conversation", operationId: "during-install", runId: "during-install", prompt: "installation admission fixture", size: "512x512", quality: "high", count: 1, comfyui: { connectionId: alias.connection.connectionId, templateId: template.id, templateHash: template.templateHash, checkpoint: "fixture.safetensors", seed: 1, width: 512, height: 512 } })})`);
    assert.equal(denied.ok, false); assert.equal(denied.errorCode, "COMFYUI_RUNTIME_BUSY");
    assert.equal(existsSync(join(project, ".naimage/image-operations/journal.json")), false, "temporary runtime rejects generation before journal submission or network");
    await button("继续安装"); await wait(`document.querySelector('[data-job-id="${jobId}"]')?.dataset.jobState==='completed'`);
    assert.ok(downloads.some(item => item.offset > 0 && item.ifRange === '"fixture-runtime-v1"'), "Range uses original ETag");
    const result = await command("comfyui.runtime.list"); runtimeId = result.result.runtimes[0].runtimeId;
    const managedConnectionId = result.result.runtimes[0].connectionId;
    await wait(`[...document.querySelector('[aria-label="ComfyUI 连接"]').options].some(e=>e.value===${JSON.stringify(managedConnectionId)})`);
    assert.equal(await ev("document.querySelector('[aria-label=\"ComfyUI 连接\"]').value"), originalConnectionId, "new runtime never silently switches the execution connection");
    await choose('[aria-label="ComfyUI 运行环境目标"]', runtimeId); await screenshot("installed-runtime", '[data-comfyui-runtime-selected]');
    assert.equal((await command("comfyui.runtime.install", { planId })).result.job.jobId, jobId); assert.equal(downloads.length, 2);
  });
  await check("start cancellation, explicit start and targeted stop use owned stub process", async () => {
    consent(0); await button("启动环境"); await wait("document.querySelector('[data-comfyui-runtime-status]')?.textContent.includes('已取消')");
    consent(1); await button("启动环境"); await wait("document.querySelector('[data-comfyui-runtime-selected]')?.textContent.includes('运行中')"); await screenshot("running-runtime", '[data-comfyui-runtime-selected]');
    const runtimeResult = await command("comfyui.runtime.status", { runtimeId });
    const journalDirectory = join(project, ".naimage/image-operations"); mkdirSync(journalDirectory, { recursive: true });
    const journalPath = join(journalDirectory, "journal.json"); assert.equal(existsSync(journalPath), false);
    writeFileSync(journalPath, JSON.stringify({ schemaVersion: 1, revision: 1, operations: [{ projectId, key: "fixture:1", operationId: "fixture", requestIndex: 1, state: "submitted", provider: "comfyui", comfyui: { connectionId: runtimeResult.result.runtime.connectionId }, assets: [], slots: [] }] }));
    const blocked = await command("comfyui.runtime.stop", { runtimeId }, false); assert.equal(blocked.ok, false); assert.ok(JSON.stringify(blocked).includes("COMFYUI_RUNTIME_BUSY"));
    assert.equal(readFileSync(processLog, "utf8").trim().split("\n").map(JSON.parse).filter(e => e.event === "exit").length, 1, "unknown submission blocks stop without killing the process");
    const alias = await ev(`window.naimageServer.comfyui({action:'connections-save',connectionId:${JSON.stringify(aliasConnectionId)},label:'Loopback alias fixture',networkScope:'local',baseUrl:'http://localhost:18188',credentialType:'none',confirmed:true})`);
    assert.equal(alias.ok, true); const aliasId = alias.connection.connectionId;
    const aliasProfile = JSON.parse(readFileSync(join(config, "comfyui-connections.json"), "utf8")).profiles.find(item => item.id === aliasId);
    const aliasHash = require("../runtime/image-generation/comfyui-executor.cjs").connectionHash(aliasProfile);
    writeFileSync(journalPath, JSON.stringify({ schemaVersion: 1, revision: 2, operations: [{ projectId, key: "fixture:1", operationId: "fixture", requestIndex: 1, state: "accepted", provider: "comfyui", comfyui: { connectionId: aliasId, connectionHash: aliasHash }, assets: [], slots: [] }] }));
    assert.equal((await command("comfyui.runtime.stop", { runtimeId }, false)).ok, false, "a localhost alias uses the same managed loopback process");
    await ev(`window.naimageServer.comfyui({action:'connections-save',connectionId:${JSON.stringify(aliasId)},label:'Drift fixture',networkScope:'local',baseUrl:'http://localhost:18189',credentialType:'none',confirmed:true})`);
    assert.equal((await command("comfyui.runtime.stop", { runtimeId }, false)).ok, false, "frozen connection drift fails closed");
    writeFileSync(journalPath, JSON.stringify({ schemaVersion: 1, revision: 2, operations: [] }));
    await button("停止环境"); await wait("document.querySelector('[data-comfyui-runtime-selected]')?.textContent.includes('已停止')");
    const processEvents = readFileSync(processLog, "utf8").trim().split("\n").map(JSON.parse); assert.equal(processEvents.filter(e => e.event === "spawn").length, 2); assert.equal(processEvents.filter(e => e.event === "exit").length, 2);
    report.processEvents = processEvents;
  });
  await check("native existing-runtime registration preserves source bytes and deduplicates directory", async () => {
    const before = files.map(([file]) => [file, hash(readFileSync(join(portable, file)))]);
    selectFile(portable); await button("登记已有环境"); await wait("document.querySelector('[data-comfyui-runtime-status]')?.textContent.includes('已有环境已登记')");
    const existingId = await ev("document.querySelector('[aria-label=\"ComfyUI 运行环境目标\"]').value");
    await screenshot("existing-runtime", '[data-comfyui-runtime-selected]');
    selectFile(portable); await button("登记已有环境"); await wait("!document.querySelector('[data-comfyui-runtime-manager] button').disabled");
    assert.equal(await ev("document.querySelector('[aria-label=\"ComfyUI 运行环境目标\"]').value"), existingId);
    const result = await command("comfyui.runtime.list"); assert.equal(result.result.runtimes.filter(item => item.mode === "existing").length, 1);
    assert.deepEqual(files.map(([file]) => [file, hash(readFileSync(join(portable, file)))]), before);
  });
  await check("normal restart preserves runtime and completed job without repeated download", async () => {
    await stop(); await launch(); await openManager(); await choose('[aria-label="ComfyUI 运行环境目标"]', runtimeId);
    await wait(`document.querySelector('[data-job-id="${jobId}"]')?.dataset.jobState==='completed'`); await screenshot("restart-preserved-runtime", '[data-comfyui-runtime-selected]');
    const result = await command("comfyui.runtime.status", { runtimeId }); assert.equal(result.result.runtime.runtimeId, runtimeId); assert.equal(downloads.length, 2);
    assert.equal(JSON.stringify(result).includes("python.exe"), false); assert.equal(JSON.stringify(result).includes(runDir), false);
    assert.equal(existsSync(join(project, "models")), false); assert.equal(existsSync(join(project, "python_embeded")), false);
  });
  await stop(); assert.equal(report.unexpectedModelRequests || 0, 0); report.downloads = downloads; report.ok = true; delete report.current; checkpoint();
} catch (error) { report.error = error.stack || String(error); checkpoint(); process.exitCode = 1; }
finally { if (electron) await stop().catch(error => { report.shutdownError = String(error); }); client?.close(); vite?.kill(); artifactServer.closeAllConnections(); account.closeAllConnections(); await Promise.all([new Promise(done => artifactServer.close(done)), new Promise(done => account.close(done))]); checkpoint(); console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, screenshots: report.screenshots.length, report: join(runDir, "report.json"), error: report.error }, null, 2)); }
