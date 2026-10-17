import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const dpi = Number(process.argv.find(a => a.startsWith("--dpi="))?.slice(6) || 1);
const runDir = join(root, ".diagnostics", `workspace-optimization-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project");
for (const dir of [config, project]) mkdirSync(dir, { recursive: true });
const png = (await sharp({ create: { width: 64, height: 64, channels: 4, background: "#39a6de" } }).png().toBuffer()).toString("base64");
const imagePath = join(project, "fixture.png"); writeFileSync(imagePath, Buffer.from(png, "base64"));
const assets = id => [{ assetId: `asset-${id}`, occurrenceId: `occ-${id}`, path: imagePath, type: "file", assetUrl: `data:image/png;base64,${png}`, mimeType: "image/png", width: 2, height: 2, index: 1 }];
const nodes = ["A", "B", "C"].map((id, index) => ({ id, title: `成果 ${id}`, type: "image", status: "done", imageState: "done", outputs: 1, assets: assets(id), x: 50 + index * 280, y: 90, width: 220, height: 220, zOrder: index + 1, ...(id === "C" ? { parentId: "A", relationType: "derived-from" } : {}) }));
nodes.push({ ...nodes[0], id: "E", title: "容器 E", x: 50, y: 800, width: 440, height: 260, imageContainer: true, outputs: 2, assets: [...assets("E1"), ...assets("E2")] });
nodes.push({ ...nodes[0], id: "D", title: "裁剪外成果 D", x: 1400, y: 90, width: 100, height: 100, assets: assets("D") });
writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes, messages: [], layoutGroups: [], selectedNodeId: "A" }));
writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "fixture", projects: [{ id: "fixture", name: "工作台优化本地验收", path: project, sessionPath: join(project, "session.json"), external: true }] }));
writeFileSync(join(config, "app-settings.json"), JSON.stringify({ agentModel: "gpt-6.1-sol", imageModel: "gpt-image-2", imageConnectionVersion: 1, glassTheme: "light-classic", agentPanelWidth: 390 }));
let vite, electron, client;
const report = { ok: false, dpi, realModelRequests: 0, checks: [], screenshots: [] };
const ev = expression => evaluateRuntime(client, expression);
async function check(name, fn) { const value = await fn(); assert.ok(value, name); report.checks.push({ name, ok: true }); }
async function mouse(type, x, y, button = "left", extra = {}) { await client.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: type === "mouseMoved" ? 0 : 1, ...extra }); }
async function clickAt(x, y, button = "left", extra = {}) { await mouse("mousePressed", x, y, button, extra); await mouse("mouseReleased", x, y, button, extra); await delay(80); }
async function key(key, down = true, modifiers = 0) { await client.send("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", key, code: key === " " ? "Space" : key, modifiers }); }
async function rect(selector) { return ev(`(() => {const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()`); }
async function command(command, args = {}) {
  const endpoint = JSON.parse(readFileSync(join(config, "automation", "endpoint.json"), "utf8"));
  writeFileSync(join(runDir,'checkpoint.json'),JSON.stringify({lastCommand:command,checks:report.checks.length}));
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, args, timeoutMs:12000 }) });
  const result = await response.json(); assert.ok(result.ok, `${command}: ${JSON.stringify(result)}`); return result.result ?? result.data ?? result;
}
async function select(ids) { await command("canvas.select", { ids, expectedProjectId: "fixture" }); await delay(700); await ev(`window.__naimageDebugSetViewport({x:0,y:0,scale:0.8})`); await delay(180); }
async function selected() { return ev(`Array.from(document.querySelectorAll('.flow-node.selected')).map(e=>e.dataset.nodeId).sort().join(',')`); }
async function snap(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`)); report.screenshots.push(`${name}.png`); }
async function clickSelector(selector) { const r = await rect(selector); assert.ok(r, selector); await clickAt(r.x + r.width / 2, r.y + r.height / 2); }
async function clickText(selector, text) { const p = await ev(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); assert.ok(p, text); await clickAt(p.x, p.y); }
try {
  const port = await allocateDebugPort(), debugPort = await allocateDebugPort(); const devUrl = `http://127.0.0.1:${port}`;
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
  await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  electron = spawn(process.execPath, [join(root, "node_modules/electron/cli.js"), "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", `--remote-debugging-port=${debugPort}`, `--force-device-scale-factor=${dpi}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log") } });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 180, intervalMs: 100, findTarget: ts => ts.find(t => t.type === "page") });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable"); await client.send("Page.bringToFront");
  await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea') && window.__naimageDebugSetViewport)", { evaluate: evaluateRuntime, timeoutMs: 60000 });
  await ev(`window.__naimageDebugSetViewport({x:0,y:0,scale:0.8})`); await delay(250);
  const canvas = await rect(".canvas-panel"); const blank = { x: canvas.x + 40, y: canvas.y + canvas.height - 125 };
  await select(["A", "B"]);
  await clickAt(blank.x, blank.y);
  await check("blank tap preserves visible selection", async () => await selected() === "A,B");
  await clickAt(blank.x, blank.y, "right");
  await check("blank menu retains create actions with multiple selection", () => ev(`document.querySelector('[aria-label="画布菜单"]')?.textContent.includes('创建生图工作')`)); await snap("blank-menu");
  await key("Escape"); await key("Escape", false);
  const c = await rect('.flow-node[data-node-id="C"] .node-title-block');
  await clickAt(c.x + 60, c.y + 12, "right");
  await check("unselected C has its own named menu", () => ev(`document.querySelector('[aria-label="成果菜单"]')?.textContent.includes('成果 C') && !document.querySelector('.selection-context-menu')`));
  await check("right click C preserves selection A B", async () => await selected() === "A,B"); await snap("unselected-target-menu");
  await clickText('[role="menuitem"]', '只选此项'); await delay(100);
  await check("explicit only select C replaces selection", async () => await selected() === "C");
  await select(["A", "B"]);
  const before = await ev(`document.querySelector('.canvas-stage').style.transform`);
  const tile = await rect('.flow-node[data-node-id="A"] .node-image-tile'); const point = { x: tile.x + 35, y: tile.y + 45 };
  await mouse("mousePressed", point.x, point.y, "middle"); await mouse("mouseMoved", point.x + 80, point.y + 50, "middle", { buttons: 4 }); await delay(80);
  await check("middle pan works over artwork", async () => await ev(`document.querySelector('.canvas-stage').style.transform`) !== before);
  await key("Escape"); await key("Escape", false); await mouse("mouseReleased", point.x + 80, point.y + 50, "middle"); await delay(180);
  await check("Escape pan rolls viewport back", async () => await ev(`document.querySelector('.canvas-stage').style.transform`) === before);
  await check("Escape gesture preserves selection", async () => await selected() === "A,B");
  await key(" "); await mouse("mousePressed", point.x, point.y); await mouse("mouseMoved", point.x + 70, point.y + 25, "left", { buttons: 1 }); await delay(60); await mouse("mouseReleased", point.x + 70, point.y + 25); await key(" ", false); await delay(180);
  await check("Space pan over image does not open viewer", () => ev(`!document.querySelector('.image-viewer') && !document.querySelector('.is-selecting')`));
  await ev(`window.__naimageDebugSetViewport({x:0,y:0,scale:0.8})`); await delay(200);
  const a = await rect('.flow-node[data-node-id="A"] .node-title-block');
  const posBefore = await command("canvas.state");
  await mouse("mousePressed", a.x + 70, a.y + 12); await mouse("mouseMoved", a.x + 165, a.y + 65, "left", { buttons: 1 }); await delay(90);
  await key("Escape"); await key("Escape", false); await mouse("mouseReleased", a.x + 165, a.y + 65); await delay(120);
  const posAfter = await command("canvas.state");
  report.cancelState = { before: posBefore.nodes?.find(n => n.id === "A")?.x, after: posAfter.nodes?.find(n => n.id === "A")?.x };
  await check("node cancel leaves saved coordinates unchanged", () => report.cancelState.before === report.cancelState.after);
  await mouse("mousePressed", blank.x, blank.y); await mouse("mouseMoved", blank.x + 130, blank.y - 70, "left", { buttons: 1 }); await delay(40);
  await ev(`window.dispatchEvent(new Event('blur'))`); await mouse("mouseReleased", blank.x + 130, blank.y - 70); await delay(100);
  await check("blur cancels marquee without selection commit", async () => await selected() === "A,B");
  const r = await rect('.flow-node[data-node-id="C"] .node-image-tile');
  await clickAt(r.x + 50, r.y + 60); await delay(340); await clickAt(r.x + 50, r.y + 60, "left", { clickCount: 2 }); await delay(250);
  await check("slow double click opens editor", () => ev(`Boolean(document.querySelector('.unified-node-editor'))`)); await snap("slow-double-editor");
  await key("Escape"); await key("Escape", false); await delay(150);
  await select(["A", "B"]);
  const ctrl = await rect('.flow-node[data-node-id="C"] .node-image-tile');
  await clickAt(ctrl.x + 40, ctrl.y + 40, "left", { modifiers: 2 });
  await check("Ctrl image click adds selection and Agent SOURCE", async () => await selected() === "A,B,C" && await ev(`document.querySelector('[data-selection-ids]')?.dataset.selectionIds.split(' ').sort().join(',')==='A,B,C'`));
  await clickAt(ctrl.x + 40, ctrl.y + 40, "left", { modifiers: 2 });
  await check("Ctrl second click removes C without viewer", async () => await selected() === "A,B" && await ev(`!document.querySelector('.image-viewer')`));
  await mouse("mousePressed", blank.x, blank.y); await mouse("mouseMoved", blank.x + 25, blank.y - 15, "left", { buttons: 1 }); await mouse("mouseReleased", blank.x + 25, blank.y - 15);
  await check("empty marquee preserves original collection", async () => await selected() === "A,B");
  for (const scale of [0.4, 1.2]) {
    await select(["A"]); await ev(`window.__naimageDebugSetViewport({x:0,y:0,scale:${scale}})`); await delay(180);
    const title = await rect('.flow-node[data-node-id="A"] .node-title-block'), beforeDrag = await command("canvas.state");
    await mouse("mousePressed", title.x + 60, title.y + 10); await mouse("mouseMoved", title.x + 64, title.y + 10, "left", { buttons: 1 }); await mouse("mouseReleased", title.x + 64, title.y + 10); await delay(100);
    const afterTap = await command("canvas.state");
    assert.equal(afterTap.nodes.find(n => n.id === "A").x, beforeDrag.nodes.find(n => n.id === "A").x, "4 CSS px stays below drag threshold at each zoom");
    await mouse("mousePressed", title.x + 60, title.y + 10); await mouse("mouseMoved", title.x + 100, title.y + 30, "left", { buttons: 1 }); await mouse("mouseReleased", title.x + 100, title.y + 30); await delay(180);
    const afterDrag = await command("canvas.state"); assert.ok(afterDrag.nodes.find(n => n.id === "A").x > beforeDrag.nodes.find(n => n.id === "A").x);
    await key("z", true, 2); await key("z", false, 2); await delay(180);
    const undone = await command("canvas.state"); assert.equal(undone.nodes.find(n => n.id === "A").x, beforeDrag.nodes.find(n => n.id === "A").x, "one undo reverts complete drag");
    report.checks.push({ name: `CSS threshold, committed drag and single undo at zoom ${scale}`, ok: true });
  }
  await select(["A"]);
  const resize = await rect('.flow-node[data-node-id="A"] .node-resize-handle'), beforeResize = await command("canvas.state");
  await mouse("mousePressed", resize.x + resize.width / 2, resize.y + resize.height / 2); await mouse("mouseMoved", resize.x + 85, resize.y + 65, "left", { buttons: 1 }); await delay(70); await key("Escape"); await key("Escape", false); await mouse("mouseReleased", resize.x + 85, resize.y + 65);
  const canceledResize = await command("canvas.state");
  assert.equal(canceledResize.nodes.find(n=>n.id==='A').width, beforeResize.nodes.find(n=>n.id==='A').width);
  await mouse("mousePressed", resize.x + resize.width / 2, resize.y + resize.height / 2); await mouse("mouseMoved", resize.x + 85, resize.y + 65, "left", { buttons: 1 }); await mouse("mouseReleased", resize.x + 85, resize.y + 65); await delay(150);
  const resized = await command("canvas.state"); assert.ok(resized.nodes.find(n=>n.id==='A').width > beforeResize.nodes.find(n=>n.id==='A').width);
  await key("z", true, 2); await key("z", false, 2); await delay(180); assert.equal((await command("canvas.state")).nodes.find(n=>n.id==='A').width, beforeResize.nodes.find(n=>n.id==='A').width);
  report.checks.push({ name: "resize Escape restores geometry; release commits once and one undo restores", ok: true });
  await ev(`window.__pointerForCancel=0;window.addEventListener('pointerdown',e=>window.__pointerForCancel=e.pointerId,{once:true,capture:true})`);
  const ta = await rect('.flow-node[data-node-id="A"] .node-title-block');
  await mouse("mousePressed", ta.x + 50, ta.y + 12); await mouse("mouseMoved", ta.x + 110, ta.y + 40, "left", { buttons: 1 }); await delay(70);
  await ev(`document.querySelector('.flow-node[data-node-id="A"]').dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__pointerForCancel,bubbles:true}))`); await mouse("mouseReleased", ta.x + 110, ta.y + 40); await delay(100);
  assert.equal((await command("canvas.state")).nodes.find(n=>n.id==='A').x, beforeResize.nodes.find(n=>n.id==='A').x);
  report.checks.push({ name: "pointercancel cancels active real pointer drag", ok: true });
  await ev(`window.__naimageDebugSetViewport({x:0,y:-400,scale:0.8})`); await delay(200);
  const te = await rect('.flow-node[data-node-id="E"] .node-image-tile:nth-of-type(2)') || await rect('.flow-node[data-node-id="E"] .node-image-tile');
  await clickAt(te.x + 25, te.y + 30, "right");
  await check("container slot has image menu rather than collection menu", () => ev(`Boolean(document.querySelector('.asset-context-menu')) && !document.querySelector('.selection-context-menu')`)); await snap("container-slot-menu"); await key("Escape"); await key("Escape", false);
  await select(["A"]);
  const edgePoint = await ev(`(()=>{for(const p of document.querySelectorAll('.edge-hit-target')){for(let t=.05;t<1;t+=.05){const q=p.getPointAtLength(p.getTotalLength()*t),s=new DOMPoint(q.x,q.y).matrixTransform(p.getScreenCTM());if(document.elementFromPoint(s.x,s.y)===p)return{x:s.x,y:s.y}}}return null})()`);
  assert.ok(edgePoint, 'relation has an exposed pointer hit target');
  await clickAt(edgePoint.x, edgePoint.y, "right");
  await check("relation menu targets one actual edge", () => ev(`document.querySelector('.relation-context-menu')?.textContent.includes('断开这条连线') && !document.querySelector('.relation-context-menu')?.textContent.includes('断开全部')`)); await snap("relation-menu"); await key("Escape"); await key("Escape", false);
  await select(["A", "B"]);
  const stale = await rect('.flow-node[data-node-id="C"] .node-title-block'); await clickAt(stale.x + 40, stale.y + 10, "right");
  await command("canvas.connect", { edges: [{ sourceId: "B", targetId: "E", relationType: "referenced" }], expectedProjectId: "fixture" });
  const selectionAfterMutation = await selected();
  await clickText('[role="menuitem"]', '只选此项');
  report.staleMenu = { before: selectionAfterMutation, after: await selected(), notice: await ev(`document.body.textContent.includes('菜单目标已变化')`), menuClosed: await ev(`!document.querySelector('[aria-label="成果菜单"]')`) };
  await check("menu refuses a changed project revision", async () => await selected() === selectionAfterMutation && await ev(`document.body.textContent.includes('菜单目标已变化')`));
  await select(["A", "B"]);
  const stageBeforeWheel = await ev(`document.querySelector('.canvas-stage').style.transform`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: canvas.x + 18, y: canvas.y + 100, deltaX: 0, deltaY: -60 }); await delay(320);
  await check("real wheel changes viewport", async () => await ev(`document.querySelector('.canvas-stage').style.transform`) !== stageBeforeWheel);
  await ev(`window.__naimageDebugSetViewport({x:0,y:0,scale:0.8})`); await delay(200);
  await clickSelector('[aria-label="切换到平移工具"]'); const panBefore = await ev(`document.querySelector('.canvas-stage').style.transform`);
  await clickAt(canvas.x + 18, canvas.y + 100);
  await key(" "); await mouse("mousePressed", canvas.x + 18, canvas.y + 100); await mouse("mouseMoved", canvas.x + 78, canvas.y + 70, "left", { buttons: 1 }); await mouse("mouseReleased", canvas.x + 78, canvas.y + 70); await key(" ", false); await delay(150);
  await check("Space in pan tool remains pan", async () => await selected() === "A,B" && await ev(`document.querySelector('.canvas-stage').style.transform`) !== panBefore);
  await clickSelector('[aria-label="切换到选择工具"]');
  await delay(700); const saved = JSON.parse(readFileSync(join(project, "session.json"), "utf8"));
  assert.equal(saved.nodes.find(n=>n.id==='A').assets[0].assetId, 'asset-A'); assert.equal(saved.nodes.find(n=>n.id==='C').parentId, 'A');
  await client.send("Page.reload"); await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-composer textarea') && window.__naimageDebugSetViewport)", { evaluate: evaluateRuntime, timeoutMs: 30000 });
  await delay(700);
  await check("project reload retains exact node count, asset identity and relation", async () => { const state=await command('canvas.state'); return state.nodes.length===5 && state.nodes.some(n=>n.id==='A') && state.nodes.some(n=>n.id==='C'&&n.relation.parentId==='A'); });
  await select(["A"]);
  const portA = await rect('.flow-node[data-node-id="A"] .node-port-out'), targetB = await rect('.flow-node[data-node-id="B"] .node-title-block');
  const portPoint = { x: portA.x + portA.width / 2, y: portA.y + portA.height / 2 };
  await clickAt(portPoint.x, portPoint.y);
  assert.equal((await command('canvas.state')).nodes.find(n=>n.id==='B').relation.parentId, null);
  for (const cancel of ["Escape", "pointercancel", "blank"]) {
    await mouse('mousePressed', portPoint.x, portPoint.y); await mouse('mouseMoved', targetB.x+50, targetB.y+10, 'left', {buttons:1});
    if (cancel === 'Escape') { await key('Escape'); await key('Escape', false); }
    if (cancel === 'pointercancel') await ev(`window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}))`);
    await mouse('mouseReleased', cancel === 'blank' ? canvas.x+18 : targetB.x+50, cancel === 'blank' ? canvas.y+100 : targetB.y+10);
    assert.equal((await command('canvas.state')).nodes.find(n=>n.id==='B').relation.parentId, null, cancel);
  }
  await mouse('mouseMoved',portPoint.x,portPoint.y); await mouse('mousePressed', portPoint.x, portPoint.y); await delay(80);
  report.connectionDrop={draft:await ev(`Boolean(document.querySelector('.edge-draft'))`),portHit:await ev(`document.elementFromPoint(${portPoint.x},${portPoint.y})?.className`)};
  await mouse('mouseMoved', targetB.x+50, targetB.y+10, 'left', {buttons:1}); await delay(80);
  report.connectionDrop.targetHit=await ev(`document.elementFromPoint(${targetB.x+50},${targetB.y+10})?.closest('.flow-node')?.dataset.nodeId`);
  await mouse('mouseReleased', targetB.x+50, targetB.y+10); await delay(200);
  assert.equal((await command('canvas.state')).nodes.find(n=>n.id==='B').relation.parentId, 'A');
  await key('z',true,2); await key('z',false,2); await delay(100); assert.equal((await command('canvas.state')).nodes.find(n=>n.id==='B').relation.parentId,null);
  report.checks.push({name:'connection click, Escape, pointercancel and blank cancel; actual drop commits and single undo restores',ok:true});
  await select([]);
  const cbox = await rect('[data-canvas-surface="true"]'), vx = cbox.width + 200 - 1400 * .3;
  await ev(`window.__naimageDebugSetViewport({x:${vx},y:0,scale:.3})`); await delay(200);
  assert.equal(await ev(`Boolean(document.querySelector('.flow-node[data-node-id="D"]'))`),false,'D is beyond the virtualized render buffer before marquee');
  await mouse('mousePressed',cbox.x+cbox.width-60,cbox.y+10); await mouse('mouseMoved',cbox.x+vx+1530*.3,cbox.y+230*.3,'left',{buttons:1}); await mouse('mouseReleased',cbox.x+vx+1530*.3,cbox.y+230*.3); await delay(200);
  assert.ok((await command('canvas.state')).selection.ids.includes('D'),'world marquee selects an unmounted node while captured pointer passes over Agent');
  await ev(`window.__naimageDebugSetViewport({x:${-1400*.8+100},y:0,scale:.8})`); await delay(180);
  await check('world-space marquee preserves canonical selection and highlights formerly unmounted D',()=>ev(`Boolean(document.querySelector('.flow-node[data-node-id="D"].selected')) && document.querySelector('[data-selection-ids]')?.dataset.selectionIds.split(' ').includes('D')`));
  await snap('world-marquee');
  const beforeOffscreen = await command('canvas.state');
  const originalA = beforeOffscreen.nodes.find(n => n.id === 'A'), originalC = beforeOffscreen.nodes.find(n => n.id === 'C');
  // Nudge keeps its target within the current viewport; move the viewport with each fixture target.
  await ev(`window.__naimageDebugSetViewport({x:${-(originalA.x - 4000 - 30) * .8},y:0,scale:.8})`); await delay(200);
  await command('canvas.nudge', { nodeIds: ['A'], dx: -4000, dy: 0, expectedProjectId: 'fixture' });
  await ev(`window.__naimageDebugSetViewport({x:${-(originalC.x + 4000 - 30) * .8},y:0,scale:.8})`); await delay(200);
  await command('canvas.nudge', { nodeIds: ['C'], dx: 4000, dy: 0, expectedProjectId: 'fixture' });
  const offscreenState = await command('canvas.state');
  assert.equal(offscreenState.nodes.find(n => n.id === 'A').x, originalA.x - 4000, 'left endpoint fixture was not clamped');
  assert.equal(offscreenState.nodes.find(n => n.id === 'C').x, originalC.x + 4000, 'right endpoint fixture was not clamped');
  await select([]);
  await check('visible relationship survives virtualization of both offscreen endpoints', () => ev(`(()=>{
    const line=document.querySelector('path[data-relation-line="true"][data-source-id="A"][data-target-id="C"]');
    if(!line || document.querySelector('.flow-node[data-node-id="A"]') || document.querySelector('.flow-node[data-node-id="C"]'))return false;
    const style=getComputedStyle(line), rect=document.querySelector('[data-canvas-surface="true"]').getBoundingClientRect(), matrix=line.getScreenCTM();
    if(style.visibility==='hidden'||style.display==='none'||!matrix)return false;
    for(let i=0;i<=100;i++){const p=line.getPointAtLength(line.getTotalLength()*i/100),screen=new DOMPoint(p.x,p.y).matrixTransform(matrix);if(screen.x>rect.left&&screen.x<rect.right&&screen.y>rect.top&&screen.y<rect.bottom)return true;}
    return false;
  })()`));
  await snap('offscreen-endpoint-relation');
  await ev(`window.__naimageDebugSetViewport({x:${-(originalA.x - 30) * .8},y:0,scale:.8})`); await delay(200);
  await command('canvas.nudge', { nodeIds: ['A'], dx: 4000, dy: 0, expectedProjectId: 'fixture' });
  await ev(`window.__naimageDebugSetViewport({x:${-(originalC.x - 30) * .8},y:0,scale:.8})`); await delay(200);
  await command('canvas.nudge', { nodeIds: ['C'], dx: -4000, dy: 0, expectedProjectId: 'fixture' });
  const restoredState = await command('canvas.state');
  assert.equal(restoredState.nodes.find(n => n.id === 'A').x, originalA.x);
  assert.equal(restoredState.nodes.find(n => n.id === 'C').x, originalC.x);
  await select(['A','B']);
  await snap("canvas-selection");
  if (process.argv.includes("--hold")) {
    const beforeBlur = await command('canvas.state'), title = await rect('.flow-node[data-node-id="A"] .node-title-block');
    await ev(`window.__nativeBlurObserved=false;window.addEventListener('blur',e=>{if(e.isTrusted)window.__nativeBlurObserved=true},{once:true})`);
    await mouse('mousePressed',title.x+40,title.y+10); await mouse('mouseMoved',title.x+110,title.y+40,'left',{buttons:1}); await delay(100);
    writeFileSync(join(root, ".diagnostics", "optimization-ui-active.json"), JSON.stringify({ runDir, debugPort, pid: electron.pid, nativeBlurPending: true }));
    const deadline = Date.now()+120000;
    while(Date.now()<deadline && !await ev('window.__nativeBlurObserved')) await delay(250);
    assert.equal(await ev('window.__nativeBlurObserved'),true,'native OS focus change emits trusted blur');
    await mouse('mouseReleased',title.x+110,title.y+40); await delay(150);
    const afterBlur = await command('canvas.state');
    assert.equal(afterBlur.nodes.find(n=>n.id==='A').x,beforeBlur.nodes.find(n=>n.id==='A').x);
    assert.deepEqual(afterBlur.selection,beforeBlur.selection);
    report.checks.push({name:'native Windows focus loss cancels real node drag without geometry or selection mutation',ok:true}); await snap('native-window-blur');
  }
  report.ok = true;
} catch (error) { report.error = String(error.stack || error); process.exitCode = 1; if (client) try { await snap("failure"); } catch {} }
finally { writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, report: join(runDir, "report.json") })); client?.close(); await forceKillProcessTree(electron?.pid); await forceKillProcessTree(vite?.pid); }
