import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

const root = resolve(import.meta.dirname, ".."), require = createRequire(import.meta.url), exe = process.argv.find(arg => arg.startsWith("--exe="))?.slice(6);
const { buildProductionSymbolPlan, transformCode } = require("./production-symbol-compaction.cjs");
const symbolPlan = exe ? buildProductionSymbolPlan(root) : null;
const evaluate = (target, expression) => evaluateRaw(target, symbolPlan ? transformCode(expression, symbolPlan, "export-ui-test.js") : expression);
const runDir = join(root, ".diagnostics", `export-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`), config = join(runDir, "config"), projectRoot = join(runDir, "project");
for (const directory of [config, join(projectRoot, "assets")]) mkdirSync(directory, { recursive: true });
const report = { ok: false, checks: [], screenshots: [], realModelRequests: 0, modelRequests: 0, shutdowns: [], fixture: "Existing real product/photographic artwork; alpha border is a local test copy" };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let electron, vite, client, second, devUrl = "";
const server = createServer(async (request, response) => {
  for await (const chunk of request) {}
  if (/\/images|\/responses|\/chat|\/prompt/.test(request.url)) { report.modelRequests++; checkpoint(); response.writeHead(500); response.end("No model requests allowed in export UI test"); return; }
  response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ success: true, data: { id: 1, username: "export-fixture", quota: 100000, items: [] } }));
});
const ev = expression => evaluate(client, expression);
async function until(predicate, label, timeout = 60000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await predicate()) return; await delay(100); } throw new Error(`Timeout: ${label}`); }
async function command(name, args = {}, raw = false) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const response = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command: name, args, timeoutMs: 90000 }), signal: AbortSignal.timeout(100000) })).json();
  if (raw) return response; assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`); return response.result;
}
async function click(selector, target = client) {
  await evaluate(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing/disabled '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'})})()`);
  let point, previous;
  await until(async () => {
    const next = await evaluate(target, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,visible:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(x,y))}})()`);
    const stable = next?.visible && previous && Math.abs(next.x - previous.x) < .5 && Math.abs(next.y - previous.y) < .5; previous = next; if (stable) point = { x: next.x, y: next.y }; return stable;
  }, `visible ${selector}`, 12000);
  for (const type of ["mousePressed", "mouseReleased"]) await target.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}
async function button(text, within = "body", target = client) {
  await evaluate(target, "document.querySelectorAll('[data-export-test-click]').forEach(e=>e.removeAttribute('data-export-test-click'))");
  await until(() => evaluate(target, `(()=>{const scope=document.querySelector(${JSON.stringify(within)});const e=scope&&[...scope.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.dataset.exportTestClick='yes';return true})()`), `button ${text}`, 12000);
  await click('[data-export-test-click="yes"]', target); await evaluate(target, "document.querySelector('[data-export-test-click]')?.removeAttribute('data-export-test-click')");
}
async function selectField(label, value) {
  const selector = await ev(`(()=>{const field=[...document.querySelectorAll('.export-center-config .ui-field')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}));const e=field?.querySelector('select');if(!e)throw new Error('Missing field '+${JSON.stringify(label)});e.dataset.exportSelect='yes';return '[data-export-select=yes]'})()`);
  const index = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.focus();return [...e.options].findIndex(o=>o.value===${JSON.stringify(value)})})()`); assert.ok(index >= 0);
  for (const key of ["Home", ...Array(index).fill("ArrowDown"), "Enter"]) for (const type of ["keyDown", "keyUp"]) await client.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: ({ Home: 36, ArrowDown: 40, Enter: 13 })[key] });
  await until(() => ev(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`), `select ${label}`);
  await ev("document.querySelector('[data-export-select]')?.removeAttribute('data-export-select')");
}
async function screenshot(name, target = client) { const file = join(runDir, `${name}.png`); await capturePngScreenshotToFile(target, file, { captureBeyondViewport: false }); report.screenshots.push(file); checkpoint(); }
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); console.log(`ok ${report.checks.length} ${name}`); }
async function openCenter() {
  await click('button[title="管理项目文件夹、迁移旧数据和导入导出"]'); await button("导出中心");
  await until(() => ev("Boolean(document.querySelector('[data-ui-surface=export-center]'))"), "export center");
}
async function jobs() { return await command("export.status", { expectedProjectId: "export-ui" }); }
async function idle() { await until(async () => (await jobs()).jobs.every(job => !["queued", "running"].includes(job.status)), "Main export idle", 180000); }
async function stop() {
  if (!electron) return;
  if (second) { await evaluate(second, "void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),40)").catch(() => {}); second.close(); second = null; }
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {}); client?.close(); client = null;
  const exited = await waitForChildExit(electron, 20000); report.shutdowns.push({ exited, exitCode: electron.exitCode, forced: false }); assert.equal(exited, true); assert.equal(electron.exitCode, 0); electron = null;
}

try {
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen)); const base = `http://127.0.0.1:${server.address().port}`;
  const photo = readFileSync(join(root, "docs/assets/github/02-product.jpg"));
  const rgba = await sharp(photo).resize(768, 768).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < 768; y++) for (let x = 0; x < 768; x++) if (x < 20 || y < 20 || x >= 748 || y >= 748) rgba[(y * 768 + x) * 4 + 3] = 0;
  const alpha = await sharp(rgba, { raw: { width: 768, height: 768, channels: 4 } }).png().toBuffer();
  const assets = [];
  for (let index = 0; index < 18; index++) {
    const bytes = index === 0 ? alpha : readFileSync(join(root, `docs/assets/github/${["02-product", "03-reference-edit", "04-portrait", "06-food"][index % 4]}.jpg`));
    const relativePath = `assets/photo-${index}.${index === 0 ? "png" : "jpg"}`; writeFileSync(join(projectRoot, relativePath), bytes);
    assets.push({ type: "file", path: join(projectRoot, relativePath), relativePath, assetId: `image-${hash(bytes).slice(0, 32)}`, occurrenceId: `occ-${(index + 1).toString(16).padStart(32, "0")}`, contentHash: hash(bytes), width: index === 0 ? 768 : 1024, height: index === 0 ? 768 : 1024, mimeType: index === 0 ? "image/png" : "image/jpeg", status: "done" });
  }
  const collection = { id: "photo-collection", name: "商品与摄影成果", kind: "batch", collectionRole: "results", generationMode: "parallel", createdAt: new Date().toISOString(), items: assets.slice(0, 2).map((asset, index) => ({ id: `item-${index}`, assetId: asset.assetId, occurrenceId: asset.occurrenceId, assetIndex: index + 1, requestIndex: index + 1, prompt: "Existing real product artwork", status: "done" })) };
  const nodes = [{ id: "photos", title: "真实商品图组", type: "image", status: "done", imageState: "done", x: 50, y: 80, width: 300, height: 240, assets: assets.slice(0, 2), imageCollection: collection, imageContainerSpec: { collection } }, ...assets.slice(2).map((asset, index) => ({ id: `photo-${index}`, title: `摄影作品 ${index + 1}`, type: "image", status: "done", imageState: "done", x: 380 + index % 4 * 240, y: 80 + Math.floor(index / 4) * 250, width: 220, height: 220, assets: [asset] }))];
  const project = { id: "export-ui", name: "导出交互验证", path: projectRoot, sessionPath: join(projectRoot, "session.json"), external: true };
  writeFileSync(project.sessionPath, JSON.stringify({ schemaVersion: 5, sessionRevision: 1, activeConversationId: "conversation", conversations: [{ id: "conversation", title: "导出验收", messages: [] }], nodes, messages: [], layoutGroups: [] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: project.id, projects: [project] }));
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", accountBaseUrl: base, serverUrl: base, serverUserId: "1", serverToken: "fixture", serverSessionCookie: "fixture", imageModel: "gpt-image-2", agentModel: "gpt-5.6-sol", glassTheme: "light-classic" }));
  writeFileSync(join(runDir, "no-server.cjs"), 'const timer=setInterval(()=>{},1000);process.on("message",v=>{if(v==="shutdown"){clearInterval(timer);process.exit(0)}});');
  if (!exe) { const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`; vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" }); await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 }); }
  const port = await allocateDebugPort();
  electron = spawn(exe || require("electron"), [...(!exe ? ["electron-main.cjs"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${join(runDir, "user-data")}`], { cwd: exe ? dirname(exe) : root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: exe ? "0" : "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") } });
  const target = await pollForDebugTarget({ port, attempts: 250, intervalMs: 100, findTarget: list => list.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea')&&window.naimageConfig?.exportManagedAssetQueue)", { evaluate, timeoutMs: 45000, intervalMs: 100 });
  await until(async () => (await command("canvas.state", {}, true)).ok, "automation ready");

  await check("original format defaults, real photo alpha preview, naming and target shown", async () => {
    await command("canvas.select", { expectedProjectId: project.id, ids: ["photo-0"], primaryId: "photo-0" }); await openCenter();
    assert.equal(await ev("[...document.querySelectorAll('.export-center-config select')].some(e=>e.value==='original')"), true);
    await button("全选", ".export-center-selection");
    await until(() => ev("[...document.querySelectorAll('.export-center-source-thumbnail img')].some(e=>e.complete&&e.naturalWidth>0)"), "real photo thumbnails");
    report.thumbnail = await ev("(()=>{const e=document.querySelector('.export-center-source-thumbnail');return {background:getComputedStyle(e).backgroundImage,count:document.querySelectorAll('.export-center-source-thumbnail img').length}})()");
    assert.match(report.thumbnail.background, /conic-gradient/); await screenshot("original-photos-alpha-preview");
  });
  await check("Main queue continues after actual panel closure and reopens with per-item results", async () => {
    await selectField("格式", "avif"); await button("加入导出队列", "[data-ui-surface=export-center]");
    await until(async () => (await jobs()).jobs.length > 0, "Main accepted");
    report.beforeClose = (await jobs()).jobs.map(job => ({ queueId: job.queueId, status: job.status, completed: job.completed, total: job.total }));
    assert.ok(report.beforeClose.some(job => ["queued", "running"].includes(job.status)), "Queue must still be active before closing its panel");
    await button("关闭", "[data-ui-surface=export-center]"); await until(() => ev("!document.querySelector('[data-ui-surface=export-center]')"), "panel actually closed"); await screenshot("panel-closed-main-continues");
    await idle(); const completed = (await jobs()).jobs[0]; assert.equal(completed.status, "succeeded", JSON.stringify(completed.results)); assert.equal(completed.results.length, 18);
    await openCenter(); await ev("[...document.querySelectorAll('.export-center-view-tabs button')].find(e=>e.textContent.startsWith('队列')).dataset.exportTestClick='yes'"); await click('[data-export-test-click=yes]'); await until(() => ev("document.querySelector('[data-job-status=succeeded]')!==null"), "completed job visible"); await screenshot("reopened-main-queue");
  });
  await check("photo group original ZIP preserves transaction and PSD uses same queue without target dialogs", async () => {
    const legacy = await command("canvas.export-image-collections", { expectedProjectId: project.id, collectionIds: ["photo-collection"], confirmed: true });
    assert.equal(legacy.accepted, true); assert.ok(legacy.queueId); await idle();
    const legacyJob = (await jobs()).jobs.find(job => job.queueId === legacy.queueId); assert.equal(legacyJob.status, "succeeded", JSON.stringify(legacyJob)); assert.equal(legacyJob.config.format, "original");
    await button("添加任务", "[data-ui-surface=export-center]"); await button("图片组", ".export-center-targets"); await button("全选", ".export-center-selection"); await selectField("格式", "original"); await selectField("交付方式", "zip");
    let before = new Set((await jobs()).jobs.map(job => job.queueId)); await button("加入导出队列", "[data-ui-surface=export-center]"); await until(async () => (await jobs()).jobs.some(job => !before.has(job.queueId)), "collection Main admission");
    await idle(); let completed = (await jobs()).jobs.find(job => !before.has(job.queueId)); assert.equal(completed.status, "succeeded", JSON.stringify(completed)); assert.equal(completed.config.target, "collection"); assert.equal(completed.config.container, "zip"); await screenshot("group-zip-completed");
    await button("添加任务", "[data-ui-surface=export-center]"); await button("PSD", ".export-center-targets"); await click(".export-center-source-row input[type=checkbox]"); before = new Set((await jobs()).jobs.map(job => job.queueId)); await button("加入导出队列", "[data-ui-surface=export-center]"); await until(async () => (await jobs()).jobs.some(job => !before.has(job.queueId)), "PSD Main admission"); await idle(); completed = (await jobs()).jobs.find(job => !before.has(job.queueId)); assert.equal(completed.status, "succeeded", JSON.stringify(completed)); assert.equal(completed.config.target, "psd"); assert.equal(completed.config.container, "folder"); await screenshot("psd-main-queue-completed");
  });
  await check("two real windows project the same Main jobs and durable history", async () => {
    await button("关闭", "[data-ui-surface=export-center]");
    await ev("window.naimageConfig.newWindow({projectId:'export-ui'})");
    const other = await pollForDebugTarget({ port, attempts: 150, intervalMs: 100, findTarget: list => list.find(item => item.type === "page" && item.id !== target.id && !/agent-window/.test(item.url)) });
    second = new BasicCdpClient(other.webSocketDebuggerUrl); await second.open(); await second.send("Runtime.enable"); await second.send("Page.enable");
    await waitForRuntimeExpression(second, "Boolean(window.naimageConfig?.exportManagedAssetQueue&&document.querySelector('.project-agent-composer'))", { evaluate, timeoutMs: 45000, intervalMs: 100 });
    const projection = await evaluate(second, "window.naimageConfig.exportManagedAssetQueue.status({projectId:'export-ui'})"); assert.deepEqual(projection.jobs.map(job => job.queueId), (await jobs()).jobs.map(job => job.queueId));
    await click('button[title="管理项目文件夹、迁移旧数据和导入导出"]', second); await button("导出中心", "body", second);
    await until(() => evaluate(second, "Boolean(document.querySelector('[data-ui-surface=export-center]'))"), "second window export");
    await evaluate(second, "[...document.querySelectorAll('.export-center-view-tabs button')].find(e=>e.textContent.startsWith('历史')).dataset.exportTestClick='yes'"); await click('[data-export-test-click=yes]', second);
    await until(() => evaluate(second, "document.querySelectorAll('[data-history-status=succeeded]').length>=3"), "durable history visible"); await screenshot("second-window-history", second);
    const receipt = readFileSync(join(projectRoot, ".naimage/export-jobs.json"), "utf8"); assert.equal(receipt.includes(projectRoot), false); assert.equal(report.modelRequests, 0);
  });
  await stop(); report.ok = true; checkpoint(); console.log(JSON.stringify({ ok: true, checks: report.checks.length, screenshots: report.screenshots.length, report: join(runDir, "report.json") }));
} catch (error) {
  report.error = error.stack; process.exitCode = 1; console.error(error);
  if (client) { report.failureBody = await ev("document.body.innerText.slice(-8000)").catch(() => "unavailable"); await screenshot("failure").catch(() => {}); await stop().catch(error => { report.shutdownError = error.message; }); } checkpoint();
} finally { if (vite) vite.kill(); server.closeAllConnections(); server.close(); }
