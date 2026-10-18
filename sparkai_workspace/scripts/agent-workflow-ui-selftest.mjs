import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { contentNamePatch } from "../runtime/image-content-name.mjs";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";
const root = resolve(import.meta.dirname, "..");
const runDir = join(root, ".diagnostics", `agent-workflow-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const config = join(runDir, "config"), project = join(runDir, "project"), assetsDir = join(project, "output", "imagegen", "ui-fixture");
for (const dir of [config, assetsDir]) mkdirSync(dir, { recursive: true });
const fixtureAssets = new Map();
for (const [index, id] of ["A", "B1", "B2"].entries()) {
 const imagePath = join(assetsDir, `${id}.png`);
 const bytes = await sharp(Buffer.from(`<svg width="512" height="512"><rect width="512" height="512" fill="white"/><circle cx="256" cy="256" r="${150-index}" fill="#e33b3b"/></svg>`)).png().toBuffer();
 writeFileSync(imagePath, bytes); const hash = createHash("sha256").update(bytes).digest("hex");
 fixtureAssets.set(id, { assetId:`asset-${hash.slice(0,32)}`, occurrenceId:`occ-${createHash("sha256").update(id).digest("hex").slice(0,32)}`, contentHash:hash,
  path:imagePath, relativePath:relative(project,imagePath).replaceAll("\\","/"), fileName:`${id}.png`, type:"file", mimeType:"image/png", width:512, height:512, index:id==="B2"?2:1 });
}
const asset = id => fixtureAssets.get(id);
const nodes = [{ id: "A", title: "图片成果", type: "image", status: "done", imageState: "done", assets: [asset("A")], x: 60, y: 110, width: 220, height: 220, zOrder: 1 },
 { id: "B", title: "图片容器", type: "image", status: "done", imageState: "done", imageContainer: true, outputs: 2, assets: [asset("B1"), asset("B2", 2)], x: 420, y: 310, width: 260, height: 240, zOrder: 2 }];
writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes, messages: [], layoutGroups: [], selectedNodeId: "A" }));
writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "fixture", projects: [{ id: "fixture", name: "Agent 工作流本地交互", path: project, sessionPath: join(project, "session.json"), external: true }] }));
writeFileSync(join(config, "app-settings.json"), JSON.stringify({ agentModel: "gpt-6.1-sol", imageModel: "gpt-image-2", imageConnectionVersion: 1, glassTheme: "light-classic", agentPanelWidth: 390 }));
let vite, electron, client, browserClient, targetId, automaticNameActions,tearingDown=false;
const remainingUi=process.argv.includes('--remaining-ui');
const namingUi=process.argv.includes('--naming-ui');
const report = { ok: false, mode:namingUi?'naming-ui':remainingUi?'remaining-ui':'full', actualModelRecognition: false, realModelRequests: 0, checks: [], screenshots: [], geometry:[], windows:[] };
const ev = expression => evaluateRuntime(client, expression);
const state = () => ev("window.__naimageDebugAgentState().nodes");
const wait = expression => waitForRuntimeExpression(client, expression, { evaluate: evaluateRuntime, timeoutMs: 15000, intervalMs: 100 });
const checkpoint = () => writeFileSync(join(runDir,"report.json"),JSON.stringify(report,null,2));
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); }
async function mouse(type, point, extra = {}) { await client.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: type === "mouseMoved" ? 0 : 1, ...extra }); }
function keyDefinition(key) {
 const named={Enter:['Enter',13],Escape:['Escape',27],Tab:['Tab',9],' ':['Space',32],ArrowDown:['ArrowDown',40],ArrowUp:['ArrowUp',38],ArrowLeft:['ArrowLeft',37],ArrowRight:['ArrowRight',39]};
 const [code,virtualKey]=named[key]||(/^[a-z]$/i.test(key)?[`Key${key.toUpperCase()}`,key.toUpperCase().charCodeAt(0)]:[key,key.charCodeAt(0)]);
 return {key,code,windowsVirtualKeyCode:virtualKey,nativeVirtualKeyCode:virtualKey};
}
async function sendKey(type,key,modifiers=0){await client.send('Input.dispatchKeyEvent',{type,...keyDefinition(key),modifiers});}
async function key(key, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await sendKey(type,key,modifiers); }
async function rect(selector) { return ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()`); }
async function point(selector) { const r=await rect(selector); return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null; }
const draft = () => ev("Boolean(document.querySelector('.edge-draft'))");
async function clearHover() { const r=await rect('.canvas-panel');assert.ok(r,'canvas panel is mounted before pointer actions'); await mouse('mouseMoved',{x:r.x+r.width-24,y:r.y+24}); await delay(220); }
async function hit(selector,p) { return ev(`(()=>{const e=document.elementFromPoint(${p.x},${p.y});return {ok:Boolean(e?.closest(${JSON.stringify(selector)})),element:e?.outerHTML.slice(0,250)}})()`); }
const port = (id, side) => `.flow-node[data-node-id="${id}"] .port-${side}`;
async function click(selector) { const p = await point(selector); assert.ok(p, selector); await mouse("mousePressed", p); await mouse("mouseReleased", p); await delay(120); }
async function fill(selector,text) { await click(selector);await key('a',2);await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e===document.activeElement&&e.selectionStart===0&&e.selectionEnd===e.value.length})()`);await client.send('Input.insertText',{text});await wait(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`); }
async function openEditor(id,assetIndex) {
 await select(id,id==='C'?0.5:0.8);const selector=assetIndex===undefined?`.flow-node[data-node-id="${id}"] .node-title-block`:`.flow-node[data-node-id="${id}"] .node-image-tile[data-asset-index="${assetIndex}"]`,r=await rect(selector);assert.ok(r,selector);const p={x:r.x+Math.min(65,r.width/2),y:r.y+Math.min(assetIndex===undefined?12:45,r.height/2)};await mouse('mouseMoved',p);assert.equal((await hit(selector,p)).ok,true);await mouse('mousePressed',p);await mouse('mouseReleased',p);await delay(80);await mouse('mousePressed',p,{clickCount:2});await mouse('mouseReleased',p,{clickCount:2});await wait("Boolean(document.querySelector('.unified-node-editor-fields input'))");
}
async function saveEditor() { const selector='.unified-node-editor [data-node-editor-action="save"]';assert.equal(await ev(`document.querySelector('${selector}')?.disabled`),false,'real edited draft can be saved');await click(selector);await wait("!document.querySelector('.unified-node-editor')"); }
async function applyNamingActions(actions=automaticNameActions) { await ev(`window.__naimageDebugApplyAgentActions(${JSON.stringify(actions)})`);await delay(180); }
async function command(command, args = {}) {
 const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8"));
 const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, args, timeoutMs: 15000 }) });
 const value = await response.json(); assert.ok(value.ok, `${command}: ${JSON.stringify(value).slice(0, 700)}`); return value.result ?? value.data ?? value;
}
async function persistedState() {
 await wait("window.__naimageAIDebug.persistenceMetrics().pendingWriteCount===0");
 const live=await state(),startedAt=Date.now();let attempts=0;
 while(true){
  const snapshot=JSON.parse(readFileSync(join(project,'session.json'),'utf8'));attempts++;
  try{
   for(const node of live){const saved=snapshot.nodes.find(n=>n.id===node.id);assert.ok(saved,`persisted fixture includes ${node.id}`);assert.equal(saved.title,node.title);assert.deepEqual(saved.contentName,node.contentName);assert.deepEqual((saved.assets||[]).map(a=>({occurrenceId:a.occurrenceId,title:a.title})),node.assets.map(a=>({occurrenceId:a.occurrenceId,title:a.title})));}
   if(attempts>1)(report.persistenceWaits??=[]).push({attempts,waitMs:Date.now()-startedAt});return snapshot;
  }catch(error){if(Date.now()-startedAt>=15000)throw error;await delay(60);}
 }
}
async function select(id, scale = 0.8) { await clearHover(); await command("canvas.select", { ids: Array.isArray(id)?id:[id], expectedProjectId: "fixture" }); await delay(650); await ev(`window.__naimageDebugSetViewport({x:0,y:0,scale:${scale}})`); await delay(180); await clearHover(); }
async function shot(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`)); report.screenshots.push(`${name}.png`); }
async function undo() { await ev("document.activeElement?.blur()"); await key("z", 2); await delay(180); }
async function windowSize(width,height) {
 const entry={requested:{width,height}};
 try {
  const {windowId,bounds}=await browserClient.send('Browser.getWindowForTarget',{targetId});
  await browserClient.send('Browser.setWindowBounds',{windowId,bounds:{width,height,windowState:'normal'}}); await delay(160);
  const inner=await ev('({width:innerWidth,height:innerHeight})');
  if(inner.width!==width||inner.height!==height) await browserClient.send('Browser.setWindowBounds',{windowId,bounds:{width:2*width-inner.width,height:2*height-inner.height,windowState:'normal'}});
  entry.method='Browser.setWindowBounds';entry.windowId=windowId;entry.previousBounds=bounds;
 } catch(error) {
  entry.browserError=error.message;
  const result=await ev(`window.naimageConfig.debugWindowBounds(${JSON.stringify({width,height})})`);
  assert.equal(result?.ok,true,'native Electron content resize available');entry.method='Electron debugWindowBounds IPC';entry.contentBounds=result.contentBounds;
 }
 await wait(`innerWidth===${width}&&innerHeight===${height}`);entry.actual=await ev('({width:innerWidth,height:innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio})');report.windows.push(entry);
}
async function decodedImages() {
 const result=await ev(`(async()=>{const images=Array.from(document.querySelectorAll('.flow-node .node-image-tile img'));const decoded=await Promise.all(images.map(async img=>{try{await img.decode();return {ok:img.naturalWidth===512&&img.naturalHeight===512,width:img.naturalWidth,height:img.naturalHeight,src:img.currentSrc}}catch(error){return {ok:false,error:String(error),src:img.currentSrc}}}));return {count:images.length,decoded}})()`);
 assert.equal(result.count,report.expectedImageCount||3);assert.ok(result.decoded.every(item=>item.ok),JSON.stringify(result));return result;
}
async function beginConnection(id,side) {
 const selector=port(id,side),nodeRectBefore=await rect(`.flow-node[data-node-id="${id}"]`);await mouse('mouseMoved',{x:nodeRectBefore.x+nodeRectBefore.width/2,y:nodeRectBefore.y+35});await wait(`document.querySelector('.flow-node[data-node-id="${id}"]').matches(':hover')`);const p=await point(selector);assert.ok(p,selector);await mouse('mouseMoved',p);await wait(`Boolean(document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)}))`);
 report.lastSourceHit=await hit(selector,p);assert.equal(report.lastSourceHit.ok,true,JSON.stringify(report.lastSourceHit));
 await mouse('mousePressed',p);await delay(80);assert.equal(await draft(),true,'source pointerdown opens actual draft path');
 assert.equal(await ev("Boolean(document.querySelector('.canvas-interaction-toolbar'))"),false,'connection gesture exposes target ports without shortcut toolbar occlusion');
 const start=await ev("(()=>{const e=document.querySelector('.edge-draft'),p=e.getPointAtLength(0),s=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return {x:s.x,y:s.y}})()");
 const nodeRect=await rect(`.flow-node[data-node-id="${id}"]`),expected={x:side==='left'?nodeRect.x:side==='right'?nodeRect.x+nodeRect.width:nodeRect.x+nodeRect.width/2,y:side==='top'?nodeRect.y:side==='bottom'?nodeRect.y+nodeRect.height:nodeRect.y+nodeRect.height/2};
 report.lastDraftGeometry={id,side,start,expected,portCenter:p,borderError:Math.hypot(start.x-expected.x,start.y-expected.y),handleDistance:Math.hypot(start.x-p.x,start.y-p.y)};assert.ok(report.lastDraftGeometry.borderError<1.5,JSON.stringify(report.lastDraftGeometry));assert.ok(report.lastDraftGeometry.handleDistance<5,'draft remains within chosen handle hit area');return p;
}
async function edgeGeometry(source,target) {
 const result=await ev(`(()=>{const e=document.querySelector('.edge.provenance[data-relation-source-id="${source}"][data-relation-target-id="${target}"]');if(!e)return null;const m=e.getScreenCTM(),a=e.getPointAtLength(0),b=e.getPointAtLength(e.getTotalLength());const screen=p=>{const s=new DOMPoint(p.x,p.y).matrixTransform(m);return {x:s.x,y:s.y}};const endpoint=(id,p)=>{const node=document.querySelector('.flow-node[data-node-id="'+id+'"]'),r=node.getBoundingClientRect();const sides=[{side:'left',x:r.left,y:r.top+r.height/2},{side:'right',x:r.right,y:r.top+r.height/2},{side:'top',x:r.left+r.width/2,y:r.top},{side:'bottom',x:r.left+r.width/2,y:r.bottom}].map(q=>({...q,error:Math.hypot(q.x-p.x,q.y-p.y)})).sort((a,b)=>a.error-b.error);const q=sides[0],port=node.querySelector('.port-'+q.side),style=getComputedStyle(port);return {...q,connected:port.classList.contains('connected'),opacity:Number(style.opacity),background:style.backgroundColor}};const first=screen(a),last=screen(b),start=endpoint('${source}',first),end=endpoint('${target}',last);return {source:'${source}',target:'${target}',d:e.getAttribute('d'),first,last,sourceError:start.error,targetError:end.error,start,end}})()`);
 assert.ok(result,'committed relation path rendered');assert.ok(result.sourceError<1.5&&result.targetError<1.5,JSON.stringify(result));assert.ok(result.start.connected&&result.end.connected,'actual endpoint sides retain connected class');assert.ok(result.start.opacity>=0.85&&result.end.opacity>=0.85,'connected endpoint indicators remain visible');report.geometry.push(result);return result;
}
const graphGeometry = async () => (await state()).map(({id,x,y,width,height,parentId})=>({id,x,y,width,height,parentId:parentId||null}));
const stageTransform = () => ev("document.querySelector('.canvas-stage').style.transform");
const selected = () => ev("Array.from(document.querySelectorAll('.flow-node.selected')).map(e=>e.dataset.nodeId).sort()");
const sourceFiles=['src/main.tsx','src/styles/02-canvas-workspace.css','src/styles/07g-agent-panel-overrides.css','src/core.ts','src/canvas-relation-graph.ts','src/project-agent-composer.tsx','src/image-workspace-overlays.tsx','src/image-collection-mutation.ts','src/image-content-title.ts','runtime/image-content-name.mjs','runtime/image-config-snapshot.mjs','runtime/image-asset-identity.mjs','runtime/image-generation/types.cjs','desktop/project-session-normalizer.cjs','desktop/project-session-merge.cjs','desktop/project-asset-repository.cjs','electron-main.cjs','preload.cjs','agent-runtime.cjs'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(join(root,file))).digest('hex')]));
report.sourceBefore=sourceHashes();
try {
 const portNumber = await allocateDebugPort(), debugPort = await allocateDebugPort(), devUrl = `http://127.0.0.1:${portNumber}`;
 vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(portNumber)], { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
 for(const stream of [vite.stdout,vite.stderr])stream.on('data',chunk=>appendFileSync(join(runDir,'vite.log'),chunk));
 vite.on('exit',(code,signal)=>{if(!tearingDown){report.viteUnexpectedExit={code,signal,at:new Date().toISOString()};checkpoint()}});
 await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
 electron = spawn(process.execPath, [join(root, "node_modules/electron/cli.js"), "--disable-renderer-backgrounding", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log") } });
 const target = await pollForDebugTarget({ port: debugPort, attempts: 180, intervalMs: 100, findTarget: ts => ts.find(t => t.type === "page") });
 targetId=target.id;
 client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
 const localRequests=new Map();client.socket.addEventListener('message',event=>{const{method,params}=JSON.parse(String(event.data));if(method==='Network.requestWillBeSent'&&params.request.url.startsWith(devUrl))localRequests.set(params.requestId,new URL(params.request.url).pathname);const path=localRequests.get(params?.requestId);if(path&&method==='Network.loadingFailed')(report.localNetworkFailures??=[]).push({path,errorText:params.errorText,canceled:params.canceled,blockedReason:params.blockedReason,check:report.current});if(path&&method==='Network.responseReceived'&&params.response.status>=400)(report.localHttpFailures??=[]).push({path,status:params.response.status,check:report.current})});await client.send('Network.enable');
 const version=await(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();browserClient=new BasicCdpClient(version.webSocketDebuggerUrl);await browserClient.open();
 await wait("Boolean(window.__naimageDebugApplyAgentActions && document.querySelector('.project-agent-composer textarea'))");
 await windowSize(1280,820);await select('A');
 await ev("window.__workflowKeyEvents=[];for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{const row={type:e.type,key:e.key,code:e.code,keyCode:e.keyCode,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,isTrusted:e.isTrusted};if(!window.__workflowKeyEvents.some(previous=>JSON.stringify(previous)===JSON.stringify(row)))window.__workflowKeyEvents.push(row)},{capture:true})");
 await check('managed fixture images really decode in the canvas',async()=>{report.imageDecode=await decodedImages();await shot('decoded-fixtures')});
 await check('all four ports expose the same directed source and keyboard semantics',async()=>{
  report.portSemantics=await ev("Array.from(document.querySelectorAll('.flow-node .node-port')).map(p=>({side:p.dataset.portSide,role:p.getAttribute('role'),tabIndex:p.tabIndex,label:p.getAttribute('aria-label'),title:p.title}))");
  assert.equal(report.portSemantics.length,8);assert.equal(new Set(report.portSemantics.map(p=>p.title)).size,1);
  assert.ok(report.portSemantics.every(p=>p.role==='button'&&p.tabIndex===0&&p.label?.includes('连接头')&&p.title.includes('此成果作为来源')&&p.title.includes('Escape')));
 });
 const sides = ["top", "bottom", "left", "right"];
 if(!remainingUi&&!namingUi){
 for (const [source, target] of [["A", "B"], ["B", "A"]]) for (const sourceSide of sides) for (const targetSide of sides) {
  await check(`${source} ${sourceSide} → ${target} ${targetSide}: real pointer connect and one undo`, async () => {
   await select(source); const a = await beginConnection(source,sourceSide);
   const b = await point(port(target, targetSide)); await mouse("mouseMoved", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { buttons: 1 });
   await mouse("mouseMoved", b, { buttons: 1 }); await delay(80);
   report.lastDrop=await hit(port(target,targetSide),b);assert.equal(report.lastDrop.ok,true,JSON.stringify(report.lastDrop));
   await mouse("mouseReleased", b); await delay(160);
   assert.equal((await state()).find(n => n.id === target).parentId, source);
   assert.equal(await draft(),false);await edgeGeometry(source,target);
   if (sourceSide === "top" && targetSide === "bottom") {await clearHover();await shot(`connected-${source}`);}
   await undo(); assert.ok(!(await state()).find(n => n.id === target).parentId);
  });
 }
 await check("keyboard ports show focus; Enter connects; global Escape cancels", async () => {
  await select('A');await key('Tab');
  await ev(`document.querySelector('${port("A", "top")}').focus()`); await key("Enter");
  assert.equal(await draft(),true);const focus=await ev("(()=>{const e=document.activeElement,s=getComputedStyle(e);return {visible:e.matches(':focus-visible'),outline:parseFloat(s.outlineWidth)}})()");assert.equal(focus.visible,true);assert.ok(focus.outline>=3);
  await ev(`document.querySelector('${port("B", "bottom")}').focus()`); await key("Enter"); await delay(150);
  assert.equal((await state()).find(n => n.id === "B").parentId, "A");await edgeGeometry('A','B'); await undo();
  await ev(`document.querySelector('${port("A", "left")}').focus()`); await key("Enter");assert.equal(await draft(),true); await ev("document.activeElement.blur()"); await key("Escape");
  assert.equal(await draft(),false);
 });
 for (const scale of [0.5, 1.2]) await check(`zoom ${scale}: cancel and committed relation`, async () => {
  await select("A", scale);
  const a = await beginConnection('A','bottom'), b = await point(port("B", "top"));
  await mouse("mouseMoved", b, { buttons: 1 });assert.equal(await draft(),true); await key("Escape"); await mouse("mouseReleased", b); await delay(100);assert.equal(await draft(),false);
  assert.ok(!(await state()).find(n => n.id === "B").parentId);
  await clearHover();await beginConnection('A','bottom');await mouse('mouseMoved',b,{buttons:1});await mouse('mouseReleased',b);await delay(130);assert.equal((await state()).find(n=>n.id==='B').parentId,'A');await edgeGeometry('A','B');await undo();
 });
 }
 if(!namingUi){
 await check('blank pointer release cancels an actual connection without graph changes',async()=>{
  await select('A');const before=await graphGeometry(),r=await rect('.canvas-panel'),blank={x:r.x+r.width-28,y:r.y+r.height-65};await beginConnection('A','right');await mouse('mouseMoved',blank,{buttons:1});assert.equal(await draft(),true);await mouse('mouseReleased',blank);await delay(140);assert.equal(await draft(),false);assert.deepEqual(await graphGeometry(),before);
 });
 await check('pointercancel cleans an active connection and later pointerup cannot commit',async()=>{
  await select('A');const before=await graphGeometry();await ev("window.__workflowPointerId=0;window.addEventListener('pointerdown',e=>window.__workflowPointerId=e.pointerId,{once:true,capture:true})");await beginConnection('A','right');const target=await point(port('B','left'));await mouse('mouseMoved',target,{buttons:1});assert.equal(await draft(),true);assert.ok(await ev('window.__workflowPointerId>0'));await ev("window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__workflowPointerId,bubbles:true}))");await delay(60);assert.equal(await draft(),false);await mouse('mouseReleased',target);await delay(120);assert.deepEqual(await graphGeometry(),before);
 });
 await check('Ctrl+Z during a pointer connection removes handlers before later pointerup',async()=>{
  await select('A');const before=await graphGeometry();await beginConnection('A','right');const target=await point(port('B','left'));await mouse('mouseMoved',target,{buttons:1});assert.equal(await draft(),true);await undo();const afterUndoDraft=await draft();await mouse('mouseReleased',target);await delay(140);report.ctrlZConnection={afterUndoDraft,afterReleaseDraft:await draft(),before,after:await graphGeometry()};assert.equal(report.ctrlZConnection.afterUndoDraft,false);assert.equal(report.ctrlZConnection.afterReleaseDraft,false);assert.deepEqual(report.ctrlZConnection.after,before);
 });
 await check('a real settings overlay blocks pointer release from connecting the node behind it',async()=>{
  await select('A');const before=await graphGeometry();await beginConnection('A','right');await ev("window.__naimageDebugOpenSurface('settings')");await wait("Boolean(document.querySelector('.settings-drawer'))");await delay(160);const r=await rect('.flow-node[data-node-id="B"]'),target={x:r.x+r.width/2,y:r.y+r.height/2};await mouse('mouseMoved',target,{buttons:1});report.overlayHit=await hit('.flow-node',target);assert.equal(report.overlayHit.ok,false,'drop actually lands on settings surface in front of B');assert.equal(await draft(),true);await mouse('mouseReleased',target);await delay(150);assert.equal(await draft(),false);assert.deepEqual(await graphGeometry(),before);await shot('overlay-cancel');await ev("window.__naimageDebugOpenSurface('main')");await delay(150);
 });
 await check('middle and Space pan over artwork preserve graph and selection without connection or viewer',async()=>{
  await select(['A','B']);const before=await graphGeometry(),selection=await selected(),transform=await stageTransform(),tile=await rect('.flow-node[data-node-id="A"] .node-image-tile'),p={x:tile.x+35,y:tile.y+45};
  report.pan={before:transform,tileBefore:tile};await mouse('mousePressed',p,{button:'middle',buttons:4});await mouse('mouseMoved',{x:p.x+80,y:p.y+45},{button:'middle',buttons:4});await wait(`document.querySelector('.canvas-stage').style.transform!==${JSON.stringify(transform)}`);report.pan.middle={transform:await stageTransform(),tile:await rect('.flow-node[data-node-id="A"] .node-image-tile')};assert.ok(Math.abs(report.pan.middle.tile.x-tile.x-80)<1.5&&Math.abs(report.pan.middle.tile.y-tile.y-45)<1.5);assert.equal(await draft(),false);assert.equal(await ev("Boolean(document.querySelector('.canvas-selection-box,.image-viewer'))"),false);await shot('middle-pan');await key('Escape');await mouse('mouseReleased',{x:p.x+80,y:p.y+45},{button:'middle',buttons:0});await wait(`document.querySelector('.canvas-stage').style.transform===${JSON.stringify(transform)}`);await delay(650);report.pan.middle.viewerAfterRelease=await ev("Boolean(document.querySelector('.image-viewer'))");assert.equal(report.pan.middle.viewerAfterRelease,false,'middle pan cancel cannot open delayed viewer');
  await ev('document.activeElement?.blur()');await sendKey('keyDown',' ');await mouse('mousePressed',p,{buttons:1});await mouse('mouseMoved',{x:p.x+65,y:p.y+30},{buttons:1});await wait(`document.querySelector('.canvas-stage').style.transform!==${JSON.stringify(transform)}`);report.pan.space={transform:await stageTransform(),tile:await rect('.flow-node[data-node-id="A"] .node-image-tile')};assert.ok(Math.abs(report.pan.space.tile.x-tile.x-65)<1.5&&Math.abs(report.pan.space.tile.y-tile.y-30)<1.5);assert.equal(await draft(),false);assert.equal(await ev("Boolean(document.querySelector('.canvas-selection-box,.image-viewer'))"),false);await key('Escape');await mouse('mouseReleased',{x:p.x+65,y:p.y+30});await sendKey('keyUp',' ');await wait(`document.querySelector('.canvas-stage').style.transform===${JSON.stringify(transform)}`);await delay(650);report.pan.space.viewerAfterRelease=await ev("Boolean(document.querySelector('.image-viewer'))");assert.equal(report.pan.space.viewerAfterRelease,false,'Space pan cancel cannot open delayed viewer');assert.deepEqual(await graphGeometry(),before);assert.deepEqual(await selected(),selection);
 });
 await check('real box selection cannot become a connection or move selected artwork',async()=>{
  await select('A');const before=await graphGeometry(),canvas=await rect('.workflow-canvas'),b=await rect('.flow-node[data-node-id="B"]'),a={x:canvas.x+18,y:canvas.y+16},end={x:b.x+b.width+22,y:b.y+b.height+22};report.boxSelection={start:a,end,hit:await hit('.workflow-canvas',a)};assert.equal(report.boxSelection.hit.ok,true);assert.equal((await hit('.flow-node',a)).ok,false);await mouse('mousePressed',a);await mouse('mouseMoved',end,{buttons:1});await wait("Boolean(document.querySelector('.canvas-selection-box'))");assert.equal(await draft(),false);await mouse('mouseReleased',end);await wait("Array.from(document.querySelectorAll('.flow-node.selected')).map(e=>e.dataset.nodeId).sort().join(',')==='A,B'");assert.deepEqual(await selected(),['A','B']);assert.deepEqual(await graphGeometry(),before);assert.equal(await draft(),false);await clearHover();await shot('box-selection');
 });
 for(const id of ['A','B'])await check(`ordinary ${id==='A'?'single image':'container artwork'} click opens a decoded viewer and Escape closes it`,async()=>{
  await select(id);await ev("window.__workflowClickTrace=[];for(const type of ['pointerdown','pointerup','click','dblclick','blur'])window.addEventListener(type,event=>window.__workflowClickTrace.push({type:event.type,target:event.target instanceof Element?event.target.tagName+'.'+event.target.className:'window',button:event.button,buttons:event.buttons,defaultPrevented:event.defaultPrevented,at:performance.now()}),{capture:true})");const r=await rect(`.flow-node[data-node-id="${id}"] .node-image-tile`),p={x:r.x+r.width/2,y:r.y+r.height/2};assert.equal((await hit('.node-image-tile',p)).ok,true);await mouse('mousePressed',p);await mouse('mouseReleased',p);try{await wait("Boolean(document.querySelector('.image-viewer'))")}finally{(report.ordinaryClickTraces??={})[id]=await ev('window.__workflowClickTrace');checkpoint()}const decoded=await ev("(async()=>{const imgs=Array.from(document.querySelectorAll('.image-viewer img'));await Promise.all(imgs.map(img=>img.decode()));return imgs.some(img=>img.naturalWidth===512&&img.naturalHeight===512)})()");assert.equal(decoded,true);await shot(`viewer-click-${id}`);await key('Escape');await wait("!document.querySelector('.image-viewer')");
 });
 await check('under-5px Escape cancels the trailing click while the next real under-5px click still opens the viewer',async()=>{
  await select('A');const before=await graphGeometry(),tile=await rect('.flow-node[data-node-id="A"] .node-image-tile'),p={x:tile.x+tile.width/2,y:tile.y+tile.height/2},end={x:p.x+3,y:p.y};await mouse('mousePressed',p);await mouse('mouseMoved',end,{buttons:1});await key('Escape');await mouse('mouseReleased',end);await delay(650);assert.equal(await ev("Boolean(document.querySelector('.image-viewer,.flow-node.dragging'))"),false);assert.deepEqual(await graphGeometry(),before);await mouse('mousePressed',p);await mouse('mouseMoved',end,{buttons:1});await mouse('mouseReleased',end);await wait("Boolean(document.querySelector('.image-viewer'))");assert.equal(await ev("(async()=>{const images=Array.from(document.querySelectorAll('.image-viewer img'));await Promise.all(images.map(img=>img.decode()));return images.some(img=>img.naturalWidth===512&&img.naturalHeight===512)})()"),true);await shot('viewer-subthreshold');await key('Escape');await wait("!document.querySelector('.image-viewer')");assert.deepEqual(await graphGeometry(),before);report.subthresholdClick={escapeCancelled:true,nextPhysicalClickOpenedViewer:true};
 });
 await check('single-image drag captures only after 5px, Escape restores geometry and release cannot open a viewer',async()=>{
  await select('A');const selector='.flow-node[data-node-id="A"]',before=await graphGeometry(),nodeRect=await rect(selector),tile=await rect(`${selector} .node-image-tile`),p={x:tile.x+tile.width/2,y:tile.y+tile.height/2};await ev("window.addEventListener('pointerdown',e=>window.__workflowDragPointer=e.pointerId,{once:true,capture:true})");await mouse('mousePressed',p);assert.equal(await ev(`document.querySelector('${selector}').hasPointerCapture(window.__workflowDragPointer)`),false);await mouse('mouseMoved',{x:p.x+3,y:p.y},{buttons:1});await delay(60);assert.deepEqual(await rect(selector),nodeRect);assert.equal(await ev(`document.querySelector('${selector}').hasPointerCapture(window.__workflowDragPointer)`),false);await mouse('mouseMoved',{x:p.x+6,y:p.y},{buttons:1});await wait(`document.querySelector('${selector}').hasPointerCapture(window.__workflowDragPointer)`);await mouse('mouseMoved',{x:p.x+70,y:p.y+40},{buttons:1});await wait(`Math.abs(document.querySelector('${selector}').getBoundingClientRect().x-${nodeRect.x}-70)<1.5`);report.nodeDrag={pointerId:await ev('window.__workflowDragPointer'),threshold:{before3pxCapture:false,after6pxCapture:true},before:nodeRect,preview:await rect(selector)};await shot('node-drag-threshold');await key('Escape');await mouse('mouseReleased',{x:p.x+70,y:p.y+40});await delay(650);assert.equal(await ev("Boolean(document.querySelector('.image-viewer,.flow-node.dragging'))"),false);assert.deepEqual(await graphGeometry(),before);assert.deepEqual(await rect(selector),nodeRect);assert.equal(await ev(`document.querySelector('${selector}').hasPointerCapture(window.__workflowDragPointer)`),false);assert.equal(await draft(),false);
 });
 await check('single-image drag commits exact coordinates and one undo, with no stale move handler',async()=>{
  await select('A');const before=await graphGeometry(),node=before.find(n=>n.id==='A'),tile=await rect('.flow-node[data-node-id="A"] .node-image-tile'),p={x:tile.x+tile.width/2,y:tile.y+tile.height/2},end={x:p.x+70,y:p.y+40};await mouse('mousePressed',p);await mouse('mouseMoved',end,{buttons:1});await mouse('mouseReleased',end);await delay(650);const after=await graphGeometry(),moved=after.find(n=>n.id==='A');assert.equal(moved.x,Math.round(node.x+70/0.8));assert.equal(moved.y,Math.round(node.y+40/0.8));assert.equal(await ev("Boolean(document.querySelector('.image-viewer,.flow-node.dragging'))"),false);await mouse('mouseMoved',{x:end.x+30,y:end.y+20});await delay(80);assert.deepEqual(await graphGeometry(),after);report.nodeDrag.commit={before:node,after:moved};await undo();assert.deepEqual(await graphGeometry(),before);assert.equal(await draft(),false);
 });
 await check('pointercancel before drag capture removes window listeners and preserves geometry',async()=>{
  await select('A');const before=await graphGeometry(),selector='.flow-node[data-node-id="A"]',tile=await rect(`${selector} .node-image-tile`),p={x:tile.x+tile.width-1,y:tile.y+tile.height/2};await ev("window.addEventListener('pointerdown',e=>window.__workflowDragPointer=e.pointerId,{once:true,capture:true})");assert.equal((await hit('.node-image-tile',p)).ok,true);await mouse('mousePressed',p);await mouse('mouseMoved',{x:p.x+3,y:p.y},{buttons:1});assert.equal(await ev(`document.querySelector('${selector}').hasPointerCapture(window.__workflowDragPointer)`),false);await ev(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__workflowDragPointer,clientX:${p.x+3},clientY:${p.y},bubbles:true}))`);await wait("!document.querySelector('.flow-node.dragging')");await mouse('mouseMoved',{x:p.x+30,y:p.y+20},{buttons:1});await mouse('mouseReleased',{x:p.x+30,y:p.y+20});await delay(650);assert.deepEqual(await graphGeometry(),before);assert.equal(await ev("Boolean(document.querySelector('.image-viewer,.flow-node.dragging'))"),false);assert.equal(await draft(),false);report.nodeDrag.cancelBeforeCapture=true;
 });
 await check('resize uses its handle, Escape restores geometry and one undo restores a commit',async()=>{
  await select('A');const before=await graphGeometry(),p=await point('.flow-node[data-node-id="A"] .node-resize-handle'),end={x:p.x+85,y:p.y+65};await mouse('mouseMoved',p);assert.equal((await hit('.node-resize-handle',p)).ok,true);await mouse('mousePressed',p);await mouse('mouseMoved',end,{buttons:1});await delay(70);assert.equal(await draft(),false);await key('Escape');await mouse('mouseReleased',end);await delay(130);assert.deepEqual(await graphGeometry(),before);await mouse('mousePressed',p);await mouse('mouseMoved',end,{buttons:1});assert.equal(await draft(),false);await mouse('mouseReleased',end);await delay(180);assert.ok((await graphGeometry()).find(n=>n.id==='A').width>before.find(n=>n.id==='A').width);await undo();assert.deepEqual(await graphGeometry(),before);assert.equal(await draft(),false);
 });
 }
 await select('A');
 await check("scripted visual naming reaches Renderer and suffixes retain identity after helper reorder", async () => {
  const current = await persistedState();
  const patch = id => {let node=current.nodes.find(n=>n.id===id);for(const asset of node.assets){const update=contentNamePatch(node,{displayName:'红色圆形',confidence:'high'},asset.path);assert.ok(update);node={...node,...update}}return {id,title:node.title,contentName:node.contentName,assets:node.assets}};
  automaticNameActions=["A","B"].map(id=>({type:'workflow.node.update',patch:patch(id)}));
  await applyNamingActions();
  assert.equal((await state()).find(n => n.id === "A").title, "红色圆形");
  assert.equal((await state()).find(n => n.id === "B").title, "红色圆形");
  const named=await persistedState();report.namedAssetTitles=named.nodes.find(n=>n.id==='B').assets.map(a=>({occurrenceId:a.occurrenceId,title:a.title}));assert.deepEqual(report.namedAssetTitles.map(a=>a.title).sort(),['红色圆形 · 1','红色圆形 · 2']);
  const currentB=named.nodes.find(n=>n.id==='B'),reordered={...currentB,assets:[...currentB.assets].reverse()},update=contentNamePatch(reordered,{displayName:'红色圆形',confidence:'high'},reordered.assets[0].path),identity=assets=>assets.map(({occurrenceId,title})=>({occurrenceId,title})).sort((a,b)=>a.occurrenceId.localeCompare(b.occurrenceId));assert.ok(update);assert.deepEqual(identity(update.assets),identity(currentB.assets));await clearHover(); await shot("content-names");
 });
 await check('real prompt-only edit leaves automatic ownership and allows later visual naming',async()=>{
  await openEditor('A');await fill('.unified-node-editor-fields textarea','仅修改提示词，保留自动命名。');await saveEditor();const before=(await persistedState()).nodes.find(n=>n.id==='A');assert.equal(before.contentName?.source,'visual');assert.notEqual(before.assets[0].contentName?.source,'manual');const patch=contentNamePatch(before,{displayName:'红色圆标',confidence:'high'},before.assets[0].path);assert.ok(patch);await applyNamingActions([{type:'workflow.node.update',patch:{id:'A',...patch}}]);assert.equal((await state()).find(n=>n.id==='A').title,'红色圆标');await applyNamingActions(automaticNameActions.filter(a=>a.patch.id==='A'));assert.equal((await state()).find(n=>n.id==='A').title,'红色圆形');report.promptOnlyAutomaticOwnership=true;
 });
 await check('real single-image edits protect roundtrip, numeric suffix and generic titles from stale automatic updates',async()=>{
  const snapshots=[];await openEditor('A');await fill('.unified-node-editor-fields input','临时标题');await fill('.unified-node-editor-fields input','红色圆形');await saveEditor();let current=(await persistedState()).nodes.find(n=>n.id==='A');assert.equal(current.contentName?.source,'manual');assert.equal(current.assets[0].contentName?.source,'manual');await applyNamingActions();assert.equal((await state()).find(n=>n.id==='A').title,'红色圆形');snapshots.push({title:current.title,nodeSource:current.contentName.source,assetSource:current.assets[0].contentName.source});
  for(const title of ['红色圆形 · 2','图片成果','我的封面']){await openEditor('A');await fill('.unified-node-editor-fields input',title);await saveEditor();await applyNamingActions();current=(await persistedState()).nodes.find(n=>n.id==='A');assert.equal(current.title,title);assert.equal(current.assets[0].title,title);assert.equal(current.contentName?.source,'manual');assert.equal(current.assets[0].contentName?.source,'manual');snapshots.push({title:current.title,nodeSource:current.contentName.source,assetSource:current.assets[0].contentName.source});}report.realSingleImageEdits=snapshots;await clearHover();await shot('manual-single-name');
 });
 await check('real generic container header and member edits have separate manual ownership',async()=>{
  await openEditor('B');await fill('.unified-node-editor-fields input','图片容器');await saveEditor();let current=(await persistedState()).nodes.find(n=>n.id==='B');assert.equal(current.contentName?.source,'manual');assert.ok(current.assets.every(asset=>asset.contentName?.source==='visual'),'header rename leaves member ownership automatic');
  for(const [assetIndex,title] of [[0,'红色圆形 · 2'],[1,'红色圆形 · 定稿']]){await openEditor('B',assetIndex);await fill('.unified-node-editor-fields input','待确认图片标题');await fill('.unified-node-editor-fields input',title);await saveEditor();await applyNamingActions();current=(await persistedState()).nodes.find(n=>n.id==='B');assert.equal(current.title,'图片容器');assert.equal(current.assets[assetIndex].title,title);assert.equal(current.assets[assetIndex].contentName?.source,'manual');}
  report.namedAssetTitles=current.assets.map(({occurrenceId,title})=>({occurrenceId,title}));report.genericContainerManual={title:current.title,source:current.contentName.source,assets:current.assets.map(a=>({occurrenceId:a.occurrenceId,title:a.title,source:a.contentName?.source}))};await clearHover();await shot('manual-asset-name');
 });
 await check('real image-collection rename and member edit mirror manual names into collection metadata',async()=>{
  const base=(await persistedState()).nodes.find(n=>n.id==='B'),assets=base.assets.map((asset,index)=>({...asset,occurrenceId:`occ-${createHash('sha256').update(`collection-C-${index}`).digest('hex').slice(0,32)}`,index:index+1,title:`红色圆形 · ${index+1}`,contentName:{displayName:'红色圆形',confidence:'high',source:'visual'}})),collection={id:'collection-C',name:'红色圆形',kind:'batch',generationMode:'parallel',autoFit:false,items:assets.map((asset,index)=>({id:`collection-C-item-${index+1}`,assetId:asset.assetId,occurrenceId:asset.occurrenceId,assetIndex:index+1,requestIndex:index+1,prompt:'本地图片命名验证',title:asset.title,status:'done'}))};
  await ev(`window.__naimageDebugApplyAgentActions(${JSON.stringify([{type:'workflow.node.create',node:{id:'C',parentId:'',title:'红色圆形',contentName:{displayName:'红色圆形',confidence:'high',source:'visual'},nodeType:'image',status:'done',imageState:'done',assets,imageCollection:collection,x:60,y:600}}])})`);await wait("window.__naimageDebugAgentState().nodes.some(node=>node.id==='C'&&node.assets.length===2)");report.expectedImageCount=5;await select('C',0.5);await wait("Boolean(document.querySelector('.flow-node[data-node-id=\"C\"]'))");
  const header=await rect('.flow-node[data-node-id="C"] .node-title-block'),p={x:header.x+65,y:header.y+12};await mouse('mousePressed',p,{button:'right',buttons:2});await mouse('mouseReleased',p,{button:'right',buttons:0});const menuPoint=await ev("(()=>{const e=Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.trim()==='重命名图片组');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");assert.ok(menuPoint,'real node menu exposes collection rename');await mouse('mousePressed',menuPoint);await mouse('mouseReleased',menuPoint);await wait("Boolean(document.querySelector('.image-collection-rename-fields input'))");await fill('.image-collection-rename-fields input','图片成果');await click('.image-collection-dialog button[type="submit"]');await wait("!document.querySelector('.image-collection-dialog')");
  await openEditor('C',0);await fill('.unified-node-editor-fields input','图片成果');await saveEditor();let current=(await persistedState()).nodes.find(n=>n.id==='C');assert.equal(current.title,'图片成果');assert.equal(current.contentName?.source,'manual');assert.equal(current.imageCollection.name,'图片成果');assert.equal(current.imageContainerSpec?.collection?.name,'图片成果');assert.equal(current.assets[0].title,'图片成果');assert.equal(current.assets[0].contentName?.source,'manual');assert.equal(current.imageCollection.items.find(item=>item.occurrenceId===current.assets[0].occurrenceId).title,'图片成果');const stale={type:'workflow.node.update',patch:{id:'C',title:'红色圆形',contentName:{displayName:'红色圆形',confidence:'high',source:'visual'},assets}};await applyNamingActions([stale]);current=(await persistedState()).nodes.find(n=>n.id==='C');assert.equal(current.title,'图片成果');assert.equal(current.assets[0].title,'图片成果');report.collectionManual={title:current.title,source:current.contentName.source,name:current.imageCollection.name,specName:current.imageContainerSpec.collection.name,assets:current.assets.map(a=>({occurrenceId:a.occurrenceId,title:a.title,source:a.contentName?.source})),items:current.imageCollection.items.map(item=>({occurrenceId:item.occurrenceId,title:item.title}))};report.collectionStaleAction=stale;report.collectionImageDecode=await decodedImages();await clearHover();await shot('manual-collection-name');
 });
 await command("canvas.connect", { edges: [{ sourceId: "A", targetId: "B" }], expectedProjectId: "fixture" });
 await check("moving connected node recomputes endpoints, no new generation", async () => {
  await select("B");const before=(await state()).find(n=>n.id==='B'),first=await edgeGeometry('A','B'); const r=await rect('.flow-node[data-node-id="B"] .node-title-block'),a={x:r.x+65,y:r.y+12};
  await mouse("mousePressed", a); await mouse("mouseMoved", { x: a.x + 45, y: a.y - 65 }, { buttons: 1 }); await mouse("mouseReleased", { x: a.x + 45, y: a.y - 65 }); await delay(250);
  const after=(await state()).find(n=>n.id==='B');assert.equal(after.parentId,'A');assert.ok(after.x!==before.x||after.y!==before.y);const moved=await edgeGeometry('A','B');assert.notEqual(moved.d,first.d);assert.equal(await draft(),false);await clearHover();await shot("moved-relation");
 });
 report.nativeKeyboardEvents=await ev('window.__workflowKeyEvents');await delay(1200);await ev("window.__workflowReloadToken='old-document'");await client.send("Page.reload");await wait("typeof window.__workflowReloadToken==='undefined'&&document.readyState==='complete'&&window.__naimageCanvasDebugReady&&document.querySelector('.canvas-panel .flow-node[data-node-id=\"B\"]')&&window.__naimageDebugAgentState");
 await ev("window.__workflowKeyEvents=[];for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{const row={type:e.type,key:e.key,code:e.code,keyCode:e.keyCode,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,isTrusted:e.isTrusted};if(!window.__workflowKeyEvents.some(previous=>JSON.stringify(previous)===JSON.stringify(row)))window.__workflowKeyEvents.push(row)},{capture:true})");
 await check("names, assets and directed relation persist after reload", async () => {
  await select('B');let reloaded = await persistedState();assert.equal(reloaded.nodes.find(n=>n.id==='A').contentName?.source,'manual');await applyNamingActions([...automaticNameActions,report.collectionStaleAction]);reloaded=await persistedState();const a=reloaded.nodes.find(n=>n.id==='A');assert.equal(a.title,'我的封面');assert.equal(a.contentName?.source,'manual');assert.equal(a.assets[0].contentName?.source,'manual');const b=reloaded.nodes.find(n=>n.id==='B');assert.equal(b.title,'图片容器');assert.equal(b.contentName?.source,'manual');assert.equal(b.parentId,'A');assert.deepEqual(b.assets.map(a=>({occurrenceId:a.occurrenceId,title:a.title})),report.namedAssetTitles);assert.ok(b.assets.every(asset=>asset.contentName?.source==='manual'));const c=reloaded.nodes.find(n=>n.id==='C');assert.equal(c.title,'图片成果');assert.equal(c.contentName?.source,'manual');assert.equal(c.imageCollection.name,'图片成果');assert.equal(c.imageContainerSpec.collection.name,'图片成果');assert.equal(c.assets[0].title,'图片成果');assert.equal(c.assets[0].contentName?.source,'manual');assert.equal(c.imageCollection.items.find(item=>item.occurrenceId===c.assets[0].occurrenceId).title,'图片成果');report.reloadedImageDecode=await decodedImages();await edgeGeometry('A','B');await clearHover();await shot('names-reloaded');
 });
 await check("running compact scope: anchored keyboard menu, focus restoration, no overflow at 884×640", async () => {
  await ev("window.__naimageDebugOpenSurface('agent-running')"); await delay(200);
  const button = '.project-agent-steer-mode .glass-select-trigger';
  assert.equal(await ev("Boolean(document.querySelector('.project-agent-command-input .project-agent-steer-mode'))"),true);
  await ev(`document.querySelector('${button}').focus()`); await key("Enter"); await delay(120); await shot("scope-options");
  assert.equal(await ev("document.querySelectorAll('.glass-select-option').length"), 3);
  await key("ArrowDown"); await key("Enter"); await delay(120); assert.equal(await ev(`document.activeElement===document.querySelector('${button}')`), true);
  await click(button); await key("Escape");await delay(60); assert.equal(await ev(`document.activeElement===document.querySelector('${button}')`), true);
  await windowSize(884,640);
  await click(button); await delay(100);
  report.smallWindow = await ev("(()=>{const r=document.querySelector('.glass-select-menu,[role=listbox]')?.getBoundingClientRect(),t=document.querySelector('.project-agent-steer-mode .glass-select-trigger')?.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r?.left,top:r?.top,right:r?.right,bottom:r?.bottom,menuWidth:r?.width,menuHeight:r?.height,trigger:t?{top:t.top,bottom:t.bottom}:null,overflow:document.documentElement.scrollWidth>innerWidth}})()");
  const box=report.smallWindow;assert.equal(box.overflow,false);assert.ok(box.menuWidth>0&&box.menuHeight>0&&box.left>=0&&box.top>=0&&box.right<=884&&box.bottom<=640);assert.ok(Math.min(Math.abs(box.top-box.trigger.bottom),Math.abs(box.bottom-box.trigger.top))<=14); await shot("scope-small"); await key("Escape");await delay(60);assert.equal(await ev(`document.activeElement===document.querySelector('${button}')`),true);
 });
 await check('native keyboard events carry trusted key/code/virtual-key and real Ctrl modifiers',async()=>{
  report.nativeKeyboardEvents.push(...await ev('window.__workflowKeyEvents'));const expected=[['a','KeyA',65,true],['Enter','Enter',13,false],['Escape','Escape',27,false],['ArrowDown','ArrowDown',40,false],...(!namingUi?[['z','KeyZ',90,true],[' ','Space',32,false]]:[]),...(!namingUi&&!remainingUi?[['Tab','Tab',9,false]]:[])];for(const[key,code,keyCode,ctrlKey]of expected)for(const type of ['keydown','keyup'])assert.ok(report.nativeKeyboardEvents.some(e=>e.type===type&&e.key===key&&e.code===code&&e.keyCode===keyCode&&e.ctrlKey===ctrlKey&&e.isTrusted),`trusted ${type} ${ctrlKey?'Ctrl+':''}${code}/${keyCode}`);
 });
 report.ok = true;
} catch (error) { report.error = { message: error.message, stack: error.stack }; if (client) await shot("failure").catch(() => {}); }
finally {
 tearingDown=true;
 report.sourceAfter=sourceHashes();report.sourceStable=sourceFiles.every(file=>report.sourceBefore[file]===report.sourceAfter[file]);if(!report.sourceStable){report.ok=false;report.error??={message:'Product source changed during the GUI run'};}
 writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
 if (client) { await ev("void window.naimageWindow?.close?.()").catch(() => {}); try { client.close(); } catch {} }
 try {browserClient?.close()}catch{}
 if (electron) await forceKillProcessTree(electron.pid).catch(() => {});
 if (vite) await forceKillProcessTree(vite.pid).catch(() => {});
 writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ ok:report.ok, checks:report.checks.length, error:report.error?.message, report:join(runDir,"report.json") }));
 if (!report.ok) process.exitCode = 1;
}
