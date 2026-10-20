import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const root = resolve(import.meta.dirname, ".."), exe = process.argv.find(arg => arg.startsWith("--exe="))?.slice(6);
const performanceOnly = process.argv.includes("--performance-only");
const skipPerformance = process.argv.includes("--skip-performance");
const require = createRequire(import.meta.url);
const { buildProductionSymbolPlan, transformCode } = require("./production-symbol-compaction.cjs");
const symbolPlan = exe ? buildProductionSymbolPlan(root) : null;
const evaluate = (target, expression) => evaluateRaw(target, symbolPlan ? transformCode(expression, symbolPlan, "project-context-ui-test.js") : expression);
const runDir = join(root, ".diagnostics", `project-context-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), projectA = join(runDir, "project-a"), projectB = join(runDir, "project-b");
for (const directory of [config, projectA, projectB]) mkdirSync(directory, { recursive: true });
writeFileSync(join(runDir, "no-server.cjs"), '"use strict"; const hold=setInterval(()=>{},1000); const close=()=>{clearInterval(hold);process.exit(0)};process.on("SIGTERM",close);process.on("SIGINT",close);process.on("message",value=>{if(value==="shutdown")close()});');
const report = { ok: false, mode: performanceOnly ? "performance-only" : skipPerformance ? "functional" : "full", realModelRequests: 0, modelPosts: 0, imagePosts: 0, checks: [], screenshots: [], wire: [], serverErrors: [], shutdowns: [], bounds: [] };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const output = await sharp(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="#f7e9da"/><circle cx="512" cy="512" r="230" fill="#d44761"/></svg>')).png().toBuffer();
let electron, vite, client, agentClient, debugPort, devUrl = "", activeProject = "context-a", currentTemplate, firstTask, secondTask, oldApplied, boundB, userEditedRequirement;
const fixtures = [], projectInfo = new Map();
const scopes = { a: { expectedProjectId: "context-a", conversationId: "conversation-a" }, b: { expectedProjectId: "context-b", conversationId: "conversation-b" } };
const knowledgeContent = "保留圆形徽标，品牌使用暖白背景；不得增加未证实的功能。";
const json = (response, value) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
const complete = (response, content) => { response.writeHead(200, { "content-type": "text/event-stream" }); response.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: `local-${report.modelPosts}`, status: "completed", output: content } })}\n\ndata: [DONE]\n\n`); };
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), raw = bytes.toString("utf8");
    if (request.url === "/v1/responses") {
      const body = JSON.parse(raw), round = report.modelPosts++;
      assert.equal(body.tool_choice, "auto");
      if (round === 0) assert.ok(raw.includes(knowledgeContent), "Actual model request consumes explicitly saved project knowledge");
      if (round === 2) assert.equal(raw.includes(knowledgeContent), false, "Project A knowledge does not enter project B");
      if (round === 0 || round === 2) complete(response, [{ type: "function_call", name: "image_gen", call_id: `local-image-${round}`, arguments: JSON.stringify({ operation: "edit", prompt: "保留本次原图主体，制作暖白背景的商品场景", brief: "商品场景" }) }]);
      else if (round === 1 || round === 3) complete(response, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "本次商品场景已生成并保存；尚未进行AI视觉验收。" }] }]);
      else throw new Error(`Unexpected model round ${round}`);
    } else if (/^\/v1\/images\/(generations|edits)/.test(request.url)) {
      let imageBytes = [], prompt = "", count = 1;
      if (String(request.headers["content-type"] || "").startsWith("multipart/form-data")) {
        const form = await new Request("http://127.0.0.1/fixture", { method: "POST", headers: { "content-type": request.headers["content-type"] }, body: bytes }).formData();
        imageBytes = await Promise.all([...form.entries()].filter(([key, value]) => key.startsWith("image") && typeof value.arrayBuffer === "function").map(async ([, value]) => Buffer.from(await value.arrayBuffer())));
        prompt = String(form.get("prompt") || ""); count = Number(form.get("n") || 1);
      } else { const body = JSON.parse(raw); prompt = body.prompt; count = body.n || 1; imageBytes = fixtures.filter(fixture => raw.includes(fixture.bytes.toString("base64"))).map(fixture => fixture.bytes); }
      const matched = fixtures.filter(fixture => imageBytes.some(image => image.equals(fixture.bytes))).map(fixture => fixture.node.id);
      report.wire.push({ sourceNodeIds: matched, count, prompt }); report.imagePosts++;
      assert.equal(count, 1); assert.equal(imageBytes.length, 1);
      assert.deepEqual(matched, [report.imagePosts === 1 ? "A-source" : "B-source"], "HTTP source bytes come from the explicit current-project template binding");
      json(response, { data: [{ b64_json: output.toString("base64") }] });
    } else if (request.url === "/v1/models") json(response, { data: [{ id: "gpt-5.6-sol" }, { id: "gpt-image-2" }] });
    else json(response, { success: true, data: { id: 1, username: "fixture", quota: 100000, items: [] } });
    checkpoint();
  } catch (error) { report.serverErrors.push(error.message); checkpoint(); if (!response.headersSent) json(response, { error: { message: error.message } }); else response.end(); }
});

const ev = expression => evaluate(client, expression);
async function until(predicate, name, timeoutMs = 30000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (report.serverErrors.length) throw new Error(report.serverErrors[0]); if (await predicate()) return; await delay(100); } throw new Error(`Timeout: ${name}`); }
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); console.log(`ok ${report.checks.length} ${name}`); }
async function command(name, args = {}, raw = false) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const result = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command: name, args, timeoutMs: 90000 }), signal: AbortSignal.timeout(100000) })).json();
  if (raw) return result; assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`); return result.result;
}
async function click(target, selector) {
  const state = await evaluate(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return {exists:false};if(!e.disabled)e.scrollIntoView({block:'center'});return {exists:true,disabled:Boolean(e.disabled),text:e.textContent}})()`);
  assert.equal(state.exists, true, `Missing click target ${selector}`); assert.equal(state.disabled, false, `Disabled click target ${selector}: ${state.text}`);
  let point, previous;
  await until(async () => {
    const next = await evaluate(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,ready:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(x,y))}})()`);
    const ready = next?.ready && previous && Math.abs(next.x-previous.x)<0.5 && Math.abs(next.y-previous.y)<0.5; previous=next; if(ready) point={x:next.x,y:next.y}; return ready;
  }, `visible stable pointer target ${selector}`, 10000);
  for (const type of ["mousePressed", "mouseReleased"]) await target.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}
async function button(target, text, within = "body") { await evaluate(target, `(()=>{const e=[...document.querySelector(${JSON.stringify(within)}).querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('Missing button '+${JSON.stringify(text)});e.dataset.contextUiAction='click'})()`); await click(target, '[data-context-ui-action="click"]'); await evaluate(target, "document.querySelector('[data-context-ui-action=click]')?.removeAttribute('data-context-ui-action')"); }
async function fill(target, selector, value) { await evaluate(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing/disabled input '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.focus();e.select()})()`); await target.send("Input.insertText", { text: String(value) }); }
async function select(target, selector, value) {
  const index = await evaluate(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing select');e.scrollIntoView({block:'center'});e.focus();return [...e.options].findIndex(o=>o.value===${JSON.stringify(String(value))})})()`); assert.ok(index >= 0, `Select option ${value}`);
  for (const key of ["Home", ...Array(index).fill("ArrowDown"), "Enter"]) for (const type of ["keyDown", "keyUp"]) await target.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: ({ Home: 36, ArrowDown: 40, Enter: 13 })[key] });
  await until(() => evaluate(target, `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(String(value))}`), `select ${value}`);
}
async function screenshot(name, target = client) {
  try { await capturePngScreenshotToFile(target, join(runDir, `${name}.png`), { captureBeyondViewport: false }, 20000); }
  catch (error) { report.screenshotRetries ||= []; report.screenshotRetries.push({ name, reason: error.message }); await capturePngScreenshotToFile(target, join(runDir, `${name}.png`), { captureBeyondViewport: false, fromSurface: false }, 20000); }
  report.screenshots.push(`${name}.png`); checkpoint();
}
async function openContext(target = client, section = "knowledge") { await until(() => evaluate(target, "Boolean(document.querySelector('[data-project-context]'))"), "project context visible"); await evaluate(target, `(()=>{document.querySelector('[data-project-context]').open=true;document.querySelector(${JSON.stringify(section === "knowledge" ? ".project-context-knowledge" : "[data-result-search]")}).open=true})()`); }
async function knowledge(target = client) { await openContext(target); await button(target, "新增知识", ".project-context-knowledge"); await fill(target, '[aria-label="知识名称"]', "品牌长期规范"); await fill(target, '[aria-label="知识内容"]', knowledgeContent); await button(target, "保存知识", ".project-context-editor"); await until(async () => (await command("project.knowledge.list", { expectedProjectId: activeProject })).entries.length === 1, "knowledge saved through Main"); }
async function rail() { await button(client, "模板", ".workspace-asset-rail-tabs"); await until(() => ev("document.querySelector('.workspace-asset-rail')?.dataset.activeTab==='templates'"), "template rail"); }
async function templateEntry() { return (await command("requirement-library.list", { includeText: true })).items[0]; }
async function templateDialog(mode = "edit") { await rail(); await until(() => ev(`Boolean(document.querySelector('[data-template-edit="${currentTemplate.id}"]'))`), "template entry loaded"); await click(client, mode === "edit" ? `[data-template-edit="${currentTemplate.id}"]` : `[data-template-id="${currentTemplate.id}"]`); await until(() => ev("Boolean(document.querySelector('[data-ui-surface=requirement-template] [data-requirement-template-title], [data-ui-surface=requirement-template] [data-requirement-template-apply]'))"), "template dialog"); }
async function appliedRequirement() { const state = await command("canvas.state"); return state.nodes.find(node => node.id === state.selection.primaryId && node.type === "requirement") || state.nodes.filter(node => node.type === "requirement" && node.id !== "legacy-requirement").at(-1); }
function assertSavedRequirement(actual, expected) { assert.deepEqual({...actual,lastRunCount:actual.lastRunCount??0},{...expected,lastRunCount:expected.lastRunCount??0}); }
async function editSelectedRequirement() { await until(() => ev("Boolean(document.querySelector('.canvas-interaction-action[title=编辑需求]'))"), "selected requirement edit action"); await click(client, '.canvas-interaction-action[title="编辑需求"]'); await until(() => ev("Boolean(document.querySelector('[data-ui-surface=requirement-editor]'))"), "requirement editor opened"); }
async function setVariable(index, values) { for (const [field, value] of Object.entries(values)) { const selector = `[data-requirement-template-variable="${index}"] [data-template-variable-field="${field}"]`; if (["type", "role"].includes(field)) await select(client, selector, value); else await fill(client, selector, value); } }
async function switchProject(id) { await command("project.switch", { id }); activeProject = id; await until(async () => (await command("canvas.state")).activeProjectId === id, `switch ${id}`); await until(() => ev("Boolean(document.querySelector('.project-agent-composer textarea'))"), "switched composer"); }
async function resizeMain(width, height) { await ev(exe ? `window.resizeTo(${width},${height});undefined` : `window.naimageConfig.debugWindowBounds({width:${width},height:${height}})`); await until(()=>ev(`innerWidth===${width}&&innerHeight===${height}`), `native window ${width}x${height}`); }
async function launch() {
  debugPort = await allocateDebugPort();
  electron = spawn(exe || require("electron"), [...(!exe ? ["electron-main.cjs"] : []), `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`], { cwd: exe ? dirname(exe) : root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: exe ? "0" : "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") } });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 250, intervalMs: 100, findTarget: list => list.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea')&&window.naimageAgent?.projectContextCommand)", { evaluate, timeoutMs: 30000, intervalMs: 100 });
  await until(async () => (await command("canvas.state",{},true)).ok, "renderer command bridge ready");
  return target;
}
async function stop() {
  if (!electron) return;
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {});
  client?.close(); agentClient?.close(); client = null; agentClient = null;
  const exited = await waitForChildExit(electron, 15000); report.shutdowns.push({ exited, exitCode: electron.exitCode, forced: false });
  assert.equal(exited, true, "Isolated app exits normally"); assert.equal(electron.exitCode, 0); electron = null; checkpoint();
}

try {
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [letter, directory] of [["A", projectA], ["B", projectB]]) {
    const nodes = [];
    mkdirSync(join(directory, "assets"), { recursive: true });
    for (let index = 0; index < 2; index++) {
      const bytes = await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: letter === "A" ? 210 : 60, g: 100 + index * 55, b: letter === "A" ? 80 : 220 } } }).png().toBuffer();
      const name = `${letter}-${index ? "history" : "source"}`, relativePath = `assets/${name}.png`, file = join(directory, relativePath), contentHash = hash(bytes); writeFileSync(file, bytes);
      const node = { id: name, title: `${letter} 项目${index ? "历史场景" : "新原图"}`, type: "image", status: "done", x: 50 + index * 280, y: 90, branch: "project-agent", outputs: 1, prompt: "暖白商品详情页场景", tags: ["商品", index ? "历史" : "原图"], assets: [{ type: "file", path: file, relativePath, assetId: `image-${contentHash.slice(0, 32)}`, occurrenceId: `occ-${`${letter === "A" ? 1 : 2}${index}`.padStart(32, "0")}`, contentHash, width: 128, height: 128, mimeType: "image/png", status: "done" }] };
      nodes.push(node); fixtures.push({ bytes, node, projectId: `context-${letter.toLowerCase()}` });
    }
    if (letter === "A") nodes.push({ id: "legacy-requirement", title: "旧项目需求", type: "requirement", status: "idle", x: 50, y: 390, prompt: "保留旧项目要求", requirement: { version: 1, text: "保留旧项目要求", revision: 1, createdFrom: "canvas" } });
    const id = `context-${letter.toLowerCase()}`, conversationId = `conversation-${letter.toLowerCase()}`, info = { id, name: `${letter} 创作项目`, path: directory, sessionPath: join(directory, "session.json"), external: true };
    projectInfo.set(id, info);
    writeFileSync(info.sessionPath, JSON.stringify({ schemaVersion: 5, sessionRevision: 1, activeConversationId: conversationId, conversations: [{ id: conversationId, title: `${letter} 本地会话`, messages: [] }], nodes, messages: [], layoutGroups: [] }));
  }
  for (const count of [100, 500, 1000]) {
    const directory = join(runDir, `project-performance-${count}`), id = `performance-${count}`; mkdirSync(join(directory, "assets"), { recursive: true });
    const image = fixtures[0], file = join(directory, "assets", "fixture.png"); writeFileSync(file, image.bytes);
    const nodes = Array.from({ length: count }, (_, index) => ({ ...image.node, id: `performance-node-${index + 1}`, title: `性能条目 ${String(index + 1).padStart(4, "0")}`, x: index % 20 * 220, y: Math.floor(index / 20) * 260, assets: [{ ...image.node.assets[0], path: file, relativePath: "assets/fixture.png", occurrenceId: `occ-${(count * 10000 + index).toString(16).padStart(32, "0")}` }] }));
    const info = { id, name: `${count} 项历史成果`, path: directory, sessionPath: join(directory, "session.json"), external: true }; projectInfo.set(id, info);
    writeFileSync(info.sessionPath, JSON.stringify({ schemaVersion: 5, sessionRevision: 1, activeConversationId: `performance-conversation-${count}`, conversations: [{ id: `performance-conversation-${count}`, title: "性能检索", messages: [] }], nodes, messages: [], layoutGroups: [] }));
  }
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "context-a", projects: [...projectInfo.values()] }));
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", accountBaseUrl: base, serverUrl: base, relayBaseUrl: base, updateBaseUrl: base, serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token", agentModel: "gpt-5.6-sol", agentModelPool: ["gpt-5.6-sol"], contextStrategy: "codex", agentModelBindings: [{ model: "gpt-5.6-sol", customBaseUrl: base, customApiKey: "fixture-agent" }], imageConnectionVersion: 1, imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"], imageRatio: "1:1", imageResolution: "1K", imageQuality: "high", imageCount: 1, imageModelBindings: [{ model: "gpt-image-2", customBaseUrl: base, customApiKey: "fixture-image", protocol: "openai-images", gateway: "direct" }], imageModelConfigs: [{ model: "gpt-image-2", protocol: "openai-images", gateway: "direct", capabilities: { edit: true, referenceImages: true, multiReferenceImages: true, mask: true, supportedQualities: ["auto", "high"] } }], glassTheme: "light-classic", agentPanelWidth: 370 }));
  const aInfo = projectInfo.get("context-a");
  const owner = require("../desktop/project-creation-service.cjs").createProjectCreationService({ projectFor: id => projectInfo.get(id), readSession: id => JSON.parse(readFileSync(projectInfo.get(typeof id === "string" ? id : id.id).sessionPath, "utf8")), projectRelativePath: (directory, file) => file.slice(directory.length + 1).replaceAll("\\", "/"), resolveProjectRelativePath: (directory, file) => join(directory, file) });
  const aTarget = (({ assetId, occurrenceId, contentHash }) => ({ assetId, occurrenceId, contentHash }))(fixtures[0].node.assets[0]);
  const initial = owner.updateRequirements({ ...scopes.a, expectedRevision: 0, requirements: { goal: { text: "制作统一品牌商品场景", source: "user" }, usage: { text: "商品详情页", source: "user" }, slots: [{ slotId: "scene", label: "商品场景", source: "user" }], preserve: [{ criterionId: "identity", text: "保留来源主体与徽标", source: "user", kind: "source_consistency", sourceTargets: [aTarget] }], adjustable: [], conditions: [{ criterionId: "background", text: "暖白背景", source: "user", kind: "visual" }], fileRules: { formats: ["png"] } } });
  const aSession = JSON.parse(readFileSync(aInfo.sessionPath, "utf8"));
  aSession.nodes[1].taskProvenance = { version: 1, taskScopeSnapshotHash: `scope-${"a".repeat(32)}`, resultPolicy: "single", creation: initial.requirementRef, creationSlotId: "scene", sourceAssetId: aTarget.assetId, sourceOccurrenceId: aTarget.occurrenceId, sourceContentHash: aTarget.contentHash, sourceNodeId: "A-source" };
  writeFileSync(aInfo.sessionPath, JSON.stringify(aSession));
  if (!exe) { const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`; vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" }); await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 }); }
  await launch();

  if (!performanceOnly) {
  await check("GUI saves explicit project knowledge and the first real Main task consumes its frozen version once", async () => {
    await knowledge(); const stored = await command("project.knowledge.list", { expectedProjectId: "context-a" }); assert.equal(stored.revision, 1); assert.equal(stored.entries[0].content, knowledgeContent); assert.equal(stored.entries[0].source, "user");
    assert.equal(report.modelPosts, 0); await screenshot("knowledge-saved");
    const input = { ...scopes.a, submissionId: "knowledge-and-template-origin", prompt: "按品牌长期规范创建一张商品场景", title: "品牌商品场景方法", sourceNodeIds: ["A-source"] };
    const [first, duplicate] = await Promise.all([command("agent.task.start", input), command("agent.task.start", input)]); assert.equal(first.task.taskId, duplicate.task.taskId); firstTask = { ...scopes.a, taskId: first.task.taskId }; report.firstTaskInput = input;
    await until(async () => { const task = (await command("agent.task.get", firstTask)).task; assert.ok(!["failed", "partial", "save-failed", "interrupted"].includes(task.phase), JSON.stringify(task.error)); return task.phase === "completed"; }, "first task completes", 60000);
    const task = (await command("agent.task.get", firstTask)).task; assert.equal(task.savedCount, 1); assert.equal(task.projectKnowledge.revision, 1); assert.equal(task.projectKnowledge.entries[0].fingerprint, stored.entries[0].fingerprint); assert.equal((await command("project.context.get", scopes.a)).usedKnowledge.entries[0].content, knowledgeContent); assert.equal(report.imagePosts, 1); assert.equal(report.modelPosts, 2);
    await until(() => ev("document.querySelector('.project-context-used')?.textContent.includes('品牌长期规范')"), "actual knowledge receipt displayed");
    await ev("document.querySelector('.project-context-used').open=true"); await screenshot("actual-knowledge-used");
  });
  await check("successful task saves through existing GUI template library; four finite variable kinds can be edited without requests", async () => {
    await rail(); await until(() => ev("document.querySelector('.workspace-asset-rail-header .is-template-save')?.disabled===false"), "successful task save action ready"); await click(client, '.workspace-asset-rail-header .is-template-save'); await until(async () => (await command("requirement-library.list")).items.length === 1, "successful task saved as template"); currentTemplate = await templateEntry();
    assert.equal(currentTemplate.version, 2); assert.equal(currentTemplate.template.variables[0].type, "image");
    await templateDialog(); await fill(client, "[data-requirement-template-title]", "跨项目商品场景"); await fill(client, "[data-requirement-template-text]", "为{{product}}创建{{count}}张{{tone}}商品场景，使用{{source_1}}。");
    await setVariable(0, { label: "本次商品原图" });
    await click(client, "[data-requirement-template-add]"); await setVariable(1, { key: "product", label: "商品名称", maxLength: "80" });
    await click(client, "[data-requirement-template-add]"); await setVariable(2, { type: "enum", key: "tone", label: "色调", options: "暖色\n冷色", default: "暖色" });
    await click(client, "[data-requirement-template-add]"); await setVariable(3, { type: "number", key: "count", label: "数量", min: "1", max: "5", step: "1", default: "1" });
    await fill(client, "[data-requirement-template-scenario]", "商品详情页场景"); await fill(client, "[data-requirement-template-material]", "清晰商品原图"); await fill(client, "[data-requirement-template-style]", "暖白背景，保留真实外观");
    await click(client, "[data-requirement-template-save]"); await until(async () => (await templateEntry()).revision === 2, "variable template revision committed"); currentTemplate = await templateEntry(); assert.deepEqual(currentTemplate.template.variables.map(variable => variable.type), ["image", "text", "enum", "number"]);
    await screenshot("template-variables-edited"); await button(client, "关闭", "[data-ui-surface=requirement-template]"); assert.equal(report.modelPosts, 2); assert.equal(report.imagePosts, 1);
  });
  await check("missing scalar fails locally; missing picture draft is explicitly rebound by variable name and saved as an independent snapshot", async () => {
    await templateDialog("use"); await click(client, "[data-requirement-template-apply]"); await until(() => ev("Boolean(document.querySelector('[data-requirement-template-error]'))"), "required scalar rejected");
    await fill(client, '[data-requirement-template-value="product"]', "音箱"); await click(client, "[data-requirement-template-apply]"); await until(() => ev("!document.querySelector('[data-ui-surface=requirement-template]')"), "unbound draft inserted");
    const draft = await appliedRequirement(); assert.equal(draft.requirement.templateDraft.unboundImages.length, 1);
    const rejected = await command("canvas.execute-requirement", { nodeId: draft.id, expectedRevision: 1, expectedProjectId: "context-a" }, true); assert.equal(rejected.ok, false); assert.equal(report.modelPosts, 2);
    await editSelectedRequirement(); assert.equal(await ev("document.querySelector('[data-requirement-template-rebind=source_1]').value"), ""); assert.equal(await ev("[...document.querySelector('[data-ui-surface=requirement-editor]').querySelectorAll('button')].find(e=>e.textContent.trim()==='保存并执行').disabled"), true);
    await select(client, '[data-requirement-template-rebind="source_1"]', "A-source"); await screenshot("template-draft-named-rebind-a"); await resizeMain(884, 640); await ev("document.querySelector('[data-requirement-template-rebind=source_1]').scrollIntoView({block:'center'})");
    const editorMinimum = await ev("({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,controls:[document.querySelector('[data-requirement-template-rebind=source_1]'),...document.querySelector('[data-ui-surface=requirement-editor]').querySelectorAll('.ui-surface-footer button')].map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}})})"); assert.equal(editorMinimum.overflow,false); assert.ok(editorMinimum.controls.length>=4); assert.ok(editorMinimum.controls.every(control=>control.visible)); report.bounds.push({surface:"requirement-editor",...editorMinimum}); await screenshot("template-editor-minimum-884x640"); await resizeMain(1280,720);
    await button(client, "保存", "[data-ui-surface=requirement-editor]"); await until(() => ev("!document.querySelector('[data-ui-surface=requirement-editor]')"), "rebound draft saved");
    oldApplied = await appliedRequirement(); assert.equal(oldApplied.id, draft.id); assert.equal(oldApplied.requirement.text, "为音箱创建1张暖色商品场景，使用当前素材：本次商品原图。"); assert.equal(oldApplied.requirement.template.revision, 2); assert.equal(oldApplied.requirement.templateDraft.unboundImages.length, 0); assert.deepEqual(oldApplied.requirement.templateDraft.imageBindings, [{ key: "source_1", nodeId: "A-source", role: "source" }]); assert.deepEqual(oldApplied.requirement.inputBindings, [{ nodeId: "A-source", role: "source" }]); assert.equal(oldApplied.relation.parentId, "A-source");
    await editSelectedRequirement(); assert.equal(await ev("document.querySelector('[data-requirement-template-rebind=source_1]').value"), "A-source"); await button(client, "取消", "[data-ui-surface=requirement-editor]");
    await templateDialog("use"); await fill(client, '[data-requirement-template-value="product"]', "耳机"); await click(client, "[data-requirement-template-apply]"); await until(() => ev("!document.querySelector('[data-ui-surface=requirement-template]')"), "user edited missing-image draft inserted"); await editSelectedRequirement();
    const userText = "这是我保留的补充要求；本次只使用命名变量选择的原图，不自动重写正文。"; await fill(client, '[data-ui-surface=requirement-editor] textarea', userText); await select(client, '[data-requirement-template-rebind="source_1"]', "A-history"); await button(client, "保存", "[data-ui-surface=requirement-editor]"); await until(() => ev("!document.querySelector('[data-ui-surface=requirement-editor]')"), "user edited rebound draft saved"); userEditedRequirement = await appliedRequirement(); assert.equal(userEditedRequirement.requirement.text,userText); assert.deepEqual(userEditedRequirement.requirement.inputBindings,[{nodeId:"A-history",role:"source"}]);
    await templateDialog(); await fill(client, "[data-requirement-template-text]", "新版方法：为{{product}}创建{{count}}张{{tone}}商品场景，使用{{source_1}}。"); await click(client, "[data-requirement-template-save]"); await until(async () => (await templateEntry()).revision === 3, "template update independent"); await button(client, "关闭", "[data-ui-surface=requirement-template]");
    const unchanged = (await command("canvas.state")).nodes.find(node => node.id === oldApplied.id); assert.deepEqual(unchanged.requirement, oldApplied.requirement); assert.equal(report.imagePosts, 1); await screenshot("template-applied-a");
  });
  await check("project B requires current images and executes the same original pipeline with B bytes and frozen template revision", async () => {
    await switchProject("context-b"); assert.equal((await command("project.knowledge.list", { expectedProjectId: "context-b" })).entries.length, 0); await templateDialog("use");
    const choices = await ev("[...document.querySelector('[data-requirement-template-value=source_1]').options].map(option=>option.value)"); assert.equal(choices.some(value => value.startsWith("A-")), false); assert.ok(choices.includes("B-source"));
    await fill(client, '[data-requirement-template-value="product"]', "台灯"); await select(client, '[data-requirement-template-value="tone"]', "冷色"); await select(client, '[data-requirement-template-value="source_1"]', "B-source"); await screenshot("template-rebind-b"); await select(client, '[data-requirement-template-value="source_1"]', ""); await click(client, "[data-requirement-template-apply]");
    await until(() => ev("!document.querySelector('[data-ui-surface=requirement-template]')"), "B draft inserted"); boundB = await appliedRequirement(); assert.equal(boundB.requirement.template.revision, 3); assert.equal(boundB.requirement.text.includes("台灯"), true); assert.equal(boundB.requirement.templateDraft.unboundImages.length, 1); assert.equal(report.imagePosts, 1);
    await editSelectedRequirement(); const reboundChoices = await ev("[...document.querySelector('[data-requirement-template-rebind=source_1]').options].map(option=>option.value)"); assert.equal(reboundChoices.some(value=>value.startsWith('A-')), false); await select(client, '[data-requirement-template-rebind="source_1"]', "B-source"); await screenshot("template-draft-named-rebind-b"); await button(client, "保存并执行", "[data-ui-surface=requirement-editor]");
    await until(async () => { const result = await command("agent.task.get", scopes.b, true); const phase = result.result?.task?.phase; assert.ok(!["failed", "partial", "save-failed", "interrupted"].includes(phase), JSON.stringify(result)); return phase === "completed"; }, "GUI rebound B task completes", 60000);
    boundB = (await command("canvas.state")).nodes.find(node=>node.id===boundB.id); assert.equal(boundB.requirement.revision, 2); assert.deepEqual(boundB.requirement.inputBindings, [{ nodeId: "B-source", role: "source" }]);
    secondTask = (await command("agent.task.get", scopes.b)).task; assert.equal(secondTask.phase, "completed"); assert.equal(secondTask.template.revision, 3); assert.equal(secondTask.savedCount, 1); assert.equal(secondTask.projectKnowledge.entries.length, 0);
    const frozen = await command("creation.requirements.get", { ...scopes.b, taskId: secondTask.taskId }); const bAsset = fixtures.find(item => item.node.id === "B-source").node.assets[0]; assert.equal(frozen.requirements.preserve[0].sourceTargets[0].occurrenceId, bAsset.occurrenceId); assert.equal(JSON.stringify(frozen).includes(aTarget.occurrenceId), false);
    const repeat = await command("canvas.execute-requirement", { nodeId: boundB.id, expectedRevision: 2, expectedProjectId: "context-b" }, true); assert.equal(repeat.ok, false); assert.equal(repeat.code, "REQUIREMENT_RERUN_CONFIRMATION_REQUIRED"); assert.equal(report.imagePosts, 2); assert.equal(report.modelPosts, 4); await screenshot("template-b-saved");
  });
  await check("real result search locates and compares pixels; only explicit use adds selected material", async () => {
    await switchProject("context-a"); await openContext(client, "search"); const chipsBefore = await ev("document.querySelectorAll('.project-agent-material-chip').length");
    await fill(client, '[aria-label="成果关键词"]', "商品"); await button(client, "检索成果", "[data-result-search]"); await until(() => ev("document.querySelectorAll('[data-search-result]').length>=2"), "search results visible"); assert.equal(await ev("document.querySelectorAll('.project-agent-material-chip').length"), chipsBefore);
    const search = await command("project.results.search", { expectedProjectId: "context-a", query: { text: "商品" }, limit: 20, sort: "relevance" }); assert.ok(search.results.length >= 2); assert.ok(search.results.every(item => item.observation.status === "unobserved"));
    await button(client, "画布定位", "[data-search-result]"); const located = (await command("canvas.state")).selection; assert.equal(located.primaryId, search.results[0].nodeId); const locatedMaterials = await ev("[...document.querySelectorAll('.project-agent-material-chip')].map(e=>e.textContent)");
    await click(client, '[data-search-result]:nth-child(1) input[type=checkbox]'); await click(client, '[data-search-result]:nth-child(2) input[type=checkbox]'); await button(client, "比较两项", ".project-context-selection"); await until(() => ev("Boolean(document.querySelector('[aria-label=所选成果对比]'))"), "comparison opened");
    assert.equal(await ev("Promise.all([...document.querySelectorAll('.project-result-comparison img')].map(async image=>{await image.decode();return image.naturalWidth>0})).then(values=>values.length===2&&values.every(Boolean))"), true); await screenshot("results-compared"); await click(client, '[aria-label="关闭成果对比"]');
    assert.deepEqual(await ev("[...document.querySelectorAll('.project-agent-material-chip')].map(e=>e.textContent)"), locatedMaterials); await button(client, "作为参考图", ".project-context-selection"); await until(() => ev("document.querySelectorAll('.project-agent-material-chip.role-reference').length>=2"), "explicit result use binds selected references"); assert.equal(report.imagePosts, 2); await screenshot("results-explicit-use");
    await select(client, '[aria-label="成果描述来源"]', "observed"); await fill(client, '[aria-label="成果描述关键词"]', "商品"); await button(client, "检索成果", "[data-result-search]"); await until(() => ev("document.querySelector('.project-context-search-count')?.textContent.includes('找到 0 项')"), "unobserved description is not invented");
    await button(client, "清空筛选", "[data-result-search]"); await button(client, "检索成果", "[data-result-search]"); await until(() => ev("document.querySelectorAll('[data-search-result]').length>=3"), "all local results returned");
  });
  await check("primary and detached windows share knowledge CAS, preserve stale drafts, and expose usable minimum-window surfaces", async () => {
    await openContext(); await button(client, "编辑", "[data-knowledge-entry]"); await fill(client, '[aria-label="知识内容"]', "主窗尚未保存的草稿");
    await click(client, '[aria-label="调整对话框位置"]'); await button(client, "独立浮动窗口", ".agent-placement-menu");
    const target = await pollForDebugTarget({ port: debugPort, attempts: 100, intervalMs: 100, findTarget: list => list.find(item => item.type === "page" && /agent-window\.html/.test(item.url)) }); agentClient = new BasicCdpClient(target.webSocketDebuggerUrl); await agentClient.open(); await agentClient.send("Runtime.enable"); await agentClient.send("Page.enable");
    await click(client, '[aria-label="展开项目 Agent"]'); await openContext(); assert.equal(await ev("document.querySelector('[aria-label=知识内容]')?.value"), "主窗尚未保存的草稿", "Detaching and reopening the main panel preserves its unsaved knowledge draft");
    await openContext(agentClient); await button(agentClient, "编辑", "[data-knowledge-entry]"); await fill(agentClient, '[aria-label="知识内容"]', `${knowledgeContent} 字号应清晰。`); await button(agentClient, "保存知识", ".project-context-editor"); await until(async () => (await command("project.knowledge.list", { expectedProjectId: "context-a" })).revision === 2, "detached knowledge saved");
    await until(() => ev("document.querySelector('.project-context-editor')?.textContent.includes('知识已在另一窗口更新')"), "stale primary draft detected"); assert.equal(await ev("document.querySelector('[aria-label=知识内容]').value"), "主窗尚未保存的草稿"); assert.equal(await ev("document.querySelector('.project-context-editor button[type=submit]').disabled"), true);
    await screenshot("knowledge-cas-primary"); await screenshot("knowledge-cas-detached", agentClient); await button(client, "载入最新版本", ".project-context-editor"); assert.equal(await ev("document.querySelector('[aria-label=知识内容]').value"), `${knowledgeContent} 字号应清晰。`); await button(client, "取消编辑", ".project-context-editor");
    const used = await command("project.context.get", scopes.a); assert.equal(used.usedKnowledge.revision, 1); assert.equal(used.usedKnowledge.entries[0].content, knowledgeContent);
    await resizeMain(884,640); await delay(200); await openContext();
    const dimensions = await ev("({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})"); assert.equal(dimensions.width, 884); assert.equal(dimensions.height, 640); assert.equal(dimensions.overflow, false); report.bounds.push(dimensions);
    await ev("document.querySelector('[data-project-context] > summary').scrollIntoView({block:'center'})"); await screenshot("context-minimum-884x640");
    await button(client, "停用", "[data-knowledge-entry]"); await until(async () => (await command("project.knowledge.list", { expectedProjectId: "context-a" })).revision === 3, "knowledge deactivated"); assert.equal((await command("project.context.get", scopes.a)).usedKnowledge.revision, 1); assert.equal(report.modelPosts, 4);
  });
  }
  if (!skipPerformance) await check("100, 500 and 1000 historical assets search through the real service and render a bounded interactive page", async () => {
    report.performance = [];
    for (const count of [100, 500, 1000]) {
      const switching = performance.now(); await switchProject(`performance-${count}`); await openContext(client, "search"); const projectReadyMs = Math.round(performance.now() - switching);
      const queryStart = performance.now(); const direct = await command("project.results.search", { expectedProjectId: activeProject, query: { text: "性能条目" }, limit: 20, sort: "relevance" }); const serviceMs = Math.round(performance.now() - queryStart); assert.equal(direct.total, count); assert.equal(direct.results.length, 20);
      const hotQueryMs = []; for (let repeat = 0; repeat < 3; repeat++) { const start = performance.now(); const hot = await command("project.results.search", { expectedProjectId: activeProject, query: { text: "性能条目" }, limit: 20, sort: "relevance" }); hotQueryMs.push(Math.round(performance.now() - start)); assert.equal(hot.total, count); assert.deepEqual(hot.results.map(item=>item.occurrenceId), direct.results.map(item=>item.occurrenceId)); }
      await fill(client, '[aria-label="成果关键词"]', "性能条目"); const uiStart = performance.now(); await button(client, "检索成果", "[data-result-search]"); await until(() => ev(`document.querySelector('.project-context-search-count')?.textContent.includes('找到 ${count} 项')&&document.querySelectorAll('[data-search-result]').length===20`), `${count} result UI`); const uiSearchMs = Math.round(performance.now() - uiStart);
      const responsiveStart = performance.now(); await fill(client, '[aria-label="成果关键词"]', "性能条目 0001"); await ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); const inputMs = Math.round(performance.now() - responsiveStart); assert.equal(await ev("document.querySelector('[aria-label=成果关键词]').value"), "性能条目 0001");
      report.performance.push({ assets: count, projectReadyMs, serviceMs, hotQueryMs, uiSearchMs, inputMs, renderedResults: 20, total: direct.total }); await screenshot(`search-${count}-assets`); checkpoint();
    }
    await switchProject("context-a");
  });
  if (!performanceOnly) await check("new conversation, actual save/reload and normal restart retain old projects and immutable task/template snapshots", async () => {
    await command("agent.new-conversation"); const newConversation = (await command("canvas.state")).activeConversationId; assert.notEqual(newConversation, scopes.a.conversationId);
    const next = await command("project.context.get", { expectedProjectId: "context-a", conversationId: newConversation }); assert.equal(next.entries[0].status, "inactive"); assert.equal(next.usedKnowledge, undefined);
    await until(() => JSON.parse(readFileSync(aInfo.sessionPath, "utf8")).activeConversationId === newConversation, "new conversation actually saved to original session"); await client.send("Page.reload"); await until(() => ev("Boolean(document.querySelector('.project-agent-composer textarea'))"), "actual save reload"); await until(async () => (await command("canvas.state",{},true)).ok, "reloaded renderer command bridge ready");
    const reloaded = await command("canvas.state"); assert.ok(reloaded.nodes.some(node => node.id === "legacy-requirement" && node.requirement.text === "保留旧项目要求")); assertSavedRequirement(reloaded.nodes.find(node => node.id === oldApplied.id).requirement, oldApplied.requirement); assertSavedRequirement(reloaded.nodes.find(node => node.id === userEditedRequirement.id).requirement,userEditedRequirement.requirement);
    await stop(); await launch(); activeProject = "context-a";
    const after = await command("canvas.state"); assert.ok(after.nodes.some(node => node.id === "legacy-requirement")); assert.equal((await templateEntry()).revision, 3);
    const duplicate = await command("agent.task.start", report.firstTaskInput); assert.equal(duplicate.task.taskId, firstTask.taskId); assert.equal(duplicate.task.phase, "completed"); assert.equal(report.modelPosts, 4); assert.equal(report.imagePosts, 2);
    await switchProject("context-b"); const b = await command("canvas.state"); assert.equal(b.nodes.find(node => node.id === boundB.id).requirement.template.revision, 3); assert.equal((await command("agent.task.get", { ...scopes.b, taskId: secondTask.taskId })).task.phase, "completed");
    for (const fixture of fixtures) assert.equal(hash(readFileSync(fixture.node.assets[0].path)), fixture.node.assets[0].contentHash); await screenshot("restart-project-b");
  });
  await stop(); report.ok = true; checkpoint(); console.log(JSON.stringify({ ok: true, checks: report.checks.length, modelPosts: report.modelPosts, imagePosts: report.imagePosts, screenshots: report.screenshots.length, report: join(runDir, "report.json") }));
} catch (error) {
  report.error = error.stack; process.exitCode = 1; console.error(error);
  if (agentClient) { report.detachedFailureState = await evaluate(agentClient, "({body:document.body.innerText.slice(-7000),editors:[...document.querySelectorAll('.project-context-editor')].map(e=>e.innerText)})").catch(cause=>({error:cause.message})); await screenshot("failure-detached",agentClient).catch(()=>{}); }
  if (client) { report.failureState = await ev("({body:document.body.innerText.slice(-7000),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.innerText.slice(0,1200))})").catch(cause => ({ error: cause.message })); await screenshot("failure").catch(() => {}); await stop().catch(cause => { report.shutdownError = cause.message; }); }
  checkpoint();
} finally { if (vite) vite.kill(); server.closeAllConnections(); server.close(); }
