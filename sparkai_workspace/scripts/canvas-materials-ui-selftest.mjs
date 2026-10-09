import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime as evaluate, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runDir = join(root, ".diagnostics/electron", `canvas-materials-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const projectDir = join(runDir, "project");
const projectId = "canvas-materials-fixture";
const models = ["gpt-image-2", "grok-imagine-image-2.0", "gemini-3.1-flash-image"];
const evidence = { ok: false, checks: {}, screenshots: [], realModelRequests: 0 };
let vite;
let electron;
let client;
let materialIds = [];
const wait = (expression) => waitForRuntimeExpression(client, expression, { evaluate, timeoutMs: 12_000, intervalMs: 80 });
const state = () => evaluate(client, "(() => {const s=window.__naimageDebugAgentState(); return {imageNodeCount:s.imageNodeCount,nodeCount:s.nodeCount,sourceImageCount:s.sourceImageCount,referenceImageCount:s.referenceImageCount,lastDispatchedTaskScope:s.lastDispatchedTaskScope};})()");

async function click(selector, label, right = false) {
  await wait(`Boolean([...document.querySelectorAll(${JSON.stringify(selector)})]${label === undefined ? "[0]" : `.find(el => (el.textContent || '').trim() === ${JSON.stringify(label)})`})`);
  const expression = `(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const element = ${label === undefined ? "all[0]" : `all.find(el => (el.textContent || '').trim() === ${JSON.stringify(label)})`};
    if (!element) return {error:'Missing control: ' + ${JSON.stringify(label || selector)}};
    element.scrollIntoView({block:'nearest'});
    const r = element.getBoundingClientRect();
    const s = getComputedStyle(element);
    const x = r.left+r.width/2, y = r.top+r.height/2;
    const hit = document.elementFromPoint(x,y);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0 || r.width < 12 || r.height < 12 || r.left < -1 || r.top < -1 || r.right > innerWidth+1 || r.bottom > innerHeight+1 || !element.contains(hit)) return {error:'Control is clipped or covered: ' + ${JSON.stringify(label || selector)},rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.className};
    return {x,y};
  })()`;
  const point = await evaluate(client, expression);
  assert.ok(!point.error, JSON.stringify(point));
  const button = right ? "right" : "left";
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button, clickCount: 1 });
  await delay(180);
}

async function screenshot(name) {
  const { data } = await client.send("Page.captureScreenshot", { format: "png" });
  const path = join(runDir, `${name}.png`);
  writeFileSync(path, Buffer.from(data, "base64"));
  evidence.screenshots.push(path);
}

async function openPicker(role) {
  await click(".project-agent-materials-trigger");
  await click(`.project-agent-materials-menu button:nth-child(${role === "source" ? 1 : 2})`);
  await wait("Boolean(document.querySelector('.reference-picker-dialog'))");
  await click(".reference-picker-sources button", "从画布选取");
}

const candidate = (number, index = 0) => `.canvas-material-option[data-canvas-node-id="${materialIds[number - 1]}"][data-canvas-asset-index="${index}"]`;
const nodeTitle = (number) => `.flow-node[data-node-id="${materialIds[number - 1]}"] .node-title-block`;
async function focusMaterialNode(number) {
  await evaluate(client, `window.__naimageAIDebug.selectNode({id:${JSON.stringify(materialIds[number - 1])}})`);
  await delay(800);
}
async function closePicker(save = true) {
  await click(".reference-picker-dialog footer button", save ? "保存" : "取消");
  if (!save) await click('[data-ui-surface="reference-picker-unsaved"] button', "放弃修改");
  await wait("!document.querySelector('.reference-picker-dialog')");
}

async function main() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(projectDir, "output/image"), { recursive: true });
  writeFileSync(join(projectDir, "session.json"), JSON.stringify({ version: 5, nodes: [], messages: [], selectedNodeId: "", selectedNodeIds: [] }));
  writeFileSync(join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: projectId, projects: [{ id: projectId, name: "素材专项", path: projectDir, sessionPath: join(projectDir, "session.json"), external: true }] }));
  writeFileSync(join(configDir, "app-settings.json"), JSON.stringify({ accessMode: "account", serverToken: "fixture-token", serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "fixture-user", imageModel: models[0], imageModelPool: models, themeMode: "dark", themePalette: "classic-black", reduceMotion: true }));
  const [vitePort, debugPort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const url = `http://127.0.0.1:${vitePort}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort)], { cwd: root, stdio: "ignore" });
  await waitForHttpServer(url, { attempts: 120, intervalMs: 100 });
  electron = spawn(process.execPath, [join(root, "node_modules/electron/cli.js"), `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], { cwd: root, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: url, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "0", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_AIDEBUG_AGENT_MODE: "mock", NAIMAGE_CONFIG_DIR: configDir, NAIMAGE_DEBUG_DIR: runDir, NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log") } });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 160, intervalMs: 100, findTarget: (items) => items.find((item) => item.type === "page" && item.url.includes(`:${vitePort}`)), notFoundMessage: "Fixture renderer not found" });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await wait(`window.__naimageDebugAgentState?.().activeProjectId === '${projectId}' && Boolean(window.__naimageAIDebug?.selectNodes) && Boolean(document.querySelector('.project-agent-materials-trigger'))`);
  await evaluate(client, "(async () => { await window.__naimageAIDebug.seedCanvas({count:41,fileBacked:true}); return true; })()");
  await evaluate(client, "window.__naimageAIDebug.fitCanvas()");
  assert.equal((await state()).imageNodeCount, 41);

  await openPicker("source");
  materialIds = await evaluate(client, "[...document.querySelectorAll('.canvas-material-option')].map(el=>el.dataset.canvasNodeId)");
  assert.equal(materialIds.length, 9);
  for (let page = 1; page < 5; page++) {
    await click('.reference-picker-pages button[aria-label="下一页"]');
    materialIds.push(...await evaluate(client, "[...document.querySelectorAll('.canvas-material-option')].map(el=>el.dataset.canvasNodeId)"));
  }
  assert.equal(materialIds.length, 41);
  evidence.fixtureNodeIds = materialIds;
  for (let page = 0; page < 4; page++) await click('.reference-picker-pages button[aria-label="上一页"]');
  await click(candidate(1));
  await screenshot("01-source-canvas-picker");
  const smallBounds = await evaluate(client, "window.naimageConfig.debugWindowBounds({width:884,height:640})");
  assert.equal(smallBounds.ok, true);
  await delay(350);
  await click(".reference-picker-sources button", "返回素材列表");
  await click(".reference-picker-sources button", "从画布选取");
  await screenshot("01b-source-canvas-picker-small");
  const regularBounds = await evaluate(client, "window.naimageConfig.debugWindowBounds({width:1280,height:720})");
  assert.equal(regularBounds.ok, true);
  await delay(350);
  evidence.checks.smallWindowPicker = true;
  await closePicker();
  await evaluate(client, "window.__naimageAIDebug.selectNodes({ids:[],primaryId:''})");
  assert.equal((await state()).sourceImageCount, 1);
  await openPicker("source");
  await click(candidate(2));
  await closePicker(false);
  assert.equal((await state()).sourceImageCount, 1);
  evidence.checks.sourcePickerAndCancel = true;

  await openPicker("reference");
  await click(candidate(2));
  await closePicker();
  await focusMaterialNode(1);
  await click(nodeTitle(1), undefined, true);
  await screenshot("02-node-material-menu");
  await click('.canvas-context-menu button', "添加到参考图");
  assert.equal((await state()).sourceImageCount, 0);
  assert.equal((await state()).referenceImageCount, 2);
  await click(nodeTitle(1), undefined, true);
  await click('.canvas-context-menu button', "添加到参考图");
  assert.equal((await state()).referenceImageCount, 2);
  evidence.checks.nodeMenuRoleAndDedup = true;
  await evaluate(client, `window.__naimageAIDebug.selectNodes({ids:${JSON.stringify(materialIds.slice(0,2))},primaryId:${JSON.stringify(materialIds[0])}})`);
  await click(nodeTitle(1), undefined, true);
  await screenshot("02b-selection-material-menu");
  await click('.canvas-context-menu button', "添加到参考图");
  assert.equal((await state()).referenceImageCount, 2);
  evidence.checks.selectionMenu = true;

  await openPicker("reference");
  for (let index = 1; index <= 40; index++) {
    if (index > 1 && (index - 1) % 9 === 0) await click('.reference-picker-pages button[aria-label="下一页"]');
    const selected = await evaluate(client, `document.querySelector(${JSON.stringify(candidate(index))})?.getAttribute('aria-pressed') === 'true'`);
    if (!selected) await click(candidate(index));
  }
  assert.equal(await evaluate(client, `document.querySelector(${JSON.stringify(candidate(41))})?.disabled`), true);
  assert.match(await evaluate(client, "document.querySelector('.reference-picker-status').textContent"), /40\/40/);
  await screenshot("03-reference-capacity");
  await closePicker(false);
  assert.equal((await state()).referenceImageCount, 2);
  evidence.checks.referenceCapacity = true;

  await openPicker("reference");
  await click(candidate(1));
  await click(candidate(2));
  await closePicker();
  await evaluate(client, `window.__naimageAIDebug.selectNodes({ids:${JSON.stringify(materialIds.slice(0,2))},primaryId:${JSON.stringify(materialIds[0])}})`);
  const group = await evaluate(client, "window.__naimageAIDebug.mergeSelectedImages()");
  assert.equal(group.ok, materialIds[0]);
  await focusMaterialNode(1);
  await click(`.flow-node[data-node-id="${materialIds[0]}"] [data-asset-index="1"]`, undefined, true);
  await screenshot("04-container-member-menu");
  await click('.asset-context-menu button', "添加到原图");
  await click(nodeTitle(1), undefined, true);
  await click('.canvas-context-menu button', "添加到原图");
  assert.equal((await state()).sourceImageCount, 2);
  await openPicker("source");
  await click(candidate(1));
  await closePicker();
  evidence.checks.containerMenu = true;
  await evaluate(client, "window.__naimageAIDebug.selectNodes({ids:[],primaryId:''})");
  assert.equal((await state()).sourceImageCount, 1);
  await openPicker("reference");
  await click(candidate(3));
  await closePicker();
  evidence.checks.containerMember = true;
  const before = await state();
  await evaluate(client, `(() => { const input = document.querySelector('.project-agent-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'核对本轮素材并回复收到，禁止调用生图工具。'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('.project-agent-send');
  await wait("window.__naimageDebugAgentState()?.lastDispatchedTaskScope?.sourceAssetCount === 1");
  const sent = await state();
  assert.equal(sent.lastDispatchedTaskScope.referenceAssetCount, 1);
  assert.equal(sent.lastDispatchedTaskScope.sourceAssets[0].assetIndex, 1);
  assert.equal(sent.lastDispatchedTaskScope.sourceAssets[0].nodeId, materialIds[0]);
  assert.equal(sent.lastDispatchedTaskScope.sourceAssets[0].ownerNodeId, materialIds[1]);
  assert.equal(sent.lastDispatchedTaskScope.sourceAssets[0].ownerAssetIndex, 0);
  assert.equal(sent.lastDispatchedTaskScope.referenceAssets[0].nodeId, materialIds[2]);
  assert.equal(sent.nodeCount, before.nodeCount, "Sending canvas material must not duplicate attachment containers");
  evidence.checks.sendExactMemberAndProvenance = true;
  await screenshot("05-material-message");
  await wait("!window.__naimageDebugAgentState()?.agentExecutionBusy && !window.__naimageDebugAgentState()?.activeRunId");
  await focusMaterialNode(1);
  await click(nodeTitle(1), undefined, true);
  await click('.canvas-context-menu button', "添加到参考图");
  assert.equal((await state()).referenceImageCount, 2);
  await evaluate(client, "window.__naimageAIDebug.selectNodes({ids:[],primaryId:''})");
  await openPicker("reference");
  await click(candidate(1));
  await closePicker();
  await evaluate(client, `(() => {const input = document.querySelector('.project-agent-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'请核对参考图来源并回复收到，禁止调用工具。'); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('.project-agent-send');
  await wait(`window.__naimageDebugAgentState()?.lastDispatchedTaskScope?.referenceAssets?.[0]?.nodeId === ${JSON.stringify(materialIds[0])}`);
  const referenceSent = (await state()).lastDispatchedTaskScope.referenceAssets[0];
  assert.equal(referenceSent.assetIndex, 1);
  assert.equal(referenceSent.ownerNodeId, materialIds[1]);
  assert.equal(referenceSent.ownerAssetIndex, 0);
  assert.equal(referenceSent.bindingId, sent.lastDispatchedTaskScope.sourceAssets[0].bindingId);
  assert.equal((await state()).nodeCount, before.nodeCount);
  evidence.checks.referenceMemberProvenance = true;
  await wait("!window.__naimageDebugAgentState()?.agentExecutionBusy && !window.__naimageDebugAgentState()?.activeRunId && window.__naimageDebugAgentState()?.progress?.some(item=>item.phase==='runtime-request')");
  const ipcLog = readFileSync(join(runDir, "electron.log"), "utf8");
  assert.equal(ipcLog.split(/\r?\n/).filter(line=>line.includes("agent ipc chat received")).length, 2);
  assert.equal(ipcLog.includes("agent chat failed"), false);
  evidence.checks.materialsReachedMainRuntime = true;

  await evaluate(client, "window.__naimageDebugOpenSurface('settings')");
  await click('.settings-section-tab[data-settings-section="models"]');
  await click('button[aria-label="配置生图模型"]');
  const model = models[1];
  await click(`button[aria-label="${model} 接口格式"]`);
  await click('[role="option"]', "OpenAI Compatible");
  await click(`button[aria-label="${model} 服务渠道"]`);
  await click('[role="option"]', "NewAPI");
  await screenshot("06-provider-configuration");
  for (const field of ["接口格式", "服务渠道", "结果获取"]) {
    await click(`button[aria-label="${models[2]} ${field}"]`);
    await click('[role="option"][data-glass-select-value="auto"]');
  }
  await screenshot("07-provider-auto-configuration");
  const saveText = await evaluate(client, "[...document.querySelectorAll('.model-picker-dialog footer button')].map(el=>el.textContent.trim()).find(text=>text.includes('保存'))");
  await click('.model-picker-dialog footer button', saveText);
  const settingsSaveText = await evaluate(client, "[...document.querySelectorAll('.settings-drawer footer button')].map(el=>el.textContent.trim()).find(text=>text.includes('保存'))");
  await click('.settings-drawer footer button', settingsSaveText);
  await wait("document.querySelector('.settings-drawer')?.textContent.includes('设置已保存')");
  await click('.settings-drawer footer button', "关闭");
  await wait("!document.querySelector('.settings-drawer')");
  const settings = JSON.parse(readFileSync(join(configDir, "app-settings.json"), "utf8"));
  const binding = settings.imageModelBindings.find((item) => item.model === model);
  assert.equal(binding.protocol, "openai-images");
  assert.equal(binding.gateway, "newapi");
  const autoBinding = settings.imageModelBindings.find((item) => item.model === models[2]);
  assert.equal(autoBinding.protocol, "auto");
  assert.equal(autoBinding.gateway, "auto");
  assert.equal(autoBinding.transportMode, "auto");
  evidence.checks.providerConfiguredAndPersisted = true;
  await evaluate(client, "window.__canvasMaterialsReloadPending = true");
  await client.send("Page.reload");
  await wait(`!window.__canvasMaterialsReloadPending && window.__naimageDebugAgentState?.().activeProjectId === '${projectId}' && Boolean(window.__naimageAIDebug?.selectNodes) && typeof window.__naimageDebugOpenSurface === 'function'`);
  await evaluate(client, "window.__naimageDebugOpenSurface('settings')");
  await click('.settings-section-tab[data-settings-section="models"]');
  await click('button[aria-label="配置生图模型"]');
  await wait(`Boolean(document.querySelector('button[aria-label="${model} 接口格式"]'))`);
  const persistedValues = await evaluate(client, `(() => {
    const value = (model, field) => document.querySelector('button[aria-label="'+model+' '+field+'"]')?.closest('[data-glass-select]')?.dataset.value;
    return {protocol:value(${JSON.stringify(model)},'接口格式'),gateway:value(${JSON.stringify(model)},'服务渠道'),autoProtocol:value(${JSON.stringify(models[2])},'接口格式'),autoGateway:value(${JSON.stringify(models[2])},'服务渠道'),autoTransport:value(${JSON.stringify(models[2])},'结果获取')};
  })()`);
  assert.deepEqual(persistedValues, {protocol:"openai-images",gateway:"newapi",autoProtocol:"auto",autoGateway:"auto",autoTransport:"auto"});
  evidence.checks.providerReload = true;
  evidence.ok = true;
}

try { await main(); }
catch (error) {
  evidence.error = error.stack || String(error);
  if (client) {
    await screenshot("failure").catch(() => {});
    evidence.ui = await evaluate(client, "(() => {const s=window.__naimageDebugAgentState?.();return {dialogs:[...document.querySelectorAll('[role=dialog]')].map(el=>el.getAttribute('aria-label')),buttons:[...document.querySelectorAll('[role=dialog] button')].map(el=>(el.textContent||el.getAttribute('aria-label')||'').trim()).slice(-25),materials:[...document.querySelectorAll('.canvas-material-option')].map(el=>({...el.dataset})),state:{sourceImageCount:s?.sourceImageCount,referenceImageCount:s?.referenceImageCount,lastDispatchedTaskScope:s?.lastDispatchedTaskScope}};})()").catch(() => null);
  }
  process.exitCode = 1;
}
finally {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  client?.close();
  await forceKillProcessTree(electron?.pid);
  await forceKillProcessTree(vite?.pid);
  process.stdout.write(`${JSON.stringify({ ...evidence, report: join(runDir, "report.json") })}\n`);
}
