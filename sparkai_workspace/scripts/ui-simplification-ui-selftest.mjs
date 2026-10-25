import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

// A small P2 interaction suite. Existing AIDebug bridges seed only local state;
// pointer/key input and the original Main settings/project owners do the work.
const root = resolve(import.meta.dirname, ".."), stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".diagnostics", "electron", `ui-simplification-${stamp}`);
const config = join(runDir, "config"), project = join(runDir, "project"), parents = join(runDir, "created-projects");
for (const directory of [config, project, parents, join(project, "output", "imagegen")]) mkdirSync(directory, { recursive: true });
const settingsPath = join(config, "app-settings.json"), imagePath = join(project, "output", "imagegen", "fixture.png");
const tailOnly = process.argv.includes("--tail");
const firstGroup = Number(process.argv.find(arg => arg.startsWith("--from="))?.slice(7) || (tailOnly ? 4 : 1));
const report = { ok: false, mode: firstGroup > 1 ? `from-group-${firstGroup}` : "full", realModelRequests: 0, mockAgent: true, mockImages: true, http: [], checks: [], skipped: [], observations: [], screenshots: [], shutdowns: [], limits: ["Native project directory picker is not driven: UI form and isolated Main automation creation are separate checks.", "Window bounds plus CDP content viewport are exercised at scale factor 1; physical 125%/150% DPI is not exercised.", "IME guard is verified with a synthetic isComposing key event; an OS-native IME composition flow is not driven."] };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
let vite, electron, client, detached, debugPort, devUrl;
const ev = expression => evaluateRuntime(client, expression);
const wait = (expression, target = client, timeoutMs = 12000) => waitForRuntimeExpression(target, expression, { evaluate: evaluateRuntime, timeoutMs, intervalMs: 70 });
const server = createServer((request, response) => {
  report.http.push({ method: request.method, path: request.url });
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(request.url.includes("/models") ? { data: ["gpt-6.1-sol", "gpt-image-2", "grok-imagine-image-2.0", "gemini-3.1-flash-image"].map(id => ({ id })) } : { success: true, data: { id: 1, username: "local-fixture", quota: 1000000, items: [] } }));
});
let groupIndex = 0;
async function group(name, action) { groupIndex++; if (groupIndex < firstGroup) { report.skipped.push(name); return; } report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); console.log(`ok ${report.checks.length} ${name}`); }
async function rect(selector, target = client, scroll = false) {
  const result = await evaluateRuntime(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;${scroll ? "e.scrollIntoView({block:'nearest'});" : ""}const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(x,y)),disabled:Boolean(e.disabled),text:e.textContent,aria:e.getAttribute('aria-label')}})()`);
  assert.ok(result, `Missing ${selector}`); return result;
}
async function click(selector, target = client) {
  let proof = await rect(selector, target, true); await delay(70); proof = await rect(selector, target);
  assert.ok(proof.width > 0 && proof.height > 0 && proof.hit && !proof.disabled, `Unreachable ${selector}: ${JSON.stringify(proof)}`);
  for (const type of ["mousePressed", "mouseReleased"]) await target.send("Input.dispatchMouseEvent", { type, x: proof.x, y: proof.y, button: "left", clickCount: 1 });
  await delay(95); return proof;
}
async function button(text, scope = "body", target = client) {
  const selector = await evaluateRuntime(target, `(()=>{const a=[...document.querySelectorAll(${JSON.stringify(scope + " button")})];const e=a.find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return null;e.dataset.p2Target='action';return '[data-p2-target=action]'})()`);
  assert.ok(selector, `Missing button ${scope}: ${text}`); await click(selector, target); await evaluateRuntime(target, "document.querySelector('[data-p2-target=action]')?.removeAttribute('data-p2-target')");
}
async function key(key, modifiers = 0, target = client) {
  const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, a: 65 };
  for (const type of ["keyDown", "keyUp"]) await target.send("Input.dispatchKeyEvent", { type, key, code: key === "a" ? "KeyA" : key, modifiers, windowsVirtualKeyCode: codes[key] || 0, nativeVirtualKeyCode: codes[key] || 0, ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}) });
  await delay(90);
}
async function fill(selector, value, target = client) { await click(selector, target); await key("a", 2, target); await target.send("Input.insertText", { text: value }); await delay(90); }
async function nativeClick(selector, accept, target = detached) {
  let listener, timer;
  const handled = new Promise((resolveDialog, rejectDialog) => {
    timer = setTimeout(() => rejectDialog(new Error(`Missing native confirmation for ${selector}`)), 8000);
    listener = event => { const message = JSON.parse(String(event.data)); if (message.method !== "Page.javascriptDialogOpening") return; clearTimeout(timer); report.observations.push({ kind: "native-js-confirm", selector, accept, message: message.params.message }); target.send("Page.handleJavaScriptDialog", { accept }).then(resolveDialog, rejectDialog); };
    target.socket.addEventListener("message", listener);
  });
  try { await Promise.all([click(selector, target), handled]); }
  finally { clearTimeout(timer); target.socket.removeEventListener("message", listener); }
}
async function shot(name, target = client) { await capturePngScreenshotToFile(target, join(runDir, `${name}.png`)); report.screenshots.push(`${name}.png`); checkpoint(); }
async function command(name, args = {}) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation", "endpoint.json"), "utf8"));
  const response = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command: name, args, timeoutMs: 30000 }), signal: AbortSignal.timeout(40000) })).json();
  assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`); return response.result;
}
async function size(width, height) {
  const actual = await ev(`window.naimageConfig.debugWindowBounds({width:${width},height:${height}})`); assert.equal(actual.ok, true);
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
  await wait(`innerWidth===${width}&&innerHeight===${height}`); await delay(130);
  report.observations.push({ kind: "window", requested: [width, height], actual, viewport: await ev("[innerWidth,innerHeight,devicePixelRatio]") });
}
async function appearance(theme, save = true) {
  await click("#workspace-settings-trigger"); await wait("Boolean(document.querySelector('.settings-drawer'))");
  assert.deepEqual(await ev("[...document.querySelectorAll('.settings-section-tab')].map(e=>e.textContent.trim())"), ["连接", "生成", "外观", "扩展", "更新"]);
  await click('[data-settings-category="appearance"]'); await wait("Boolean(document.querySelector('[data-glass-section=themes]'))");
  await click(`[data-glass-section="themes"] button[data-glass-theme="${theme}"]`); await wait(`document.documentElement.dataset.glassTheme===${JSON.stringify(theme)}`);
  if (save) {
    if (!await ev("document.querySelector('.settings-surface-footer .ui-action-primary').disabled")) await click(".settings-surface-footer .ui-action-primary");
    await wait("document.querySelector('.settings-surface-footer .ui-action-primary').disabled");
    await click('[aria-label="关闭设置"]'); await wait("!document.querySelector('.settings-drawer')");
  }
}
async function tooltip(selector, label) {
  const box = await rect(selector); assert.ok(box.width >= 32 && box.height >= 32 && box.hit, `32px hit ${selector}`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y }); await delay(450);
  await wait(`document.querySelector('[role=tooltip]')?.textContent===${JSON.stringify(label)}`);
  const hover = await ev("document.querySelector('[role=tooltip]').textContent");
  const imagePrefix = await ev("document.documentElement.dataset.glassTheme+'-'+innerWidth"), actionName = label === "新建项目" ? "create" : "remove";
  if (await ev("innerWidth===884")) await shot(`${imagePrefix}-${actionName}-hover-tooltip`);
  await key("Escape"); await wait("!document.querySelector('[role=tooltip]')");
  await wait("!document.querySelector('.project-menu-popover')"); await click("#project-menu-trigger");
  await wait("document.activeElement?.closest('.project-menu-popover')!==null"); await key("ArrowDown"); await key("Home");
  if (!await ev(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`)) await key("ArrowDown");
  await wait(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
  await wait(`document.querySelector('[role=tooltip]')?.textContent===${JSON.stringify(label)}`);
  if (await ev("innerWidth===884")) await shot(`${imagePrefix}-${actionName}-focus-tooltip`);
  report.observations.push({ kind: "icon-tooltip", label, box, hover, focus: true });
}
async function choose(label, value) {
  await click(`button[aria-label="${label}"]`); await click(`[role=option][data-glass-select-value="${value}"]`);
}
async function stop() {
  if (!electron) return;
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {});
  const exited = await waitForChildExit(electron, 15000);
  report.shutdowns.push({ pid: electron.pid, normalCloseRequested: true, exited, exitCode: electron.exitCode, forced: false });
  assert.ok(exited && electron.exitCode === 0, `App remains for inspection, PID ${electron.pid}`);
  client?.close(); detached?.close(); client = detached = null; electron = null; checkpoint();
}

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  await sharp({ create: { width: 256, height: 256, channels: 3, background: "#7799aa" } }).png().toFile(imagePath);
  const originalHash = createHash("sha256").update(readFileSync(imagePath)).digest("hex"), now = new Date().toISOString();
  const conversations = Array.from({ length: 32 }, (_, i) => ({ id: `p2-chat-${i + 1}`, title: `P2 会话 ${String(i + 1).padStart(2, "0")}`, createdAt: now, updatedAt: new Date(Date.now() - i * 1000).toISOString(), messages: [] }));
  const node = { id: "p2-source", displayCode: "I001", title: "本地受管成果", prompt: "local fixture", type: "image", status: "done", imageState: "done", x: 100, y: 140, outputs: 1, branch: "basic", createdAt: now, assets: [{ assetId: "p2-asset", index: 1, type: "file", path: imagePath, width: 256, height: 256 }] };
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [node], messages: [], selectedNodeIds: [], activeConversationId: "p2-chat-1", conversations }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "p2-project", projects: [{ id: "p2-project", name: "P2 隔离项目", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  writeFileSync(settingsPath, JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token", accountBaseUrl: base, relayBaseUrl: base, imageBaseUrl: base, agentBaseUrl: base, updateBaseUrl: base, imageApiKey: "local-fixture", agentApiKey: "local-fixture", imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"], agentModel: "gpt-6.1-sol", agentModelPool: ["gpt-6.1-sol"], imageRatio: "3:2", imageResolution: "2K", imageCount: 2, imageQuality: "high", imageModelConfigs: [{ model: "gpt-image-2", protocol: "openai-images", capabilities: { supportedQualities: ["auto", "high"], referenceImages: true } }], recentCanvasToolCommands: ["sparkai.social-content.open-templates"], glassTheme: "light-classic", glassReducedMotion: true, agentPanelWidth: 370 }));
  const shim = join(runDir, "no-server.cjs"); writeFileSync(shim, '"use strict"; const timer=setInterval(()=>{},1000);const close=()=>{clearInterval(timer);process.exit(0)};process.on("SIGTERM",close);process.on("SIGINT",close);process.on("message",m=>{if(m==="shutdown")close()});');
  const vitePort = await allocateDebugPort(); devUrl = `http://127.0.0.1:${vitePort}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort)], { cwd: root, windowsHide: true, stdio: "ignore" });
  await waitForHttpServer(devUrl, { attempts: 180, intervalMs: 100 }); debugPort = await allocateDebugPort();
  electron = spawn(process.execPath, [join(root, "node_modules/electron/cli.js"), "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_AIDEBUG_REAL_AGENT: "0", NAIMAGE_AIDEBUG_LIVE_IMAGE: "0", NAIMAGE_AIDEBUG_AGENT_STOP_FIXTURE: "fail-once", NAIMAGE_AIDEBUG_AGENT_STOP_DELAY_MS: "1400", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: shim } });
  report.pid = electron.pid; report.debugPort = debugPort; checkpoint();
  const target = await pollForDebugTarget({ port: debugPort, attempts: 220, intervalMs: 100, findTarget: list => list.find(t => t.type === "page" && !t.url.includes("agent-window")) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable"); await client.send("Page.bringToFront");
  await wait("Boolean(document.querySelector('.project-agent-composer textarea')&&window.__naimageDebugAgentState&&window.__naimageDebugSeedAgentMessages)", client, 25000);
  if (firstGroup > 1) { await size(884, 640); await appearance("dark-classic"); }
  await group("two themes x 1280/884: original project actions, 32px symbols, tooltip, menu keyboard and view invariants", async () => {
    for (const theme of ["light-classic", "dark-classic"]) {
      await size(1280, 800); await appearance(theme);
      for (const [width, height] of [[1280, 800], [884, 640]]) {
        await size(width, height); await click("#project-menu-trigger"); await wait("Boolean(document.querySelector('.project-menu-popover'))");
        await tooltip('[aria-label="新建项目"]', "新建项目"); await key("Escape");
        await click("#project-menu-trigger"); await click("#project-menu-trigger"); assert.equal(await ev("Boolean(document.querySelector('.project-menu-popover'))"), false, "same trigger closes");
        await click("#project-menu-trigger"); await key("ArrowDown");
        await wait("document.activeElement?.getAttribute('aria-label')==='移除项目，保留文件'");
        await tooltip('[aria-label="移除项目，保留文件"]', "移除项目，保留文件"); await key("End");
        const last = await ev("(()=>{const m=document.querySelector('.project-menu-popover'),e=document.activeElement,r=e.getBoundingClientRect(),q=m.getBoundingClientRect();return{label:e.textContent,scroll:m.scrollTop,visible:r.top>=q.top&&r.bottom<=q.bottom+1}})()"); assert.ok(last.visible); report.observations.push({ kind: "project-menu-end", theme, width, ...last });
        await shot(`${theme}-${width}-project-menu`); await key("Escape"); assert.equal(await ev("document.activeElement?.id"), "project-menu-trigger");
        await click("#project-menu-trigger"); await click('[aria-label="新建项目"]'); await wait("Boolean(document.querySelector('[data-ui-surface=project-name]'))");
        await fill("#project-name-form input", `P2 表单 ${theme} ${width}`); assert.equal(await ev("document.querySelectorAll('.project-domain-card').length"), 4); await shot(`${theme}-${width}-create-form`); await key("Escape");
        await click("#project-menu-trigger"); await click('[aria-label="移除项目，保留文件"]'); await wait("Boolean(document.querySelector('.confirm-dialog'))"); assert.equal(await ev("document.querySelector('.confirm-dialog').textContent.includes('这不会删除文件夹')"), true); await key("Escape");
        await command("canvas.select", { ids: ["p2-source"], primaryId: "p2-source" });
        const state = await command("canvas.state"); await ev("window.__p2Stage=document.querySelector('.canvas-stage');window.__p2Node=document.querySelector('.flow-node[data-node-id=\"p2-source\"]');true"); assert.equal(await ev("Boolean(window.__p2Stage&&window.__p2Node)"), true);
        for (const label of ["专注", "评审", "画布"]) { await click(".workspace-view-trigger"); await button(label, ".workspace-view-menu"); }
        const after = await command("canvas.state"); assert.deepEqual(after.selection, state.selection); assert.deepEqual(after.viewport, state.viewport); assert.equal(await ev("window.__p2Stage===document.querySelector('.canvas-stage')&&window.__p2Node===document.querySelector('.flow-node[data-node-id=\"p2-source\"]')"), true);
        assert.equal(await ev("document.querySelectorAll('.workspace-asset-rail [data-domain-tools-launcher],.workspace-asset-rail button[aria-label=历史]').length"), 0); await shot(`${theme}-${width}-workspace`);
      }
    }
  });
  await group("tools search, domain filtering, recent commands and real disabled states", async () => {
    await command("canvas.select", { ids: [] });
    await click(".canvas-all-tools-trigger"); await wait("document.activeElement?.getAttribute('aria-label')==='搜索画布工具'");
    const tools = await ev("({domains:[...document.querySelectorAll('.canvas-tools-domains button')].map(e=>e.textContent),recent:document.querySelector('.canvas-tools-menu').textContent.includes('最近使用'),disabled:[...document.querySelectorAll('.canvas-tools-menu button:disabled')].map(e=>({text:e.textContent,disabled:e.disabled}))})");
    assert.ok(tools.domains.length >= 2 && tools.recent && tools.disabled.length > 0); report.observations.push({ kind: "tools", ...tools });
    const disabled = await rect(".canvas-tools-menu button:disabled", client, true), original = await command("canvas.state");
    for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, x: disabled.x, y: disabled.y, button: "left", clickCount: 1 });
    await delay(150); assert.equal(await ev("Boolean(document.querySelector('.canvas-tools-menu'))"), true); const unchanged = await command("canvas.state"); assert.deepEqual(unchanged.nodes, original.nodes); assert.deepEqual(unchanged.selection, original.selection);
    await button(tools.domains[1], ".canvas-tools-domains"); assert.equal(await ev("document.querySelector('.canvas-tools-domains [aria-current=true]').textContent"), tools.domains[1]);
    await button("全部", ".canvas-tools-domains"); await fill('[aria-label="搜索画布工具"]', "sparkai.social-content.open-templates");
    await wait("document.querySelectorAll('.canvas-tools-menu [data-plugin-command]').length===1"); await click('.canvas-tools-menu [data-plugin-command="sparkai.social-content.open-templates"]');
    await wait("document.querySelector('.workspace-asset-rail').dataset.activeTab==='templates'"); await click(".canvas-all-tools-trigger"); assert.equal(await ev("document.querySelector('.canvas-tools-menu').textContent.includes('最近使用')"), true); await shot("tools-recent-search-domains"); await key("Escape");
  });
  await group("32 conversations: keyboard scroll, last item selectable, Agent memory and placements", async () => {
    await click(".project-agent-conversation-trigger"); await wait("document.querySelectorAll('.project-agent-history button[role=menuitem]').length===32"); await key("End");
    const last = await ev("(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),m=document.querySelector('.project-agent-history'),q=m.getBoundingClientRect();return{label:e.textContent,scroll:m.scrollTop,visible:r.top>=q.top&&r.bottom<=q.bottom+1,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()");
    assert.ok(last.label.includes("P2 会话 32") && last.visible && last.hit); report.observations.push({ kind: "history-32", ...last }); await shot("history-32-last-keyboard"); await key("Enter"); await wait("document.querySelector('.project-agent-conversation-trigger').textContent.includes('P2 会话 32')");
    await click('[aria-label="更多 Agent 操作"]'); await button("编辑 Agent 记忆", ".agent-placement-menu"); await wait("Boolean(document.querySelector('[data-ui-surface=agent-memory-editor]'))"); await shot("agent-memory-original-entry"); await key("Escape");
    await click('[aria-label="更多 Agent 操作"]'); await button("停靠左侧", ".agent-placement-menu"); await wait("document.querySelector('.project-agent-panel').classList.contains('placement-left')"); await key("Escape");
    await click('[aria-label="更多 Agent 操作"]'); await button("停靠右侧", ".agent-placement-menu"); await wait("document.querySelector('.project-agent-panel').classList.contains('placement-right')"); await key("Escape");
  });
  await group("image first four fields, full models and advanced value retention; actual Main write failure/retry", async () => {
    const before = report.http.filter(r => r.path.includes("models")).length; await click(".project-agent-config-trigger"); await wait("Boolean(document.querySelector('.project-agent-image-config'))"); await delay(180);
    assert.equal(report.http.filter(r => r.path.includes("models")).length, before, "cached opening adds no model probe");
    assert.equal(await ev("document.querySelector('.project-agent-image-config-fields').children.length"), 4);
    assert.equal(await ev("document.querySelectorAll('.project-agent-image-config details[open]').length"), 0);
    const first = await Promise.all(["默认生图比例", "默认生图清晰度", "每批图片数量"].map(label => rect(`button[aria-label="${label}"]`))); assert.ok(first.every(p => p.hit && p.bottom <= 640)); report.observations.push({ kind: "image-first-fields", controls: first }); await shot("image-four-fields-884");
    await click(".project-agent-image-model-manager > summary"); const models = await ev("[...document.querySelectorAll('.project-agent-model-option input')].map(e=>({label:e.ariaLabel,checked:e.checked,disabled:e.disabled}))"); report.observations.push({ kind: "model-catalog", models }); assert.ok(models.length >= 5 && models.some(e => e.checked && e.disabled));
    await click(".project-agent-image-model-manager > summary"); await click(".project-agent-image-advanced > summary"); assert.equal(await ev("document.querySelector('[aria-label=生图质量]').closest('.glass-select').dataset.value"), "high"); await click(".project-agent-image-advanced > summary");
    const blockedPath = `${settingsPath}.tmp`; mkdirSync(blockedPath); await choose("每批图片数量", "3"); await wait("document.querySelector('.project-agent-image-config-body').textContent.includes('保存失败')");
    await button("完成", ".project-agent-image-config"); await key("Escape"); assert.equal(await ev("Boolean(document.querySelector('.project-agent-image-config'))"), true);
    assert.equal(await ev("[...document.querySelectorAll('.project-agent-image-config [role=status]')].some(e=>e.textContent.includes('保存失败')&&!e.closest('details'))"), true); await shot("image-main-write-failure-external");
    rmdirSync(blockedPath); await button("重试保存", ".project-agent-image-config"); await wait("document.querySelector('.project-agent-image-config-body').textContent.includes('已保存')"); assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).imageCount, 3); assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).imageQuality, "high");
    await button("完成", ".project-agent-image-config"); await wait("!document.querySelector('.project-agent-image-config')"); await click(".project-agent-config-trigger"); await wait("Boolean(document.querySelector('.project-agent-image-config'))"); assert.equal(await ev("document.querySelectorAll('.project-agent-image-config details[open]').length"), 0); assert.equal(await ev("document.querySelector('[aria-label=每批图片数量]').closest('.glass-select').dataset.value"), "3"); await button("完成", ".project-agent-image-config");
  });
  await group("global settings draft cancellation restores saved appearance", async () => {
    const saved = JSON.parse(readFileSync(settingsPath, "utf8")).glassTheme; await appearance("light-classic", false); await click('[aria-label="关闭设置"]'); await wait("Boolean(document.querySelector('.settings-unsaved-dialog'))"); await button("不保存并关闭", ".settings-unsaved-dialog"); await wait("!document.querySelector('.settings-drawer')"); assert.equal(await ev("document.documentElement.dataset.glassTheme"), saved); assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).glassTheme, saved);
  });
  await group("single image edit/export/more portal remains actionable past hover timeout and Escape", async () => {
    await size(1280, 800); await command("canvas.select", { ids: [] });
    const p = await rect('.flow-node[data-node-id="p2-source"]'); await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await wait("Boolean(document.querySelector('[aria-label=更多成果操作]'))");
    await click('[aria-label="更多成果操作"]'); await wait("Boolean(document.querySelector('.canvas-interaction-menu'))");
    const item = await rect(".canvas-interaction-menu button"); await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: item.x, y: item.y }); await delay(350);
    assert.equal(await ev("Boolean(document.querySelector('.canvas-interaction-menu'))"), true); assert.equal((await rect(".canvas-interaction-menu button")).hit, true); report.observations.push({ kind: "single-more", menu: await ev("document.querySelector('.canvas-interaction-menu').textContent") }); await shot("single-image-more-portal-350ms"); await key("Escape"); await wait("!document.querySelector('.canvas-interaction-menu')"); assert.equal(await ev("document.activeElement?.getAttribute('aria-label')"), "更多成果操作");
    await click('[aria-label="更多成果操作"]'); await button("查看", ".canvas-interaction-menu"); await wait("Boolean(document.querySelector('.image-viewer'))"); await shot("single-image-more-original-viewer"); await key("Escape"); await wait("!document.querySelector('.image-viewer')");
  });
  await group("running/error/question never fold; completed tool-only steps remain expandable", async () => {
    await ev(`window.__naimageDebugSeedAgentMessages({messages:${JSON.stringify([
      { id: "p2-tool-done", role: "assistant", status: "done", content: "", toolTrace: { stage: "result", name: "workflow", label: "完成工具", operation: "list_nodes", params: "完成细节标记", brief: "完成输出" } },
      { id: "p2-tool-running", role: "assistant", status: "running", content: "", toolTrace: { stage: "start", name: "workflow", label: "运行工具", operation: "list_nodes", brief: "运行细节标记" } },
      { id: "p2-error", role: "assistant", status: "error", content: "错误不可收起标记" },
      { id: "p2-question", role: "assistant", status: "done", content: "请回答问题标记", toolTrace: { stage: "result", name: "ask_user", label: "问题", operation: "ask_user", brief: "请回答问题标记" } }
    ])}})`); await wait("Boolean(document.querySelector('.project-agent-completed-tools'))");
    const visibleRows = await ev("[...document.querySelectorAll('.agent-message')].filter(e=>/运行细节标记|错误不可收起标记|请回答问题标记/.test(e.textContent)).map(e=>({text:e.textContent,folded:Boolean(e.closest('.project-agent-completed-tools')),height:e.getBoundingClientRect().height}))"); assert.equal(visibleRows.length, 3); assert.ok(visibleRows.every(e => !e.folded && e.height > 0)); report.observations.push({ kind: "unfolded-required-states", rows: visibleRows });
    await click(".project-agent-completed-tools > summary"); assert.equal(await ev("document.querySelector('.project-agent-completed-tools').open"), true); await shot("agent-completed-running-error-question"); await ev("window.__naimageDebugSeedAgentMessages({clear:true})");
  });
  await group("collapsed busy Agent stop: pending keeps run identity; reject/retry uses Main confirmation", async () => {
    await ev("window.__naimageDebugOpenSurface('agent-running')"); await wait("window.__naimageDebugAgentState().agentExecutionBusy===true"); await click('[aria-label="折叠项目 Agent"]'); await wait("Boolean(document.querySelector('.project-agent-panel.is-collapsed .project-agent-stop'))");
    await click(".project-agent-stop"); await wait("Boolean(document.querySelector('.confirm-dialog'))"); await button("确认结束", ".confirm-dialog"); await wait("document.querySelector('.project-agent-stop')?.disabled===true");
    const pending = await ev("({busy:window.__naimageDebugAgentState().agentExecutionBusy,run:window.__naimageDebugAgentState().activeRunId,label:document.querySelector('.project-agent-stop').ariaLabel,ariaBusy:document.querySelector('.project-agent-stop').getAttribute('aria-busy')})"); assert.equal(pending.busy, true); assert.equal(pending.run, "debug-running-ui"); assert.equal(pending.label, "正在确认结束"); report.observations.push({ kind: "collapsed-stop-pending", ...pending }); await shot("collapsed-stop-pending");
    await wait("document.querySelector('.project-agent-stop')?.disabled===false"); assert.equal(await ev("window.__naimageDebugAgentState().agentExecutionBusy"), true); await click('[aria-label="展开项目 Agent"]'); await wait("document.querySelector('.project-agent-feed').textContent.includes('AIDebug 注入的结束失败')");
    await click(".project-agent-stop"); await button("确认结束", ".confirm-dialog"); await wait("window.__naimageDebugAgentState().agentExecutionBusy===false"); assert.equal(await ev("window.__naimageDebugAgentState().agentStatus"), "idle");
  });
  await group("composer IME guard, Ctrl+Enter Agent callback and explicit direct-image callback with local mocks", async () => {
    await fill('[aria-label="Agent 指令"]', "/status"); await ev("document.querySelector('[aria-label=\"Agent 指令\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}))"); assert.equal(await ev("Boolean(document.querySelector('.project-agent-command-notice'))"), false); await key("Enter", 2); await wait("document.querySelector('.project-agent-command-notice')?.textContent.includes('当前空闲')");
    await fill('[aria-label="Agent 指令"]', "P2 本地普通对话，只回复验收状态"); await key("Enter", 2); await wait("window.__naimageDebugAgentState().agentExecutionBusy===false", client, 30000); await wait("document.querySelector('.project-agent-feed').textContent.includes('P2 本地普通对话')");
    const before = (await command("canvas.state")).nodes.length; await fill('[aria-label="Agent 指令"]', "创建一张本地mock验收图"); await click('[aria-label="直接生图"]'); await wait(`window.__naimageDebugAgentState().nodes.length>${before}`, client, 30000); await wait("window.__naimageDebugAgentState().agentExecutionBusy===false", client, 30000); await shot("composer-mock-agent-direct-image");
  });
  await group("detached header/materials/more/stop remain accessible and share actual saved theme", async () => {
    await click('[aria-label="更多 Agent 操作"]'); await button("独立浮动窗口", ".agent-placement-menu");
    const target = await pollForDebugTarget({ port: debugPort, attempts: 150, intervalMs: 100, findTarget: list => list.find(t => t.url.includes("agent-window.html")) }); detached = new BasicCdpClient(target.webSocketDebuggerUrl); await detached.open(); await detached.send("Runtime.enable"); await detached.send("Page.enable"); await wait("Boolean(document.querySelector('#agent-prompt'))", detached);
    const theme = await ev("document.documentElement.dataset.glassTheme"); await wait(`document.documentElement.dataset.glassTheme===${JSON.stringify(theme)}`, detached);
    const header = []; for (const selector of ["#conversation-select", "#new-conversation", "#agent-more > summary", "#agent-materials > summary"]) { const p = await rect(selector, detached); assert.ok(p.hit && p.width >= 32 && p.height >= 32); header.push({ selector, ...p }); }
    const previousConversation = await evaluateRuntime(detached, "document.querySelector('#conversation-select').value"); await nativeClick("#new-conversation", false); assert.equal(await evaluateRuntime(detached, "document.querySelector('#conversation-select').value"), previousConversation);
    await click("#agent-more > summary", detached); await click("#edit-memory", detached); await wait("Boolean(document.querySelector('[data-ui-surface=agent-memory-editor]'))"); await key("Escape"); await click("#agent-materials > summary", detached); assert.equal(await evaluateRuntime(detached, "document.querySelector('#agent-materials').open"), true); await shot("detached-header-materials", detached);
    await ev("window.__naimageDebugOpenSurface('agent-running')"); await wait("document.querySelector('#stop-button').hidden===false", detached); assert.equal((await rect("#stop-button", detached)).hit, true); await shot("detached-running-stop", detached); report.observations.push({ kind: "detached", theme, header });
    await nativeClick("#stop-button", true); await wait("document.querySelector('#stop-button').disabled===false||document.querySelector('#stop-button').hidden===true", detached, 10000);
    if (await ev("window.__naimageDebugAgentState().agentExecutionBusy")) await nativeClick("#stop-button", true);
    await wait("window.__naimageDebugAgentState().agentExecutionBusy===false");
  });
  await group("real isolated Main project create plus actual remove confirmation preserves project files", async () => {
    const created = await command("project.create", { name: "P2 Main 隔离创建", parentDirectory: parents }); report.observations.push({ kind: "main-project-create", result: created });
    await wait("document.querySelector('#project-menu-trigger')?.textContent.includes('P2 Main 隔离创建')"); const list = JSON.parse(readFileSync(join(config, "project-list.json"), "utf8")), entry = list.projects.find(p => p.name === "P2 Main 隔离创建"); assert.ok(entry && entry.path.startsWith(parents) && existsSync(entry.sessionPath));
    await click("#project-menu-trigger"); await click('[aria-label="移除项目，保留文件"]'); await wait("Boolean(document.querySelector('.confirm-dialog'))"); await shot("project-remove-real-confirmation"); await button("移除", ".confirm-dialog"); await wait("!document.querySelector('.confirm-dialog')");
    assert.ok(existsSync(entry.path) && existsSync(entry.sessionPath)); assert.equal(JSON.parse(readFileSync(join(config, "project-list.json"), "utf8")).projects.some(p => p.id === entry.id), false); assert.equal(createHash("sha256").update(readFileSync(imagePath)).digest("hex"), originalHash);
  });
  await stop(); report.ok = true;
} catch (error) {
  report.error = error.stack || String(error); process.exitCode = 1; console.error(report.error);
  if (client) { report.failureState = await ev("({text:document.body.innerText.slice(-6500),active:document.activeElement?.outerHTML.slice(0,500)})").catch(e => ({ error: e.message })); await shot("failure").catch(() => {}); await stop().catch(e => { report.shutdownError = e.message; report.preservedPid = electron?.pid; }); }
} finally {
  checkpoint(); if (vite && !electron) vite.kill(); server.closeAllConnections(); server.close(); console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, screenshots: report.screenshots.length, report: join(runDir, "report.json"), preservedPid: report.preservedPid }));
}
