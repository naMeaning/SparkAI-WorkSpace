import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime, pollForDebugTarget } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

// This explicit, one-shot live check is excluded from automated test commands.
assert.equal(process.argv.includes("--authorized-image-budget=2"), true, "requires explicit authorization for exactly two image sends");
const sourceConfig = process.argv.find(arg => arg.startsWith("--config-source="))?.slice(16);
assert.ok(sourceConfig, "existing installed configuration directory is required");
const root = resolve(import.meta.dirname, ".."), stamp = new Date().toISOString().replace(/[:.]/g, "-");
const requestedRunDir = process.argv.find(arg => arg.startsWith("--run-dir="))?.slice(10);
const authorizationPath = join(root, ".diagnostics", "image-edit-real-2026-10-22-authorization.json");
mkdirSync(join(root, ".diagnostics"), { recursive: true });
const priorAuthorization = existsSync(authorizationPath) ? JSON.parse(readFileSync(authorizationPath, "utf8")) : null;
const runDir = priorAuthorization?.runDir || resolve(root, requestedRunDir || join(".diagnostics", `image-edit-real-${stamp}`));
if (requestedRunDir) assert.equal(resolve(root, requestedRunDir), runDir, "authorization is already bound to another durable receipt");
if (!priorAuthorization) writeFileSync(authorizationPath, JSON.stringify({ version: 1, authorizedImageSends: 2, runDir }, null, 2), { flag: "wx" });
const config = join(runDir, "config"), project = join(runDir, "project");
const budgetPath = join(runDir, "budget.json"), reportPath = join(runDir, "report.json"), resuming = existsSync(budgetPath);
for (const dir of [config, join(project, "assets"), join(runDir, "provider")]) mkdirSync(dir, { recursive: true });
if (!resuming) for (const file of ["app-settings.json", "app-settings.secrets.json"]) { assert.equal(existsSync(join(sourceConfig, file)), true); copyFileSync(join(sourceConfig, file), join(config, file)); }
// Windows safeStorage uses this profile's encrypted key. Copy it opaquely;
// decrypting the sidecar in a fresh unrelated profile cannot recover credentials.
if (!resuming) {
  mkdirSync(join(runDir, "user-data"), { recursive: true });
  const localState = resolve(sourceConfig, "..", "Local State");
  assert.equal(existsSync(localState), true, "installed safeStorage profile context is required");
  copyFileSync(localState, join(runDir, "user-data", "Local State"));
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await sharp(join(root, "docs/assets/github/02-product.jpg")).png().toBuffer();
const sourcePath = join(project, "assets", "speaker-original.png");
const priorNode = resuming ? JSON.parse(readFileSync(join(project, "session.json"), "utf8")).nodes.find(node => node.id === "A") : null;
const target = priorNode ? { assetId: priorNode.assets[0].assetId, occurrenceId: priorNode.assets[0].occurrenceId, contentHash: priorNode.assets[0].contentHash } : { assetId: `image-${digest(source).slice(0, 32)}`, occurrenceId: `occ-${randomUUID().replaceAll("-", "")}`, contentHash: digest(source) };
const sourceAsset = priorNode?.assets[0] || { ...target, type: "file", path: sourcePath, relativePath: "assets/speaker-original.png", width: 1024, height: 1024, mimeType: "image/png", status: "done" };
const sourceNode = priorNode || { id: "A", title: "原始商品图", type: "image", status: "done", imageState: "done", assets: [sourceAsset], x: 60, y: 100, width: 320, height: 320, zOrder: 1 };
if (!resuming) {
  writeFileSync(sourcePath, source);
  writeFileSync(join(project, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, activeConversationId: "live-edit-conversation", conversations: [{ id: "live-edit-conversation", title: "有限真实图片验证", messages: [] }], nodes: [sourceNode], messages: [], layoutGroups: [] }));
  writeFileSync(join(config, "project-list.json"), JSON.stringify({ activeProjectId: "live-edit-project", projects: [{ id: "live-edit-project", name: "商品图片编辑 · 有限真实验证", path: project, sessionPath: join(project, "session.json"), external: true }] }));
}
assert.equal(digest(readFileSync(sourcePath)), target.contentHash, "frozen original must remain unchanged");
const budget = resuming ? JSON.parse(readFileSync(budgetPath, "utf8")) : { version: 1, authorizedImageSends: 2, conversationSends: 0, videoSends: 0, createdAt: new Date().toISOString(), sourceHash: target.contentHash,
  operations: ["redraw", "cutout"].map(mode => { const runId = `live-${mode}-${randomUUID()}`; return { mode, runId, operationId: runId, state: "reserved", transportAttempts: 0, networkPosts: 0 }; }) };
assert.equal(budget.authorizedImageSends, 2); assert.equal(budget.sourceHash, target.contentHash);
assert.deepEqual(budget.operations.map(slot => slot.mode), ["redraw", "cutout"]);
assert.ok(budget.operations.every(slot => slot.operationId === slot.runId && [0, 1].includes(slot.transportAttempts) && [0, 1].includes(slot.networkPosts)));
if (!resuming) writeFileSync(budgetPath, JSON.stringify(budget, null, 2), { flag: "wx" });
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : { ok: false, realImageBudget: 2, realConversationRequests: 0, realVideoRequests: 0, source: { fixture: "docs/assets/github/02-product.jpg", contentHash: target.contentHash, width: 1024, height: 1024 }, results: [], screenshots: [] };
if (resuming) (report.priorInvocations ||= []).push({ at: new Date().toISOString(), results: report.results, imageSends: budget.operations.reduce((count, slot) => count + slot.networkPosts, 0) });
const checkpoint = () => writeFileSync(reportPath, JSON.stringify(report, null, 2)); checkpoint();
const bootstrap = `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=${JSON.stringify(root)},runDir=${JSON.stringify(runDir)},budgetPath=${JSON.stringify(budgetPath)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const moduleOwner=require(path.join(root,'desktop/image-generation-service.cjs'));
const normalize=require(path.join(root,'runtime/image-generation/normalize-response.cjs')).normalizeImageGenerationResponse;
const metadata=require(path.join(root,'runtime/image-generation-metadata.cjs')).pickImageGenerationResponseMetadata;
const detect=require(path.join(root,'runtime/encoded-image-format.cjs')).detectEncodedImageFormat;
const original=moduleOwner.createImageGenerationService;
let active;
const read=()=>JSON.parse(fs.readFileSync(budgetPath,'utf8'));
function update(patch){const b=read(),s=b.operations.find(s=>s.runId===active);Object.assign(s,patch);fs.writeFileSync(budgetPath,JSON.stringify(b,null,2));return s;}
const blocked=()=>Object.assign(new Error('Live verification refuses a repeated or unreserved image send.'),{code:'VERIFICATION_SEND_BLOCKED',unsafeToRetry:true});
const transportOwner=require(path.join(root,'desktop/new-api-transport.cjs')),createTransport=transportOwner.createNewApiTransport;
transportOwner.createNewApiTransport=options=>{
 const transport=createTransport(options),fetch=transport.newApiTransportFetch;
 transport.newApiTransportFetch=async(url,options={})=>{
  const endpoint=new URL(url).pathname,post=String(options.method||'GET').toUpperCase()==='POST';
  // A diagnostic must not rotate the installed session's upstream credentials.
  if(post&&/\\/api\\/user\\/auth\\/refresh$/.test(endpoint))throw Object.assign(new Error('Diagnostic auth refresh is disabled.'),{code:'VERIFICATION_AUTH_REFRESH_BLOCKED'});
  if(post&&/\\/(?:images|image-tasks)(?:\\/|$)|:generateContent$/i.test(endpoint)){
   const b=read(),s=b.operations.find(s=>s.runId===active);
   if(!s||s.networkPosts!==0||b.operations.reduce((n,s)=>n+s.networkPosts,0)>=2)throw blocked();
   update({networkPosts:1,state:'network-sent',networkSentAt:new Date().toISOString(),networkEndpoint:endpoint});
   try{const response=await fetch(url,options);update({httpStatus:response.status});return response;}catch(error){update({networkOutcome:'failed-or-unknown'});throw error;}
  }
  if(post&&/\\/(?:responses|chat\\/completions|videos|video-tasks)(?:\\/|$)/i.test(endpoint))throw blocked();
  return fetch(url,options);
 };return transport;
};
moduleOwner.createImageGenerationService=options=>{
 const wrapped={...options};
 for(const key of ['newApiRelayJson','newApiRelayMultipart','newApiRelayAsyncImage'])if(options[key])wrapped[key]=async(...args)=>{
  const b=read(),s=b.operations.find(s=>s.runId===active);
  if(!s||s.transportAttempts!==0||s.networkPosts!==0)throw blocked();
  update({transportAttempts:1,state:'sent',sentAt:new Date().toISOString(),endpoint:String(args[1]).split('?')[0]});
  const onConnectionResolved=args[3]?.onConnectionResolved;
  args[3]={...args[3],onConnectionResolved:value=>{update({connectionHash:hash(Buffer.from(String(value.baseUrl))),connectionResolved:true});onConnectionResolved?.(value);}};
  try{
   const raw=await options[key](...args),normalized=normalize(raw),provider=[];
   for(const [index,image]of(normalized.images||[]).entries()){
    try{const bytes=image.type==='base64'?Buffer.from(image.value.replace(/^data:image\\/[^;]+;base64,/,''),'base64'):await options.downloadImage(image.value);
     const format=detect(bytes),relative='provider/'+s.mode+'-'+(index+1)+'.'+(format?.format||'bin');fs.writeFileSync(path.join(runDir,relative),bytes);
     provider.push({file:relative,bytes:bytes.length,sha256:hash(bytes),mimeType:format?.mimeType,actualParams:metadata(raw,image.actualParams)});
    }catch{provider.push({captureFailed:true});}
   }
   update({state:'response',responseAt:new Date().toISOString(),provider});return raw;
  }catch(error){update({state:'failed-or-unknown',errorCode:String(error.code||error.errorCategory||'REQUEST_FAILED').slice(0,100),httpStatus:Number(error.status||error.statusCode)||undefined});throw error;}
 };
 const service=original(wrapped),generate=service.generate;
 service.generate=async(settings,payload)=>{
  const b=read(),matches=b.operations.filter(s=>[payload.agentRunId,payload.operationId].includes(s.runId)||String(payload.runId||'')===s.runId||String(payload.runId||'').startsWith(s.runId+'-'));
  const slot=matches.length===1?matches[0]:undefined;
  if(!slot||slot.state!=='reserved'||Number(payload.count??payload.n??1)!==1||payload.editImage?.contentHash!==b.sourceHash)throw blocked();active=slot.runId;
  const config=service.resolveModelConfig(settings,payload.model||settings.imageModel);
  update({state:'invoking',runtimeRequestId:payload.runId,runtimeAgentRunId:payload.agentRunId,model:config.model,protocol:config.protocol,gateway:config.gateway,transport:config.transportMode,effectiveOperation:payload.editOperation||payload.operation||payload.mode});
  try{return await generate(settings,payload);}finally{active=undefined;}
 };return service;
};
require(path.join(root,'electron-main.cjs'));
`;
const bootstrapPath = join(runDir, "boot.cjs"); writeFileSync(bootstrapPath, bootstrap);
const scopeAsset = { ...target, bindingId: `binding:A:A:${target.occurrenceId}`, nodeId: "A", ownerNodeId: "A", ownerAssetIndex: 0, assetIndex: 0, containerSlot: 0, role: "source", name: "商品原图", path: sourcePath, relativePath: sourceAsset.relativePath, mimeType: "image/png" };
const taskScope = { version: 2, origin: "node", scopeType: "single", canvasRevision: 1, sourceNodeIds: ["A"], sourceContainerIds: [], referenceContainerIds: [], sourceBindingIds: [scopeAsset.bindingId], referenceBindingIds: [], materials: [scopeAsset], sourceAssets: [scopeAsset], referenceAssets: [], resultPolicy: "single", confirmationPolicy: "direct", sourceAssetCount: 1, referenceAssetCount: 0, truncated: false };
const mask = Buffer.alloc(1024 * 1024 * 4, 255);
for (let y = 275; y < 385; y++) for (let x = 250; x < 810; x++) mask[(y * 1024 + x) * 4 + 3] = 0;
const editMask = await sharp(mask, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
writeFileSync(join(runDir, "redraw-mask.png"), editMask);
const subjectMask = await sharp(Buffer.from('<svg width="1024" height="1024"><path d="M135 450 L230 430 L245 350 L310 315 L680 270 L765 295 L812 350 L822 425 L810 525 L760 570 L400 620 L270 580 L160 550 Z" fill="white"/></svg>')).png().toBuffer();
writeFileSync(join(runDir, "cutout-subject-mask.png"), subjectMask);
let electron, vite, client;
const ev = expression => evaluateRuntime(client, expression);
async function wait(predicate, name, timeoutMs = 30000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (await predicate()) return; await delay(120); } throw new Error(`Timeout: ${name}`); }
async function screenshot(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`)); report.screenshots.push(`${name}.png`); checkpoint(); }
async function command(command, args) { const endpoint = JSON.parse(readFileSync(join(config, "automation/endpoint.json"), "utf8")); const value = await (await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, args, timeoutMs: 15000 }) })).json(); assert.equal(value.ok, true); return value.result; }
async function stop() {
  if (!electron) return;
  await ev("void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),80)").catch(() => {}); client?.close(); client = null;
  const exited = await waitForChildExit(electron, 15000); report.shutdown = { exited, exitCode: electron.exitCode, forced: false }; assert.equal(exited, true); assert.equal(electron.exitCode, 0); electron = null;
}
try {
  const port = await allocateDebugPort(), devUrl = `http://127.0.0.1:${port}`, debugPort = await allocateDebugPort();
  vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" }); await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100 });
  electron = spawn(createRequire(import.meta.url)("electron"), [bootstrapPath, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl, NAIMAGE_AIDEBUG: "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1", NAIMAGE_CONFIG_DIR: config, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"), NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "no-server.cjs") } });
  const targetPage = await pollForDebugTarget({ port: debugPort, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window/.test(item.url)) });
  client = new BasicCdpClient(targetPage.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await wait(() => ev("Boolean(window.__naimageDebugAgentState?.().configReady&&window.__naimageDebugAgentState().nodes.some(n=>n.id==='A')&&window.naimageAgent?.runTool)"), "real project ready"); await delay(350);
  await ev("window.naimageConfig.debugWindowBounds({width:1584,height:992})"); await screenshot("original-project");
  for (const receipt of budget.operations) {
    // Each identity and budget reservation already exists durably before runTool.
    const currentBudget = JSON.parse(readFileSync(budgetPath, "utf8")), latest = currentBudget.operations.find(slot => slot.runId === receipt.runId);
    if (latest.networkPosts !== 0 || latest.transportAttempts !== 0) { report.skippedSpentOperations ||= []; if (!report.skippedSpentOperations.includes(receipt.runId)) report.skippedSpentOperations.push(receipt.runId); checkpoint(); continue; }
    assert.ok(["reserved", "invoking"].includes(latest.state), "only provable zero-send preflight can resume");
    latest.state = "reserved"; writeFileSync(budgetPath, JSON.stringify(currentBudget, null, 2));
    report.results = report.results.filter(result => result.runId !== receipt.runId); checkpoint();
    const prompt = receipt.mode === "redraw" ? "只修改蒙版透明区域：将音箱顶部的橙色外壳改为深青绿色金属表面。保留金色旋钮、织物网罩、皮质提手、产品结构、背景灯光与构图。不得添加文字或标识，严格保持原图1024×1024。" : "完整提取这台便携音箱及皮质提手，去掉蓝色背景和底座，保留金色旋钮、织物网罩、橙色外壳的自然边缘和内部细节，输出真实透明PNG，画幅1024×1024，主体完整可见。";
    const payload = { runId: receipt.runId, name: "image_gen", input: { operation: receipt.mode, parentId: "A", prompt, editImage: { ...scopeAsset }, maskDataUrl: `data:image/png;base64,${(receipt.mode === "redraw" ? editMask : subjectMask).toString("base64")}`, ratio: "1:1", resolution: "1K", size: "1024x1024", count: 1, quality: "high", inputFidelity: "high", brief: receipt.mode === "redraw" ? "有限真实局部编辑验证" : "有限真实抠图验证" }, prompt, nodes: [sourceNode], selectedNodeId: "A", selectedNodeIds: ["A"], canvasRevision: 1, taskScope, projectId: "live-edit-project", conversationId: "live-edit-conversation" };
    await ev(`(()=>{window.__liveEditCheck={done:false};void window.naimageAgent.runTool(${JSON.stringify(payload)}).then(async r=>{if(r.actions?.length)await window.__naimageDebugApplyAgentActions(r.actions);window.__liveEditCheck={done:true,ok:r.envelope?.ok!==false,errorCode:r.envelope?.errorCode||'',summary:r.envelope?.ok===false?r.envelope?.summary:'',actionCount:r.actions?.length||0}},()=>{window.__liveEditCheck={done:true,ok:false,errorCode:'BRIDGE_FAILED'}});return {started:true}})()`);
    await wait(() => ev("window.__liveEditCheck?.done===true"), `${receipt.mode} single request`, 240000);
    const outcome = await ev("window.__liveEditCheck");
    const entry = { mode: receipt.mode, runId: receipt.runId, operationId: receipt.operationId, ok: outcome.ok, errorCode: outcome.errorCode, failureStage: outcome.ok ? undefined : "image_gen rejected or failed; durable budget records the transport outcome" };
    if (outcome.ok) {
      let node;
      await wait(async () => { const snapshot = await ev("window.__naimageDebugAgentState()"); node = snapshot.nodes.find(node => node.parentId === "A" && String(node.prompt || "").includes(`operation: ${receipt.mode}`)); return node?.imageState === "done" && node.assets?.length && (receipt.mode !== "cutout" || /cutout-transparent/.test(node.assets[0].path)); }, `${receipt.mode} local result`, 40000);
      const output = node.assets[0], localFile = join(runDir, receipt.mode === "redraw" ? "local-composite.png" : "local-alpha.png"); copyFileSync(output.path, localFile);
      entry.nodeId = node.id; entry.local = { file: receipt.mode === "redraw" ? "local-composite.png" : "local-alpha.png", bytes: readFileSync(localFile).length, sha256: digest(readFileSync(localFile)) };
      const capabilities = createRequire(import.meta.url)("../runtime/image-generation/edit-capabilities.cjs");
      entry.validation = receipt.mode === "redraw" ? await capabilities.verifyProtectedPixels(sourcePath, localFile, [], { mask: editMask }) : await capabilities.verifyAlphaSubject(localFile);
      assert.equal(entry.validation.ok, true);
      await command("canvas.select", { expectedProjectId: "live-edit-project", ids: ["A", node.id] });
      await ev("window.__naimageDebugSetViewport({x:30,y:30,scale:0.65})"); await delay(400); await screenshot(`${receipt.mode}-real-result`);
    }
    entry.sourceUnchanged = digest(readFileSync(sourcePath)) === target.contentHash; assert.equal(entry.sourceUnchanged, true); report.results.push(entry); checkpoint();
  }
  await stop(); report.budget = JSON.parse(readFileSync(budgetPath, "utf8")); report.imageSends = report.budget.operations.reduce((count, slot) => count + slot.networkPosts, 0); report.transportAttempts = report.budget.operations.reduce((count, slot) => count + slot.transportAttempts, 0); assert.ok(report.imageSends <= 2); report.ok = report.results.length === 2 && report.results.every(result => result.ok && result.validation?.ok); checkpoint();
  console.log(JSON.stringify({ ok: report.ok, imageSends: report.imageSends, results: report.results.map(({ mode, ok, validation }) => ({ mode, ok, validation })), report: reportPath }));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  report.failure = { code: error.code || "VERIFICATION_FAILED", message: /Timeout:|assertion|expected|requires/i.test(error.message) ? error.message.slice(0, 300) : "verification could not complete; inspect private diagnostics" };
  if (client) { await screenshot("failure").catch(() => {}); await stop().catch(() => {}); }
  report.budget = JSON.parse(readFileSync(budgetPath, "utf8")); checkpoint(); process.exitCode = 1;
  console.error(JSON.stringify({ ok: false, failure: report.failure, report: reportPath }));
} finally { if (vite) vite.kill(); }
