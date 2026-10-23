import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, "..");
const { createMockServer, objectInfo } = require("./comfyui-executor-selftest.cjs");
const { builtIn } = require("../desktop/comfyui-template-service.cjs");
const runDir = join(root, ".diagnostics", `comfyui-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project"), projectId = "comfyui-ui-project";
for (const dir of [config, join(project, "assets")]) mkdirSync(dir, { recursive: true });
const report = { ok: false, fixture: "Existing real product photo returned by a loopback ComfyUI mock; no new model generation", realModelRequests: 0, checks: [], screenshots: [], shutdowns: [] };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const image = await sharp(join(root, "docs/assets/github/02-product.jpg")).resize(512, 512).png().toBuffer();
const sourceFile = join(project, "assets/source.png"); writeFileSync(sourceFile, image);
const sourceHash = digest(image), source = { type: "file", path: sourceFile, relativePath: "assets/source.png", assetId: `asset-${sourceHash.slice(0, 32)}`, occurrenceId: `occ-${"1".repeat(32)}`, contentHash: sourceHash, mimeType: "image/png", width: 512, height: 512 };
const capabilityInfo = objectInfo();
// Put non-default choices first so inspection cannot accidentally change the
// reviewed template's default sampler or scheduler.
capabilityInfo.KSampler.input.required.sampler_name = [["dpmpp_2m", "euler"]];
capabilityInfo.KSampler.input.required.scheduler = [["karras", "normal"]];
const mock = await createMockServer({ events: true, objectInfo: capabilityInfo, output: { "9": { images: [{ filename: "product.png", subfolder: "fixtures", type: "output" }] } } }, image);
const account = createServer((req, res) => {
  const forbidden = req.method === "POST" && /\/v1\/(images|responses|chat)/.test(req.url);
  if (forbidden) { report.unexpectedModelRequests = (report.unexpectedModelRequests || 0) + 1; checkpoint(); }
  res.writeHead(forbidden ? 500 : 200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url === "/v1/models" ? { data: [{ id: "fixture-chat" }, { id: "fixture-cloud-image" }] }
    : { success: true, data: { id: 1, username: "local-fixture", quota: 100000, items: [] } }));
});
await new Promise(resolveListen => account.listen(0, "127.0.0.1", resolveListen));
const accountBase = `http://127.0.0.1:${account.address().port}`;
let vite, electron, client, devUrl;
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => waitForRuntimeExpression(client, expression, { evaluate: evaluateRuntime, timeoutMs: 25000, intervalMs: 80 });
const state = () => ev("window.__naimageDebugAgentState()");
const session = () => JSON.parse(readFileSync(join(project, "session.json"), "utf8"));
const journal = () => JSON.parse(readFileSync(join(project, ".naimage/image-operations/journal.json"), "utf8"));
async function until(predicate, name, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (await predicate()) return; await delay(90); } throw new Error(`Timeout: ${name}`); }
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); }
async function command(command, args = {}, expectOk = true) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const value = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: JSON.stringify({ command, args, timeoutMs: 20000 }), signal: AbortSignal.timeout(25000) })).json();
  if (expectOk) assert.equal(value.ok, true, `${command}: ${JSON.stringify(value).slice(0, 700)}`);
  return expectOk ? value.result : value;
}
async function rect(selector) { return ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()`); }
async function mouse(type, point, options = {}) { await client.send("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, ...options }); }
async function click(selector) {
  await ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);
  const r = await rect(selector); assert.ok(r, selector); const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  assert.equal(await ev(`Boolean(document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)}))`), true, `visible clickable ${selector}`);
  await mouse("mousePressed", p); await mouse("mouseReleased", p); await delay(70);
}
async function key(key, modifiers = 0) { const names = { Home: ["Home", 36], Enter: ["Enter", 13], Escape: ["Escape", 27], ArrowDown: ["ArrowDown", 40] }; const [code, vk] = names[key] || [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)]; for (const type of ["keyDown", "keyUp"]) await client.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }); }
async function fill(selector, text) { await click(selector); await key("a", 2); await client.send("Input.insertText", { text }); await wait(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`); }
async function choose(selector, value) { const index = await ev(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(o=>o.value===${JSON.stringify(value)})`); assert.ok(index >= 0, value); await click(selector); await key("Home"); for (let i = 0; i < index; i++) await key("ArrowDown"); await key("Enter"); await wait(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`); }
async function textButton(text, scope = "document") {
  await ev(`(()=>{const e=[...${scope}.querySelectorAll('button,[role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('missing button '+${JSON.stringify(text)});e.dataset.comfyAction='current'})()`);
  await click('[data-comfy-action="current"]'); await ev("document.querySelector('[data-comfy-action=current]')?.removeAttribute('data-comfy-action')");
}
async function screenshot(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`), { captureBeyondViewport: false }); report.screenshots.push(`${name}.png`); }
async function assertReachable(selector, name = selector) {
  await ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`); await delay(70);
  const geometry = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
  assert.ok(geometry, name);
  assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height, `${name}: within window after scrolling`);
  assert.equal(await ev(`Boolean(document.elementFromPoint(${(geometry.x+geometry.right)/2},${(geometry.y+geometry.bottom)/2})?.closest(${JSON.stringify(selector)}))`), true, `${name}: visible and unobstructed`);
  (report.reachableControls ||= []).push({ name, ...geometry });
}
async function connectionManager(open) {
  if (await ev("Boolean(document.querySelector('[data-comfyui-connection-manager]')?.open)") !== open) await click('[data-comfyui-connection-manager] > summary');
  await wait(`Boolean(document.querySelector('[data-comfyui-connection-manager]')?.open)===${open}`);
}
async function assertManualLayout(name) {
  const geometry = await ev("(()=>{const body=document.querySelector('.manual-image-task-body'), prompt=body.querySelector('.manual-image-task-prompt'), label=prompt.querySelector('.ui-field-label').getBoundingClientRect(), input=prompt.querySelector('textarea').getBoundingClientRect(), summary=body.querySelector('.manual-image-task-summary').getBoundingClientRect(), reference=body.querySelector('.manual-image-reference-row').getBoundingClientRect(), children=[...body.children].filter(e=>e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom}});return {labelBottom:label.bottom,promptTop:input.top,promptBottom:input.bottom,promptHeight:input.height,summaryTop:summary.top,referenceHeight:reference.height,overflow:body.scrollWidth>body.clientWidth+1,gaps:children.slice(1).map((r,i)=>r.top-children[i].bottom)}})()");
  assert.ok(geometry.promptTop >= geometry.labelBottom, `${name}: prompt below its label`);
  assert.ok(geometry.summaryTop >= geometry.promptBottom, `${name}: summary below complete prompt`);
  assert.ok(geometry.promptHeight >= 149 && geometry.referenceHeight <= 42, `${name}: useful prompt space and compact reference row`);
  assert.equal(geometry.overflow, false, `${name}: no horizontal overflow`);
  assert.ok(geometry.gaps.every(value => value >= 8 && value <= 12), `${name}: body fields do not overlap or leave expanded gaps`);
  (report.formLayouts ||= []).push({ name, ...geometry });
}
async function captureManualFields(name) {
  await ev("document.activeElement?.blur();document.querySelector('.manual-image-task-body').scrollTop=0"); await delay(100);
  for (const selector of ['[aria-label="ComfyUI 连接"]', '[aria-label="ComfyUI 模板"]', '[aria-label="ComfyUI 模型"]']) await assertReachable(selector, `${name}: ${selector}`);
  await screenshot(name);
}
async function samplingFields() {
  return ev("Object.fromEntries(['steps','cfg','sampler','scheduler','denoise'].map(name=>{const e=document.querySelector('[aria-label=\"ComfyUI '+name+'\"]');return [name,{value:e?.value,disabled:e?.disabled,min:e?.min,max:e?.max}]}))");
}
async function assertSamplingControlsReachable() {
  for (const name of ["steps", "cfg", "sampler", "scheduler", "denoise"]) {
    const selector = `[aria-label="ComfyUI ${name}"]`;
    await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`); await delay(70);
    const geometry = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {disabled:e.disabled,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
    assert.equal(geometry.disabled, false, `${name}: usable after inspect`);
    assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height, `${name}: within window after scrolling`);
    assert.equal(await ev(`Boolean(document.elementFromPoint(${(geometry.x+geometry.right)/2},${(geometry.y+geometry.bottom)/2})?.closest(${JSON.stringify(selector)}))`), true, `${name}: pointer can reach control`);
  }
}
async function canvasMenu(text) {
  await key("Escape");
  await ev("window.__naimageDebugSetViewport({x:20,y:20,scale:0.65})"); await delay(150);
  const p = await ev("(()=>{const r=document.querySelector('.workflow-canvas').getBoundingClientRect();for(let y=r.top+36;y<r.bottom-100;y+=55)for(let x=r.right-45;x>r.left+70;x-=65){const e=document.elementFromPoint(x,y);if(e?.closest('.workflow-canvas')&&!e.closest('.flow-node,button,.canvas-plugin-toolbar,.canvas-context-menu,.image-container-quick-actions'))return {x,y};}return null})()");
  assert.ok(p, "visible blank canvas point");
  await mouse("mousePressed", p, { button: "right", buttons: 2 }); await mouse("mouseReleased", p, { button: "right" });
  await wait(`Array.from(document.querySelectorAll('[role=menuitem]')).some(e=>e.textContent.trim()===${JSON.stringify(text)})`); await textButton(text);
}
async function openRecovery() { await canvasMenu("恢复图片结果"); await wait("Boolean(document.querySelector('.image-recovery-dialog'))"); }
async function stop() {
  if (!electron) return;
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {}); client?.close(); client = null;
  const exited = await waitForChildExit(electron, 15000); report.shutdowns.push({ exited, exitCode: electron.exitCode, forced: false });
  assert.equal(exited, true); assert.equal(electron.exitCode, 0); electron = null;
}
async function launch() {
  const port = await allocateDebugPort();
  electron = spawn(require("electron"), ["electron-main.cjs", `--remote-debugging-port=${port}`, `--user-data-dir=${join(runDir, "user-data")}`], { cwd: root, windowsHide: true, stdio: "ignore",
    env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1", NAIMAGE_CONFIG_DIR: config,
      NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") } });
  const target = await pollForDebugTarget({ port, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await wait("Boolean(document.querySelector('.project-agent-composer textarea')&&window.__naimageDebugAgentState)");
}

try {
  const fixedSamplingTemplate = { ...builtIn("generate"), id: "ui-fixed-sampling", label: "固定采样参数模板", builtIn: false };
  fixedSamplingTemplate.inputMappings = fixedSamplingTemplate.inputMappings.filter(mapping => !["steps", "cfg", "sampler", "scheduler", "denoise"].includes(mapping.kind));
  writeFileSync(join(config, "comfyui-templates.json"), JSON.stringify({ version: 1, templates: [fixedSamplingTemplate] }));
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [{ id: "N0001", title: "商品原图", type: "image", status: "done", imageState: "done", x: 40, y: 40, width: 320, height: 320, assets: [source], outputs: 1 }], layoutGroups: [], messages: [], activeConversationId: "comfyui-ui-conversation", conversations: [{ id: "comfyui-ui-conversation", title: "本地图片任务验证", messages: [] }] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: projectId, projects: [{ id: projectId, name: "ComfyUI 本地任务验证", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  writeFileSync(join(runDir, "no-server.cjs"), "process.exit(0);\n");
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token", accountBaseUrl: accountBase, serverUrl: accountBase, relayBaseUrl: accountBase, updateBaseUrl: accountBase,
    agentModel: "fixture-chat", agentModelPool: ["fixture-chat"], imageModel: "fixture-cloud-image", imageModelPool: ["fixture-cloud-image"], imageCount: 1, imageRatio: "1:1", imageResolution: "1K", imageQuality: "high", glassTheme: "light-classic", agentPanelWidth: 350 }));
  const vitePort = await allocateDebugPort(); devUrl = `http://127.0.0.1:${vitePort}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const output of [vite.stdout, vite.stderr]) output.on("data", value => appendFileSync(join(runDir, "vite.log"), value));
  await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 }); await launch();

  let generated, options, submittedPrompt = "橙色便携音箱商品摄影，保留编织纹理与明亮的背景层次。";
  const expectedSampling = { steps: 28, cfg: 6.5, sampler: "dpmpp_2m", scheduler: "karras", denoise: 0.8 };
  await check("uninspected form shows template defaults and explicitly disables parameters absent from a reviewed mapping", async () => {
    await canvasMenu("创建生图工作"); await wait("Boolean(document.querySelector('.manual-image-task-dialog'))");
    await choose('[aria-label="图片执行连接"]', "comfyui"); await wait("document.querySelector('[aria-label=\"ComfyUI 模板\"]')?.options.length===3");
    assert.equal(await ev("document.querySelector('.comfyui-task-fields').dataset.comfyuiInspected"), "false");
    assert.equal(await ev("document.querySelector('.comfyui-task-fields').textContent.includes('尚未检查连接能力')"), true);
    let fields = await samplingFields();
    assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.value])), { steps: "20", cfg: "7", sampler: "euler", scheduler: "normal", denoise: "1" });
    assert.equal(fields.sampler.disabled, true); assert.equal(fields.scheduler.disabled, true);
    await captureManualFields("local-template-uninspected-defaults");
    await fill('[aria-label="ComfyUI steps"]', "28"); await fill('[aria-label="ComfyUI cfg"]', "6.5"); await fill('[aria-label="ComfyUI denoise"]', "0.8");
    await choose('[aria-label="ComfyUI 模板"]', "ui-fixed-sampling");
    fields = await samplingFields();
    for (const field of ["steps", "cfg", "sampler", "scheduler", "denoise"]) assert.equal(fields[field].disabled, true, `${field}: template has no mapping`);
    assert.equal(fields.steps.value, "20"); assert.equal(fields.cfg.value, "7"); assert.equal(fields.denoise.value, "1");
    await captureManualFields("local-template-fixed-sampling-disabled");
    await choose('[aria-label="ComfyUI 模板"]', "stock-generate");
    assert.equal(mock.posts.length, 0);
  });
  await check("connection manager saves and selects profiles without networking and makes LAN/remote boundaries visible", async () => {
    await connectionManager(true);
    await fill('[aria-label="ComfyUI 连接名称"]', "UI loopback fixture");
    await fill('[aria-label="ComfyUI 地址"]', mock.baseUrl);
    const beforeGets = mock.gets.length;
    await textButton("保存连接");
    await wait("Boolean(document.querySelector('[aria-label=\"ComfyUI 连接\"]').value)");
    await wait("document.querySelector('.comfyui-task-fields').textContent.includes('连接已保存')");
    const localId = await ev("document.querySelector('[aria-label=\"ComfyUI 连接\"]').value");
    await assertReachable('[aria-label="ComfyUI 地址"]');
    await screenshot("connection-local-manager");
    const modes = await ev("[...document.querySelector('[aria-label=\"ComfyUI 认证方式\"]').options].map(option=>option.value)");
    assert.deepEqual(modes, ["none", "bearer", "basic", "mtls"]);
    const inputDescriptions = await ev("[...document.querySelector('[data-comfyui-connection-manager]').querySelectorAll('input,textarea')].map(input=>({label:input.getAttribute('aria-label'),type:input.type,name:input.name}))");
    assert.equal(inputDescriptions.some(input => input.type === "password" || /credential|token|secret|password|凭据引用/i.test(`${input.label} ${input.name}`)), false);
    await choose('[aria-label="ComfyUI 认证方式"]', "bearer"); await textButton("保存连接");
    await wait("document.querySelector('[aria-label=\"ComfyUI 认证方式\"]').value==='bearer'&&!document.querySelector('[data-comfyui-connection-manager] button').disabled");
    await textButton("测试连接");
    await wait("document.querySelector('.comfyui-task-fields').textContent.includes('请先导入所选认证方式的凭据')");
    assert.equal(mock.gets.length, beforeGets, "metadata save and missing-credential rejection make no requests");
    await assertReachable('[aria-label="ComfyUI 认证方式"]'); await screenshot("connection-native-credential-boundary");
    await choose('[aria-label="ComfyUI 认证方式"]', "none"); await textButton("保存连接");
    const scopes = [];
    for (const [scope, baseUrl] of [["lan", "http://192.168.56.77:8188"], ["remote", "https://comfyui.example.invalid"]]) {
      await textButton("新增连接");
      await fill('[aria-label="ComfyUI 连接名称"]', `UI ${scope} metadata only`);
      await choose('[aria-label="ComfyUI 网络范围"]', scope); await fill('[aria-label="ComfyUI 地址"]', baseUrl); await textButton("保存连接");
      await wait(`Boolean(document.querySelector('[data-comfyui-network-scope="${scope}"]'))`);
      await connectionManager(false); await assertReachable(`[data-comfyui-network-scope="${scope}"]`);
      const boundary = await ev(`document.querySelector('[data-comfyui-network-scope="${scope}"]').textContent`);
      assert.ok(boundary.includes("不属于严格离线")); scopes.push({ scope, boundary, tested: false, connectionId: await ev("document.querySelector('[aria-label=\"ComfyUI 连接\"]').value") }); await screenshot(`connection-${scope}-boundary`);
      await connectionManager(true);
    }
    assert.equal(mock.gets.length, beforeGets, "scope changes and profile selection do not test a service");
    const deletedId = scopes.find(item => item.scope === "remote").connectionId;
    await command("comfyui.connection.delete", { connectionId: deletedId, confirmed: true });
    await choose('[aria-label="图片执行连接"]', "current"); await choose('[aria-label="图片执行连接"]', "comfyui");
    await wait("document.querySelector('.comfyui-task-fields').textContent.includes('原 ComfyUI 连接不可用')");
    assert.equal(await ev("document.querySelector('[aria-label=\"ComfyUI 连接\"]').value"), deletedId, "a missing saved profile is never silently replaced by the first configured connection");
    await assertReachable('[aria-label="ComfyUI 连接"]');
    assert.equal(await ev("document.querySelector('[aria-label=\"ComfyUI 连接\"]').selectedOptions[0].textContent"), "连接不可用 · 请重新选择");
    await assertReachable('[data-comfyui-network-scope="unknown"]');
    assert.equal(mock.gets.length, beforeGets, "a missing connection does not contact the default service");
    report.missingConnection = { preservedId: deletedId, automaticFallback: false, requests: 0 };
    await choose('[aria-label="ComfyUI 连接"]', localId);
    await assertReachable('[data-comfyui-network-scope="local"]');
    const publicResult = await ev("window.naimageServer.comfyui({action:'connections-list'})");
    assert.equal(publicResult.ok, true); assert.equal(JSON.stringify(publicResult).includes("credentialRef"), false);
    report.connectionManagement = { localId, scopes, credentialModes: modes, inputDescriptions, nonLoopbackTests: 0, metadataOnlyRequests: mock.gets.length - beforeGets };
  });
  await check("actual sampled controls materialize one reviewed prompt and persist exact metadata and journal parameters", async () => {
    await connectionManager(true);
    await fill('[aria-label="ComfyUI 地址"]', mock.baseUrl); await textButton("检查环境");
    await wait("document.querySelector('[aria-label=\"ComfyUI 模型\"]').value==='fixture.safetensors'");
    let fields = await samplingFields();
    assert.equal(fields.sampler.value, "euler"); assert.equal(fields.scheduler.value, "normal", "inspect keeps the reviewed template default instead of the first capability choice");
    assert.equal(fields.sampler.disabled, false); assert.equal(fields.scheduler.disabled, false);
    assert.deepEqual(await ev("[...document.querySelector('[aria-label=\"ComfyUI sampler\"]').options].map(option=>option.value).sort()"), ["dpmpp_2m", "euler"]);
    assert.deepEqual(await ev("[...document.querySelector('[aria-label=\"ComfyUI scheduler\"]').options].map(option=>option.value).sort()"), ["karras", "normal"]);
    await fill('[aria-label="ComfyUI 地址"]', `${mock.baseUrl}/`);
    assert.equal(await ev("document.querySelector('.comfyui-task-fields').dataset.comfyuiInspected"), "false", "address edits clear old inspect data");
    assert.equal((await samplingFields()).sampler.disabled, true);
    await fill('[aria-label="ComfyUI 地址"]', mock.baseUrl); await textButton("检查环境");
    await wait("document.querySelector('.comfyui-task-fields').dataset.comfyuiInspected==='true'");
    await connectionManager(false);
    await choose('[aria-label="ComfyUI sampler"]', "dpmpp_2m"); await choose('[aria-label="ComfyUI scheduler"]', "karras");
    await fill('[aria-label="ComfyUI steps"]', "28"); await fill('[aria-label="ComfyUI cfg"]', "6.5"); await fill('[aria-label="ComfyUI denoise"]', "0.8");
    await fill('[aria-label="ComfyUI 宽度"]', "512"); await fill('[aria-label="ComfyUI 高度"]', "512"); await fill('[aria-label="ComfyUI 种子"]', "-1");
    await fill(".manual-image-task-prompt textarea", submittedPrompt); await assertManualLayout("local-template");
    await captureManualFields("local-template-settings"); await click(".manual-image-task-prompt textarea"); await screenshot("local-template-prompt");
    await textButton("生成图片"); await wait("!document.querySelector('.manual-image-task-dialog')");
    await until(() => { const nodes = session().nodes.filter(node => node.assets?.length && node.imageParams?.provider === "comfyui"); if (!nodes.length) return false; generated = nodes[0]; return generated.imageState === "done"; }, "generated photo saved");
    assert.equal(mock.posts.length, 1); assert.equal(mock.views.length, 1); assert.equal(digest(readFileSync(generated.assets[0].path)), sourceHash);
    options = generated.imageParams.comfyui; const metadata = generated.assets[0].generation;
    assert.ok(options.connectionId); assert.equal(options.baseUrl, undefined, "new project tasks persist a profile ID without an endpoint URL");
    assert.equal(metadata.request.connectionId, options.connectionId); assert.equal(metadata.request.networkScope, "local");
    assert.equal(metadata.response.connectionId, options.connectionId); assert.equal(metadata.response.networkScope, "local");
    assert.ok(generated.imageParams.submissionId); assert.equal(generated.imageParams.model, "fixture.safetensors"); assert.equal(generated.imageParams.size, "512x512");
    assert.equal(metadata.request.protocol, "comfyui"); assert.equal(metadata.request.quality, undefined); assert.ok(metadata.request.seed >= 0); assert.equal(metadata.response.seed, metadata.request.seed);
    const submittedSampler = mock.posts[0].prompt["3"].inputs;
    assert.deepEqual({ steps: submittedSampler.steps, cfg: submittedSampler.cfg, sampler: submittedSampler.sampler_name, scheduler: submittedSampler.scheduler, denoise: submittedSampler.denoise }, expectedSampling);
    const operation = journal().operations.find(item => item.operationId === `comfy-${generated.imageParams.submissionId}`);
    assert.ok(operation);
    for (const [field, value] of Object.entries(expectedSampling)) {
      assert.equal(options[field], value, `${field}: saved task draft`);
      assert.equal(metadata.request[field], value, `${field}: request metadata`);
      assert.equal(metadata.response[field], value, `${field}: response metadata`);
      assert.equal(operation.comfyui.actualParams[field], value, `${field}: journal actual parameters`);
    }
    assert.match(operation.comfyui.workflowHash, /^[a-f0-9]{64}$/);
    report.samplingParameters = { expected: expectedSampling, materialized: submittedSampler, journal: operation.comfyui.actualParams, requestMetadata: metadata.request };
    await command("canvas.select", { expectedProjectId: projectId, ids: [generated.id] }); await screenshot("local-photo-result");
  });

  await check("actual result editor shows local checkpoint seed steps and sampler without cloud quality claims", async () => {
    await ev(`window.__naimageDebugSetViewport({x:${80-generated.x*.65},y:${130-generated.y*.65},scale:0.65})`); await delay(150);
    const selector = `.flow-node[data-node-id="${generated.id}"] .node-title-block`, r = await rect(selector); assert.ok(r);
    const p = { x: r.x+Math.min(70,r.width/2), y: r.y+r.height/2 };
    assert.equal(await ev(`Boolean(document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)}))`), true, "visible result title");
    await mouse("mousePressed", p, { button: "right", buttons: 2 }); await mouse("mouseReleased", p, { button: "right" });
    await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.trim()==='编辑成果')");
    await textButton("编辑成果"); await wait("Boolean(document.querySelector('.node-editor-generation-details'))");
    const details = await ev("(()=>{const e=document.querySelector('.node-editor-generation-details');return {source:e.dataset.generationSource,text:e.textContent,params:[...e.querySelectorAll('[data-generation-param]')].map(row=>row.dataset.generationParam)}})()");
    assert.equal(details.source, "ComfyUI 本地执行"); assert.ok(details.text.includes("fixture.safetensors"));
    for (const key of ["seed", "steps", "sampler"]) assert.ok(details.params.includes(key), key);
    for (const key of ["quality", "resolution"]) assert.equal(details.params.includes(key), false, key);
    report.localMetadata = details; await screenshot("local-generation-parameters"); await click('[aria-label="关闭成果编辑器"]');
  });

  await check("stable saved replay preserves one canvas result and changed content leaves original intact", async () => {
    const before = session().nodes.length, assetsBefore = session().nodes.reduce((n, node) => n + (node.assets?.length || 0), 0);
    const args = { expectedProjectId: projectId, prompt: submittedPrompt, submissionId: generated.imageParams.submissionId, comfyui: options, x: 180, y: 100 };
    await command("comfyui.generate", args); await delay(450);
    assert.equal(mock.posts.length, 1); assert.equal(mock.views.length, 1); assert.equal(session().nodes.length, before);
    assert.equal(session().nodes.reduce((n, node) => n + (node.assets?.length || 0), 0), assetsBefore);
    const conflict = await command("comfyui.generate", { ...args, prompt: "改成不同内容" }, false); assert.equal(conflict.ok, false);
    assert.equal(session().nodes.find(node => node.id === generated.id).assets[0].assetId, generated.assets[0].assetId); assert.equal(session().nodes.length, before); assert.equal(mock.posts.length, 1);
  });

  await check("managed image template uploads exact source bytes and persists source relationship and hashes", async () => {
    const templates = (await command("comfyui.templates")).templates, template = templates.find(item => item.id === "stock-img2img");
    await command("comfyui.generate", { expectedProjectId: projectId, prompt: "调整商品摄影的背景层次", submissionId: "ui-img2img", comfyui: { ...options, templateId: template.id, templateHash: template.templateHash }, sources: [{ nodeId: "N0001", assetIndex: 0 }], x: 410, y: 440 });
    await until(() => session().nodes.some(node => node.imageParams?.submissionId === "ui-img2img" && node.assets?.length === 1), "img2img saved");
    const node = session().nodes.find(node => node.imageParams?.submissionId === "ui-img2img");
    assert.equal(mock.uploads.length, 1); assert.ok(mock.uploads[0].includes(image)); assert.equal(node.parentId, "N0001");
    assert.deepEqual(node.assets[0].generation.request.sourceHashes, [sourceHash]); assert.equal(digest(readFileSync(sourceFile)), sourceHash);
    await screenshot("managed-img2img-result");
  });

  let unknown;
  await check("lost acknowledgement persists uncertain state with one POST and no preview assets", async () => {
    mock.config.disconnect = true; mock.config.hold = true;
    await command("comfyui.generate", { expectedProjectId: projectId, prompt: "本地原任务恢复验证", submissionId: "ui-unknown", comfyui: options, x: 740, y: 80 });
    await until(() => journal().operations.some(item => item.operationId === "comfy-ui-unknown"), "unknown receipt");
    unknown = journal().operations.find(item => item.operationId === "comfy-ui-unknown"); assert.equal(unknown.state, "uncertain"); assert.equal(unknown.taskId, "");
    assert.equal(mock.posts.length, 3); assert.equal(mock.views.length, 2);
    await openRecovery(); await wait("document.querySelector('.image-recovery-dialog').textContent.includes('创建结果不确定')"); await screenshot("unknown-submission-receipt"); await textButton("完成");
    await until(() => session().nodes.some(node => node.imageParams?.submissionId === "ui-unknown"), "failed node persisted");
    await stop(); await launch();
  });

  await check("after real Electron restart original history recovers through visible dialog without POST or duplicate assets", async () => {
    const tuple = mock.pending.find(item => item[3].client_id === unknown.comfyui.clientId); assert.ok(tuple); mock.finish(tuple[1], tuple);
    await openRecovery(); await textButton("恢复已有结果", "document.querySelector('.image-recovery-dialog')");
    await until(() => journal().operations.find(item => item.key === unknown.key)?.state === "saved", "recovered operation saved");
    await until(() => session().nodes.some(node => node.imageParams?.submissionId === "ui-unknown" && node.assets?.length === 1), "recovered asset on original canvas node");
    assert.equal(mock.posts.length, 3); assert.equal(mock.views.length, 3); assert.equal(journal().operations.find(item => item.key === unknown.key).providerState, "succeeded");
    const item = session().nodes.find(node => node.imageParams?.submissionId === "ui-unknown"), metadata = item.assets[0].generation;
    assert.equal(metadata.request.protocol, "comfyui"); assert.equal(metadata.request.seed, unknown.comfyui.actualParams.seed); assert.equal(digest(readFileSync(item.assets[0].path)), sourceHash);
    await screenshot("restart-recovery-saved"); await textButton("完成");
    await command("image.recover", { expectedProjectId: projectId, key: unknown.key }); assert.equal(session().nodes.filter(node => node.assets?.some(asset => asset.assetId === item.assets[0].assetId)).length, 1);
  });

  await check("verified pending job is canceled by its visible queue action only", async () => {
    await command("comfyui.generate", { expectedProjectId: projectId, prompt: "取消本地排队验证", submissionId: "ui-cancel", comfyui: options, x: 740, y: 440 });
    const item = journal().operations.find(value => value.operationId === "comfy-ui-cancel"); assert.ok(item);
    const pending = await command("image.recover", { expectedProjectId: projectId, key: item.key }, false); assert.equal(pending.ok, false);
    assert.equal(journal().operations.find(value => value.key === item.key).providerState, "queued");
    await openRecovery(); await textButton("取消本任务排队", "document.querySelector('.image-recovery-dialog')");
    await until(() => journal().operations.find(value => value.key === item.key).state === "canceled", "confirmed queue deletion");
    await wait("document.querySelector('.image-recovery-dialog').textContent.includes('任务已取消')");
    assert.equal(mock.deletes.length, 1); assert.equal(mock.deletes[0].delete.length, 1); assert.equal(mock.posts.length, 4); assert.equal(mock.views.length, 3);
    await screenshot("targeted-queue-canceled"); await textButton("完成");
  });

  await check("minimum supported window keeps template fields prompt and submit visible and reachable", async () => {
    await ev("window.naimageConfig.debugWindowBounds({width:884,height:640})"); await wait("innerWidth===884&&innerHeight===640");
    await canvasMenu("创建生图工作"); await choose('[aria-label="图片执行连接"]', "comfyui"); await wait("Boolean(document.querySelector('[aria-label=\"ComfyUI 地址\"]'))");
    await connectionManager(true);
    await fill('[aria-label="ComfyUI 地址"]', mock.baseUrl); await textButton("检查环境");
    await wait("document.querySelector('.comfyui-task-fields').dataset.comfyuiInspected==='true'");
    await assertReachable('[aria-label="ComfyUI 地址"]'); await screenshot("minimum-connection-manager"); await connectionManager(false);
    await choose('[aria-label="ComfyUI sampler"]', "dpmpp_2m"); await choose('[aria-label="ComfyUI scheduler"]', "karras");
    await fill('[aria-label="ComfyUI steps"]', "28"); await fill('[aria-label="ComfyUI cfg"]', "6.5"); await fill('[aria-label="ComfyUI denoise"]', "0.8");
    await assertSamplingControlsReachable();
    await screenshot("minimum-local-sampling-controls");
    await fill(".manual-image-task-prompt textarea", "最小窗口橙色音箱商品摄影"); await assertManualLayout("minimum-local-template");
    const geometry = await ev("(()=>{const r=document.querySelector('.manual-image-task-dialog').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()");
    assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= 884 && geometry.bottom <= 640); assert.equal(geometry.overflow, false);
    report.minimumWindow = geometry; await captureManualFields("minimum-local-template-controls");
    await click(".manual-image-task-prompt textarea"); await screenshot("minimum-local-template");
    await choose('[aria-label="图片执行连接"]', "current"); await assertManualLayout("minimum-current-image-model");
    await click(".manual-image-task-prompt textarea"); await screenshot("minimum-current-image-model"); await textButton("取消");
    assert.equal(digest(readFileSync(sourceFile)), sourceHash); assert.equal(mock.posts.length, 4); assert.equal(report.unexpectedModelRequests || 0, 0);
  });
  await stop(); report.ok = true;
} catch (error) {
  report.error = error.stack; process.exitCode = 1; console.error(error);
  if (client) { report.failureState = await state().catch(() => null); await screenshot("failure").catch(() => {}); await stop().catch(error => { report.shutdownError = error.message; }); }
} finally {
  report.loopbackPromptPosts = mock.posts.length; report.loopbackViews = mock.views.length; report.loopbackUploads = mock.uploads.length; report.loopbackQueueDeletes = mock.deletes.length;
  checkpoint(); if (vite) vite.kill(); await mock.close(); account.closeAllConnections(); await new Promise(resolveClose => account.close(resolveClose));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, loopbackPromptPosts: report.loopbackPromptPosts, screenshots: report.screenshots.length, realModelRequests: 0, report: join(runDir, "report.json") }));
}
