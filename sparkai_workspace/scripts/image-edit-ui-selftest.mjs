import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";
import { AI_IMAGE_EDIT_MODES } from "../runtime/image-edit-modes.mjs";

const root = resolve(import.meta.dirname, "..");
const runDir = join(root, ".diagnostics", `image-edit-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project");
mkdirSync(config, { recursive: true }); mkdirSync(join(project, "assets"), { recursive: true });
const report = { ok: false, realModelRequests: 0, imagePosts: 0, modelPosts: 0, checks: [], screenshots: [], wire: [], pixelChecks: [], serverErrors: [], windows: [] };
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceBytes = await sharp(join(root, "docs/assets/github/02-product.jpg")).resize(256, 256).png().toBuffer();
const outputBytes = await sharp(join(root, "docs/assets/github/03-reference-edit.jpg")).resize(256, 256).png().toBuffer();
const cutoutMask = Buffer.from('<svg width="256" height="256"><path d="M35 113 L55 109 L62 92 L79 82 L169 69 L189 73 L200 87 L204 100 L203 128 L191 140 L100 153 L79 148 L65 145 L41 137 Z" fill="white"/></svg>');
const cutoutBytes = await sharp(sourceBytes).ensureAlpha().composite([{ input: cutoutMask, blend: "dest-in" }]).png().toBuffer();
const sourceFile = join(project, "assets", "source.png"); writeFileSync(sourceFile, sourceBytes);
const sourceTarget = { assetId: `asset-${hash(sourceBytes).slice(0, 32)}`, occurrenceId: `occ-${"1".repeat(32)}`, contentHash: hash(sourceBytes) };
const sourceNode = { id: "N0001", title: "编辑原图", type: "image", status: "done", imageState: "done", x: 80, y: 80, width: 256, height: 256, zOrder: 1,
  assets: [{ ...sourceTarget, type: "file", path: sourceFile, relativePath: "assets/source.png", width: 256, height: 256, mimeType: "image/png", status: "done" }] };
let vite, electron, client, devUrl = "";
const ev = expression => evaluateRuntime(client, expression);
const wait = expression => until(async () => {
  try { return await ev(expression); }
  catch (error) {
    if (/context|navigated|closed/i.test(error.message)) return false;
    throw error;
  }
}, expression);
const state = () => ev("window.__naimageDebugAgentState()");
async function until(predicate, name, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (report.serverErrors.length) throw new Error(report.serverErrors[0]);
    if (await predicate()) return;
    await delay(80);
  }
  throw new Error(`Timeout: ${name}`);
}
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); }
async function command(command, args = {}) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
  const value = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: JSON.stringify({ command, args, timeoutMs: 15000 }), signal: AbortSignal.timeout(20000) })).json();
  assert.equal(value.ok, true, `${command}: ${JSON.stringify(value).slice(0, 700)}`); return value.result;
}
async function rect(selector) { return ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()`); }
async function mouse(type, point, options = {}) { await client.send("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, ...options }); }
async function click(selector) {
  await ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);
  const r = await rect(selector); assert.ok(r, selector);
  const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const hit = await ev(`Boolean(document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)}))`);
  assert.equal(hit, true, `visible clickable ${selector}`);
  await mouse("mousePressed", p); await mouse("mouseReleased", p); await delay(60);
}
async function key(key, modifiers = 0) {
  const named = { Home: ["Home", 36], End: ["End", 35], Enter: ["Enter", 13], Escape: ["Escape", 27], ArrowDown: ["ArrowDown", 40], ArrowUp: ["ArrowUp", 38] };
  const [code, vk] = named[key] || [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)];
  for (const type of ["keyDown", "keyUp"]) await client.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}
async function fill(selector, text) { await click(selector); await key("a", 2); await client.send("Input.insertText", { text }); await wait(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`); }
async function choose(selector, value) {
  const index = await ev(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(o=>o.value===${JSON.stringify(value)})`);
  assert.ok(index >= 0, value);
  await click(selector); await key("Home"); for (let i = 0; i < index; i++) await key("ArrowDown"); await key("Enter");
  await wait(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`);
}
async function button(text) {
  await ev(`(()=>{const e=[...document.querySelectorAll('.region-redraw-dialog button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('missing button '+${JSON.stringify(text)});e.dataset.editAction='current'})()`);
  await click('[data-edit-action="current"]');
  await ev("document.querySelector('[data-edit-action=current]')?.removeAttribute('data-edit-action')");
}
const draft = () => ev("(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('naimage:region-mask:v1:')&&decodeURIComponent(k).endsWith(',\"'+document.querySelector('[aria-label=\"AI 编辑方式\"]').value+'\"]'));return k?{key:k,value:JSON.parse(localStorage.getItem(k))}:null})()");
const canvasData = () => ev("(()=>{const c=document.querySelector('.region-redraw-mask-canvas');return c.toDataURL()})()");
async function canvasPixel(x, y) { return ev(`Array.from(document.querySelector('.region-redraw-mask-canvas').getContext('2d').getImageData(${x},${y},1,1).data)`); }
async function stroke(points, options = {}) {
  const r = await rect(".region-redraw-mask-canvas");
  const screen = point => ({ x: r.x + point.x / 256 * r.width, y: r.y + point.y / 256 * r.height });
  const a = screen(points[0]);
  assert.equal(await ev(`Boolean(document.elementFromPoint(${a.x},${a.y})?.closest('.region-redraw-mask-canvas'))`), true, "stroke begins on visible source pixel");
  await mouse("mouseMoved", a); await mouse("mousePressed", a, { buttons: 1, ...options });
  for (const point of points.slice(1)) await mouse("mouseMoved", screen(point), { buttons: 1, ...options });
  await mouse("mouseReleased", screen(points.at(-1)), options); await delay(100);
}
async function screenshot(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`), { captureBeyondViewport: false }); report.screenshots.push(`${name}.png`); }
async function openFromMenu() {
  await command("canvas.select", { expectedProjectId: "edit-project", ids: ["N0001"] });
  await ev("window.__naimageDebugSetViewport({x:20,y:20,scale:0.8})"); await delay(200);
  const r = await rect('.flow-node[data-node-id="N0001"] .node-title-block'); assert.ok(r);
  const p = { x: r.x + Math.min(70, r.width / 2), y: r.y + r.height / 2 };
  await mouse("mouseMoved", p); await mouse("mousePressed", p, { button: "right", buttons: 2 }); await mouse("mouseReleased", p, { button: "right" });
  await wait("Array.from(document.querySelectorAll('[role=menuitem]')).some(e=>e.textContent.trim()==='AI 编辑…')");
  await ev("(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='AI 编辑…');e.dataset.editMenu='open'})()");
  await click('[data-edit-menu="open"]'); await wait("Boolean(document.querySelector('.region-redraw-canvas-shell.ready'))");
}
async function openMode(mode, prompt = `[edit-mode:${mode}] 修改本地测试图片`) {
  await command("canvas.edit-image", { expectedProjectId: "edit-project", nodeId: "N0001", assetIndex: 0, mode, prompt });
  await wait(`Boolean(document.querySelector('.region-redraw-canvas-shell.ready'))&&document.querySelector('[aria-label="AI 编辑方式"]').value===${JSON.stringify(mode)}`);
}
async function stop() {
  if (!electron) return;
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {});
  client?.close(); client = null;
  const exited = await waitForChildExit(electron, 15000);
  (report.shutdowns ||= []).push({ exited, exitCode: electron.exitCode, forced: false });
  assert.equal(exited, true); assert.equal(electron.exitCode, 0); electron = null;
}
async function launch() {
  const debugPort = await allocateDebugPort();
  electron = spawn(createRequire(import.meta.url)("electron"), ["electron-main.cjs", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`], {
    cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl,
      NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1", NAIMAGE_CONFIG_DIR: config,
      NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") }
  });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await wait("Boolean(document.querySelector('.project-agent-composer textarea')&&window.__naimageDebugAgentState&&window.naimageAgent?.runTool)");
  await wait("(()=>{const s=window.__naimageDebugAgentState();return s.configReady&&s.activeProjectId==='edit-project'&&s.activeConversationId==='edit-conversation'&&s.nodes.some(n=>n.id==='N0001'&&n.assets?.[0]?.contentHash)})()");
  await delay(250);
}
const server = createServer(async (req, res) => {
  const json = body => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (/^\/v1\/images\/(edits|generations)/.test(req.url)) {
      assert.match(req.url, /\/edits/, "all editor modes use the true edit endpoint");
      const form = await new Request("http://127.0.0.1/fixture", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body }).formData();
      const prompt = String(form.get("prompt") || ""), mode = prompt.match(/\[edit-mode:([a-z-]+)\]/)?.[1];
      assert.ok(AI_IMAGE_EDIT_MODES[mode], `mode in prompt ${prompt.slice(0, 80)}`);
      const images = await Promise.all([...form.entries()].filter(([key, value]) => key.startsWith("image") && typeof value.arrayBuffer === "function").map(async ([, value]) => Buffer.from(await value.arrayBuffer())));
      assert.equal(images.length, 1); assert.equal(hash(images[0]), sourceTarget.contentHash, "the actual POST contains the frozen original source");
      const fileMask = form.get("mask"), maskBytes = fileMask ? Buffer.from(await fileMask.arrayBuffer()) : null;
      const wire = { mode, count: Number(form.get("n") || 1), model: String(form.get("model")), sourceHash: hash(images[0]), maskHash: maskBytes ? hash(maskBytes) : null, prompt };
      assert.equal(wire.count, 1); assert.equal(wire.model, "gpt-image-2");
      if (maskBytes) {
        writeFileSync(join(runDir, `mask-${mode}.png`), maskBytes);
        const raw = await sharp(maskBytes).ensureAlpha().raw().toBuffer();
        wire.editablePixels = Array.from({ length: 256 * 256 }, (_, i) => raw[i * 4 + 3] <= 8).filter(Boolean).length;
      }
      report.imagePosts++; report.wire.push(wire); checkpoint();
      json({ data: [{ b64_json: (mode === "cutout" ? cutoutBytes : outputBytes).toString("base64"), output_format: "png", quality: "medium" }] });
    } else if (req.url === "/v1/responses") {
      report.modelPosts++; throw new Error("the editor must not start a Responses agent call");
    } else if (req.url === "/v1/models") json({ data: [{ id: "gpt-5.6-sol" }, { id: "gpt-image-2" }] });
    else json({ success: true, data: { id: 1, username: "fixture", quota: 100000, items: [] } });
  } catch (error) { report.serverErrors.push(error.message); checkpoint(); if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: error.message } })); }
});

try {
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [sourceNode], messages: [], layoutGroups: [], activeConversationId: "edit-conversation", conversations: [{ id: "edit-conversation", title: "编辑测试", messages: [] }] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "edit-project", projects: [{ id: "edit-project", name: "AI 编辑本地验证", path: project, sessionPath: join(project, "session.json"), external: true }] }));
  writeFileSync(join(config, "app-settings.json"), JSON.stringify({ accessMode: "account", serverAuthProtocol: "legacy", accountBaseUrl: base, serverUrl: base, relayBaseUrl: base, updateBaseUrl: base,
    serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token", agentModel: "gpt-5.6-sol", agentModelPool: ["gpt-5.6-sol"],
    imageConnectionVersion: 1, imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"], imageRatio: "1:1", imageResolution: "1K", imageQuality: "high", imageCount: 1,
    imageModelBindings: [{ model: "gpt-image-2", customBaseUrl: base, customApiKey: "fixture-image", protocol: "openai-images", gateway: "direct" }],
    imageModelConfigs: [{ model: "gpt-image-2", protocol: "openai-images", gateway: "direct", capabilities: { edit: true, referenceImages: true, mask: true, supportedQualities: ["auto", "high"] } }], glassTheme: "light-classic", agentPanelWidth: 350 }));
  const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
  await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 }); await launch();

  await check("canvas menu opens unified editor with six modes and disabled expansion", async () => {
    await openFromMenu();
    const options = await ev("Array.from(document.querySelector('[aria-label=\"AI 编辑方式\"]').options).map(o=>({value:o.value,disabled:o.disabled}))");
    assert.deepEqual(options.filter(o => !o.disabled).map(o => o.value), Object.keys(AI_IMAGE_EDIT_MODES));
    assert.equal(options.find(o => o.value === "expand")?.disabled, true);
    assert.deepEqual(await ev("(()=>{const c=document.querySelector('.region-redraw-source-canvas');return [c.width,c.height]})()"), [256, 256]);
    await choose('[aria-label="AI 编辑方式"]', "redraw");
    await screenshot("unified-editor");
  });

  await check("actual pointer strokes keep source coordinates through anchored zoom and pan", async () => {
    await stroke([{ x: 90, y: 100 }, { x: 105, y: 105 }, { x: 120, y: 105 }]);
    const first = (await draft()).value.document.actions[0];
    assert.ok(Math.abs(first.points[0].x - 90) < 1 && Math.abs(first.points[0].y - 100) < 1);
    const r = await rect(".region-redraw-canvas-shell");
    await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: r.x + r.width * 0.6, y: r.y + r.height * 0.45, deltaX: 0, deltaY: -180 }); await delay(150);
    assert.ok((await draft()).value.view.zoom > 1.2);
    await choose('[aria-label="选区工具"]', "pan");
    const c = await rect(".region-redraw-canvas-shell"), p = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
    await mouse("mousePressed", p); await mouse("mouseMoved", { x: p.x + 24, y: p.y + 12 }, { buttons: 1 }); await mouse("mouseReleased", { x: p.x + 24, y: p.y + 12 });
    const view = (await draft()).value.view; assert.ok(view.panX !== 0 && view.panY !== 0);
    await choose('[aria-label="选区工具"]', "brush");
    await stroke([{ x: 140, y: 136 }, { x: 150, y: 140 }]);
    const second = (await draft()).value.document.actions[1];
    assert.ok(Math.abs(second.points[0].x - 140) < 1 && Math.abs(second.points[0].y - 136) < 1, JSON.stringify(second.points));
    report.coordinateEvidence = { first: first.points, zoomed: second.points, view };
  });

  await check("eraser undo redo invert and clear restore exact visible pixels", async () => {
    const before = await canvasData();
    await choose('[aria-label="选区工具"]', "eraser"); await stroke([{ x: 140, y: 136 }]);
    const erased = await canvasData(); assert.notEqual(erased, before); assert.equal((await canvasPixel(140, 136))[3], 0);
    await button("撤销"); assert.equal(await canvasData(), before);
    await button("重做"); assert.equal(await canvasData(), erased);
    await button("反选当前用途"); assert.ok((await canvasPixel(2, 2))[3] > 0);
    await button("撤销"); assert.equal(await canvasData(), erased);
    await button("清空涂抹"); assert.equal((await canvasPixel(105, 105))[3], 0);
    await button("撤销"); assert.equal(await canvasData(), erased);
    await choose('[aria-label="选区工具"]', "brush");
  });

  let savedDocument, savedCanvas;
  await check("preserve and annotation roles stay distinct and vector draft survives close reload and restart", async () => {
    await button("适应原图");
    await choose('[aria-label="涂抹用途"]', "preserve"); await stroke([{ x: 105, y: 105 }]);
    assert.ok((await canvasPixel(105, 105))[1] > (await canvasPixel(105, 105))[0]);
    await choose('[aria-label="涂抹用途"]', "annotation"); await stroke([{ x: 200, y: 200 }]);
    await fill('[aria-label="标注说明"]', "徽章位置"); await fill(".region-redraw-prompt-field textarea", "[edit-mode:redraw] 修改徽章");
    savedDocument = (await draft()).value.document; savedCanvas = await canvasData();
    const serialized = JSON.stringify((await draft()).value);
    assert.doesNotMatch(serialized, /data:image|base64|[A-Z]:\\|https?:\/\//i);
    assert.deepEqual(savedDocument.sourceTarget, sourceTarget);
    await screenshot("three-mask-roles");
    await button("保存草稿并关闭"); await wait("!document.querySelector('.region-redraw-dialog')");
    await client.send("Page.reload"); await wait("Boolean(document.querySelector('.project-agent-composer textarea')&&window.__naimageDebugAgentState)");
    await openMode("redraw");
    assert.equal(await canvasData(), savedCanvas); assert.deepEqual((await draft()).value.document, savedDocument);
    assert.equal(await ev("document.querySelector('.region-redraw-dialog').textContent.includes('已恢复此原图的选区草稿')"), true);
    await button("保存草稿并关闭"); await stop(); await launch(); await openMode("redraw");
    assert.equal(await canvasData(), savedCanvas); assert.deepEqual((await draft()).value.document, savedDocument);
    await screenshot("restart-draft-recovered");
  });

  await check("minimum 884 by 640 window keeps editor canvas controls prompt and submit reachable", async () => {
    assert.equal((await ev("window.naimageConfig.debugWindowBounds({width:884,height:640})"))?.ok, true);
    await wait("innerWidth===884&&innerHeight===640");
    const geometry = await ev("(()=>{const d=document.querySelector('.region-redraw-dialog'),c=document.querySelector('.region-redraw-canvas-shell'),r=d.getBoundingClientRect(),a=c.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},dialog:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},canvas:{width:a.width,height:a.height},overflow:document.documentElement.scrollWidth>innerWidth}})()");
    assert.ok(geometry.dialog.x >= 0 && geometry.dialog.y >= 0 && geometry.dialog.right <= 884 && geometry.dialog.bottom <= 640);
    assert.ok(geometry.canvas.width > 200 && geometry.canvas.height > 200); assert.equal(geometry.overflow, false);
    await fill(".region-redraw-prompt-field textarea", "[edit-mode:redraw] 修改徽章");
    await screenshot("editor-minimum-prompt"); report.windows.push(geometry);
    await button("保存草稿并关闭");
    await ev("window.naimageConfig.debugWindowBounds({width:1280,height:900})"); await wait("innerWidth===1280&&innerHeight===900");
  });

  for (const [mode, info] of Object.entries(AI_IMAGE_EDIT_MODES)) {
    await check(`real ${mode} submit maps to ${info.operation} and writes one new result`, async () => {
      await openMode(mode);
      await fill(".region-redraw-prompt-field textarea", `[edit-mode:${mode}] 修改本地测试图片`);
      await button("清空涂抹").catch(error => { if (!/visible clickable/.test(error.message)) throw error; });
      if (info.requiresModifyMask) { await choose('[aria-label="涂抹用途"]', "modify"); await stroke([{ x: 90, y: 128 }, { x: 160, y: 128 }]); }
      if (mode === "redraw" || mode === "replace-background") { await choose('[aria-label="涂抹用途"]', "preserve"); await stroke([{ x: 128, y: 128 }]); }
      if (mode === "redraw") {
        await choose('[aria-label="涂抹用途"]', "annotation"); await stroke([{ x: 220, y: 220 }]); await fill('[aria-label="标注说明"]', "徽章位置");
      }
      const beforeIds = (await state()).nodes.map(node => node.id), previousPosts = report.imagePosts;
      await button(`执行${info.label}`); await wait("!document.querySelector('.region-redraw-dialog')");
      let resultNode;
      await until(async () => {
        const snapshot = await state(); resultNode = snapshot.nodes.find(node => !beforeIds.includes(node.id) && node.parentId === "N0001");
        if (resultNode?.imageState === "error") throw new Error(resultNode.imageError || "image task failed");
        return resultNode?.imageState === "done" && resultNode.assets?.length === 1 && (mode !== "cutout" || /cutout-transparent/.test(resultNode.assets[0].path));
      }, `${mode} saved result`);
      assert.equal(report.imagePosts, previousPosts + 1); assert.match(resultNode.prompt, new RegExp(`operation: ${info.operation}\\b`));
      assert.equal(resultNode.relationType, mode === "variants" ? "variant" : "derived-from");
      assert.equal(hash(readFileSync(sourceFile)), sourceTarget.contentHash, "original bytes unchanged");
      const original = (await state()).nodes.find(node => node.id === "N0001");
      assert.deepEqual(Object.fromEntries(Object.keys(sourceTarget).map(key => [key, original.assets[0][key]])), sourceTarget);
      const out = await sharp(resultNode.assets[0].path).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); assert.equal(out.info.width, 256); assert.equal(out.info.height, 256);
      const pixel = (x, y) => [...out.data.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4)];
      if (mode === "redraw" || mode === "replace-background") {
        const sourceRaw = await sharp(sourceBytes).ensureAlpha().raw().toBuffer();
        assert.deepEqual(pixel(128, 128), [...sourceRaw.subarray((128 * 256 + 128) * 4, (128 * 256 + 128) * 4 + 4)]);
        if (mode === "redraw") assert.deepEqual(pixel(220, 220), [...sourceRaw.subarray((220 * 256 + 220) * 4, (220 * 256 + 220) * 4 + 4)], "annotation does not become editable");
        report.pixelChecks.push({ mode, protectedCenter: pixel(128, 128), unchanged: true });
      }
      if (mode === "cutout") { assert.equal(pixel(0, 0)[3], 0); assert.ok(pixel(128, 128)[3] > 16); report.pixelChecks.push({ mode, transparentCorner: pixel(0, 0)[3], visibleCenter: pixel(128, 128)[3] }); }
      report.results ||= []; report.results.push({ mode, operation: info.operation, nodeId: resultNode.id, relationType: resultNode.relationType, contentHash: hash(readFileSync(resultNode.assets[0].path)) });
      await until(async () => (await state()).agentStatus === "idle", "editor run settles");
      if (mode === "redraw" || mode === "cutout") await screenshot(`${mode}-result`);
    });
  }
  await check("saved project retains local evidence separately from provider metadata and no agent requests", async () => {
    await until(() => {
      const session = JSON.parse(readFileSync(join(project, "session.json"), "utf8"));
      return report.results.every(result => session.nodes.some(node => node.id === result.nodeId && node.assets?.length === 1 && node.imageState === "done"));
    }, "all edited assets persisted");
    const session = JSON.parse(readFileSync(join(project, "session.json"), "utf8"));
    for (const result of report.results) {
      const asset = session.nodes.find(node => node.id === result.nodeId).assets[0];
      if (["redraw", "remove-object", "replace-background"].includes(result.mode)) assert.equal(asset.localProcessing?.maskComposite?.verified, true, `${result.mode} local exact verification persisted`);
      if (result.mode === "cutout") assert.equal(asset.localProcessing?.alpha?.verified, true);
      assert.equal(asset.generation?.response?.quality, "medium");
      assert.equal(asset.generation?.response?.maskComposite, undefined);
    }
    assert.equal(report.imagePosts, 6); assert.equal(report.modelPosts, 0); assert.deepEqual(report.serverErrors, []);
    assert.equal(hash(readFileSync(sourceFile)), sourceTarget.contentHash);
    await screenshot("six-results-original-kept");
  });
  await stop(); report.ok = true; checkpoint(); console.log(JSON.stringify({ ok: true, checks: report.checks.length, imagePosts: report.imagePosts, modelPosts: report.modelPosts, screenshots: report.screenshots.length, report: join(runDir, "report.json") }));
} catch (error) {
  report.error = error.stack; console.error(error); process.exitCode = 1;
  if (client) { report.failureState = await state().catch(() => null); await screenshot("failure").catch(() => {}); await stop().catch(error => { report.shutdownError = error.message; }); }
  checkpoint();
} finally { if (vite) vite.kill(); server.closeAllConnections(); server.close(); }
