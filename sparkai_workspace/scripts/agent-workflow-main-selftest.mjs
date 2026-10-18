import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { BasicCdpClient, evaluateRuntime as evaluateRaw, pollForDebugTarget, waitForRuntimeExpression } from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForChildExit, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { capturePngScreenshotToFile } from "./aidebug/harness/screenshot.mjs";

// Real Renderer dispatch -> preload IPC -> Main Runtime -> unified image service
// -> loopback HTTP -> managed project files. The model server is a scripted
// protocol fixture; no provider request or real visual recognition is performed.
const root = resolve(import.meta.dirname, "..");
const exeArgument = process.argv.find(value => value.startsWith("--exe="));
const executable = exeArgument ? resolve(exeArgument.slice(6)) : "";
const { buildProductionSymbolPlan, transformCode } = createRequire(import.meta.url)("./production-symbol-compaction.cjs");
const symbolPlan = executable ? buildProductionSymbolPlan(root) : null;
const evaluateRuntime = (target, expression, ...options) => evaluateRaw(target,
  symbolPlan ? transformCode(expression, symbolPlan, "agent-workflow-main-test.js") : expression, ...options);
const runDir = join(root, ".diagnostics", `agent-workflow-main-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config"), projectDir = join(runDir, "project");
for (const directory of [configDir, projectDir, join(runDir, "user-data")]) mkdirSync(directory, { recursive: true });
// Use a model explicitly routed through Responses by the current protocol map.
const agentModel = "gpt-5.6-sol", model = "grok-imagine-image-2.0", doneText = "本地冻结配置验证完成。";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = ["electron-main.cjs", "agent-runtime.cjs", "preload.cjs", "desktop/ipc/agent-ipc.cjs", "desktop/ipc/config-ipc.cjs",
  "runtime/image-config-snapshot.mjs", "runtime/image-input-manifest.cjs", "desktop/image-generation-service.cjs", "runtime/image-generation/types.cjs", "runtime/image-generation/adapters.cjs",
  "desktop/project-session-merge.cjs", "desktop/project-session-normalizer.cjs", "runtime/image-asset-identity.mjs"];
const localSourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sha256(readFileSync(join(root, file)))]));
const report = { ok: false, packaged: Boolean(executable), runtimeMode: executable ? "normal-isolated-config" : "development-isolated-config", realModelRequests: 0, actualModelRecognition: false, checks: [], screenshots: [],
  modelPosts: 0, imagePosts: 0, requests: [], modelContexts: [], wire: [], serverErrors: [], sourceHashes: localSourceHashes };
let electron, vite, client, pendingFirstResponse, releaseFirstResponse, firstRequestResolve, reviewPath = "";
const firstRequest = new Promise(resolveFirst => { firstRequestResolve = resolveFirst; });
const firstResponseGate = new Promise(resolveGate => { releaseFirstResponse = resolveGate; });
const checkpoint = () => writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
const ev = expression => evaluateRuntime(client, expression);
async function waitFor(predicate, label, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await predicate()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function check(name, action) { report.current = name; checkpoint(); await action(); report.checks.push(name); checkpoint(); }
async function screenshot(name) { await capturePngScreenshotToFile(client, join(runDir, `${name}.png`), { captureBeyondViewport: false }); report.screenshots.push(`${name}.png`); }
function json(res, value, status = 200) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); }
function responses(res, output, round) {
  const response = { id: `local-response-${round}`, status: "completed", output };
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\ndata: [DONE]\n\n`);
}
const call = (name, args, id) => ({ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) });
function textContent(body) {
  return (Array.isArray(body.input) ? body.input : []).flatMap(item => {
    if (typeof item.content === "string") return [item.content];
    return (Array.isArray(item.content) ? item.content : []).filter(part => ["input_text", "text"].includes(part.type)).map(part => part.text || "");
  }).join("\n");
}
function contextSummary(body) {
  const text = textContent(body);
  const configurationLine = text.split("Current Request Configuration (historical node imageParams are descriptive only):\n")[1]?.split("\n")[0];
  const configuration = configurationLine ? JSON.parse(configurationLine) : null;
  const imageTool = body.tools?.find(tool => tool.name === "image_gen");
  return { configuration, modelEnum: imageTool?.parameters?.properties?.model?.enum || [],
    inputImages: (body.input || []).flatMap(item => Array.isArray(item.output) ? item.output : Array.isArray(item.content) ? item.content : []).filter(part => part.type === "input_image").length };
}
function summarySettings(settings) {
  const config = settings.imageModelConfigs?.find(item => item.model === model), binding = settings.imageModelBindings?.find(item => item.model === model);
  return { model: settings.imageModel, ratio: settings.imageRatio, resolution: settings.imageResolution, quality: settings.imageQuality, count: settings.imageCount,
    config: { protocol: config?.protocol, gateway: config?.gateway, supportedQualities: config?.capabilities?.supportedQualities },
    binding: { protocol: binding?.protocol, gateway: binding?.gateway } };
}
function singlePersistedResult() {
  const session = JSON.parse(readFileSync(join(projectDir, "session.json"), "utf8"));
  assert.equal(session.nodes.length, 1, "The saved project contains exactly one generated node");
  const node = session.nodes[0];
  assert.equal(node.assets.length, 1, "The generated node contains exactly one asset");
  assert.equal(node.outputs, 1, "The generated node persists exactly one output");
  assert.equal(node.assets[0].path, reviewPath);
  return { nodeId: node.id, nodeCount: session.nodes.length, assetCount: node.assets.length, outputs: node.outputs,
    assetId: node.assets[0].assetId, occurrenceId: node.assets[0].occurrenceId,
    ratio: node.imageParams.ratio, resolution: node.imageParams.resolution, quality: node.imageParams.quality };
}
function processSnapshot(pid, knownPids = []) {
  if (process.platform !== "win32") return null;
  const ids = [pid, ...knownPids].filter(Number.isSafeInteger);
  const script = `$workflowProcesses = @(Get-CimInstance Win32_Process); $workflowIds = [System.Collections.Generic.HashSet[int]]::new(); foreach ($workflowId in @(${ids.join(",")})) { [void]$workflowIds.Add([int]$workflowId) }; do { $workflowAdded = 0; foreach ($workflowProcess in $workflowProcesses) { if ($workflowIds.Contains([int]$workflowProcess.ParentProcessId) -and $workflowIds.Add([int]$workflowProcess.ProcessId)) { $workflowAdded++ } } } while ($workflowAdded -gt 0); @($workflowProcesses | Where-Object { $workflowIds.Contains([int]$_.ProcessId) } | Select-Object ProcessId, ParentProcessId, Name, @{Name='role';Expression={if ($_.CommandLine -match '--type=([^ ]+)') {$Matches[1]} else {'main-or-worker'}}}) | ConvertTo-Json -Compress`;
  try {
    const snapshot = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 5000 }) || "[]");
    return Array.isArray(snapshot) ? snapshot : [snapshot];
  } catch (error) { return { error: error.message }; }
}
const pngBytes = await sharp(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="white"/><circle cx="512" cy="512" r="310" fill="#df3548"/></svg>')).png().toBuffer();
const server = createServer(async (req, res) => {
  try {
    let raw = ""; for await (const chunk of req) raw += chunk;
    report.requests.push({ method: req.method, path: req.url });
    if (req.url === "/v1/responses") {
      const body = JSON.parse(raw), round = report.modelPosts++;
      assert.equal(body.model, agentModel);
      report.modelContexts.push(contextSummary(body)); checkpoint();
      if (round === 0) {
        pendingFirstResponse = res; firstRequestResolve(); await firstResponseGate;
        if (!res.destroyed) responses(res, [call("image_gen", { operation: "generate", prompt: "白色背景上的红色圆形", brief: "生成一张图片" }, "frozen-image")], round);
      } else if (round === 1) {
        const receipt = body.input.find(item => item.type === "function_call_output" && item.call_id === "frozen-image");
        assert.equal(typeof receipt?.output, "string");
        reviewPath = receipt.output.split("project-local output_paths ready for view_image:\n")[1]?.split("\n")[0]?.replace(/^- /, "") || "";
        assert.ok(isAbsolute(reviewPath), "Main image receipt supplies the managed output path");
        const relation = relative(projectDir, reviewPath); assert.ok(relation && !relation.startsWith("..") && !isAbsolute(relation));
        responses(res, [call("view_image", { path: reviewPath, detail: "high" }, "review-frozen-image")], round);
      } else if (round === 2) {
        assert.equal(report.modelContexts[round].inputImages, 1, "Same main model receives the generated image pixels");
        responses(res, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: doneText }] }], round);
      } else throw new Error("Unexpected model retry after the scripted completion");
    } else if (req.url === "/v1/images/generations") {
      report.imagePosts++;
      assert.equal(req.method, "POST"); assert.match(String(req.headers["content-type"]), /application\/json/);
      const body = JSON.parse(raw);
      report.wire.push({ model: body.model, n: body.n, aspectRatio: body.aspect_ratio, resolution: body.resolution, quality: body.quality,
        responseFormat: body.response_format, size: body.size ?? null }); checkpoint();
      json(res, { data: [{ b64_json: pngBytes.toString("base64") }] });
    } else if (req.url === "/v1/chat/completions") throw new Error("Expected the real Responses endpoint, received Chat Completions");
    else if (req.url === "/v1/models") json(res, { data: [{ id: agentModel }, { id: model }] });
    else json(res, { success: true, data: { id: 1, username: "fixture", quota: 1000000, items: [] } });
  } catch (error) {
    report.serverErrors.push(error.message); checkpoint();
    if (!res.headersSent) json(res, { error: { message: error.message } }, 500); else res.end();
  }
});
async function stop() {
  if (!electron) return;
  const pid = electron.pid, before = processSnapshot(pid), startedAt = Date.now();
  try { await client?.send("Runtime.evaluate", { expression: "void setTimeout(()=>window.naimageConfig.windowControl({action:'close'}),100)", awaitPromise: false }); } catch {}
  client?.close(); client = null;
  const exited = await waitForChildExit(electron, 10_000);
  const elapsedMs = Date.now() - startedAt;
  const after = processSnapshot(pid, Array.isArray(before) ? before.map(item => item.ProcessId) : []);
  const descendantsExited = process.platform !== "win32" || Array.isArray(after) && after.length === 0;
  report.shutdown = { normalExit: exited && electron.exitCode === 0 && descendantsExited, exitCode: electron.exitCode, signal: electron.signalCode,
    forced: false, elapsedMs, processesBefore: before, processesAfter: after,
    ...(!exited || !descendantsExited ? { pending: true, pid: electron.pid } : {}) };
  if (!exited) electron.unref();
  electron = null;
}
try {
  if (executable) {
    const require = createRequire(import.meta.url), electronBuilderRoot = dirname(require.resolve("electron-builder/package.json"));
    const asar = require(require.resolve("@electron/asar", { paths: [electronBuilderRoot] }));
    const asarPath = join(dirname(executable), "resources/app.asar");
    report.executableSha256 = sha256(readFileSync(executable)); report.asarSha256 = sha256(readFileSync(asarPath));
    const packagedHashes = Object.fromEntries(sourceFiles.map(file => [file, sha256(asar.extractFile(asarPath, normalize(file)))]));
    assert.deepEqual(packagedHashes, localSourceHashes, "Installed backend matches the reviewed Main/runtime source");
    report.packagedBackendMatchesSource = true;
  }
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: "workflow-main", projects: [{ id: "workflow-main", name: "冻结配置 Main 验证", path: projectDir,
    sessionPath: join(projectDir, "session.json"), external: true }] }));
  writeFileSync(join(projectDir, "session.json"), JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes: [], messages: [], conversations: [], layoutGroups: [] }));
  const initialSettings = { accessMode: "account", accountBaseUrl: base, serverUrl: base, relayBaseUrl: base, updateBaseUrl: base, agentBaseUrl: base, imageBaseUrl: base,
    serverAuthProtocol: "legacy", serverSessionCookie: "fixture-session", serverUserId: "1", serverToken: "fixture-token",
    agentModel, agentModelPool: [agentModel], contextStrategy: "codex", agentModelBindings: [{ model: agentModel, customBaseUrl: base, customApiKey: "fixture-agent" }],
    imageConnectionVersion: 1, imageModel: model, imageModelPool: [model], imageRatio: "1:1", imageResolution: "1K", imageQuality: "high", imageCount: 1,
    imageModelBindings: [{ model, customBaseUrl: base, customApiKey: "fixture-image", protocol: "xai-images", gateway: "direct" }],
    imageModelConfigs: [{ model, protocol: "xai-images", gateway: "direct", capabilities: { supportedQualities: ["auto", "high"] } }], glassTheme: "light-classic" };
  writeFileSync(join(configDir, "app-settings.json"), JSON.stringify(initialSettings)); report.initialSettings = summarySettings(initialSettings);
  const debugPort = await allocateDebugPort(); let devUrl = "";
  if (!executable) {
    const port = await allocateDebugPort(); devUrl = `http://127.0.0.1:${port}`;
    vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
    await waitForHttpServer(devUrl, { attempts: 150, intervalMs: 100, errorMessage: "Isolated Vite server failed to start" });
  }
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`];
  electron = spawn(executable || process.execPath, executable ? args : [join(root, "node_modules/electron/cli.js"), ...args, "electron-main.cjs"], {
    cwd: executable ? dirname(executable) : root, windowsHide: true, stdio: "ignore", env: { ...process.env, NAIMAGE_DEV_URL: devUrl,
      NAIMAGE_AIDEBUG: executable ? "0" : "1", NAIMAGE_AIDEBUG_MOCK_AGENT: "0", NAIMAGE_AIDEBUG_REAL_AGENT: "1", NAIMAGE_AIDEBUG_LIVE_IMAGE: "1",
      NAIMAGE_CONFIG_DIR: configDir, NAIMAGE_DEBUG_DIR: join(runDir, "runtime"), NAIMAGE_ELECTRON_LOG: join(runDir, "electron.log"),
      NAIMAGE_LOCAL_SERVER_ENTRY: join(runDir, "mock-service-owned-by-test.cjs") }
  });
  const target = await pollForDebugTarget({ port: debugPort, attempts: 250, intervalMs: 100, findTarget: targets => targets.find(item => item.type === "page" && !/agent-window\.html/.test(item.url)) });
  client = new BasicCdpClient(target.webSocketDebuggerUrl); await client.open(); await client.send("Runtime.enable"); await client.send("Page.enable");
  await waitForRuntimeExpression(client, "Boolean(window.naimageConfig?.saveSettings && document.querySelector('.project-agent-composer textarea'))", { evaluate: evaluateRuntime, timeoutMs: 60_000, intervalMs: 100 });
  await check("Renderer send freezes the configuration before the first Responses reply", async () => {
    await ev("(()=>{window['__agentWorkflowObservedProgress']=[];window.naimageAgent.onProgress(payload=>window['__agentWorkflowObservedProgress'].push({phase:payload.phase,tool:payload.tool,internalOnly:payload.internalOnly===true,summaryType:typeof payload.summary,summary:typeof payload.summary==='string'?payload.summary.slice(0,320):undefined,detailType:typeof payload.detail}));})()");
    await ev("(()=>{const t=document.querySelector('.project-agent-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'生成一张红色圆形图片');t.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await waitForRuntimeExpression(client, "Boolean(document.querySelector('.project-agent-send:not(:disabled)'))", { evaluate: evaluateRuntime, timeoutMs: 5000, intervalMs: 50 });
    const point = await ev("(()=>{const r=document.querySelector('.project-agent-send').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
    await waitFor(() => { if (report.serverErrors.length) throw new Error(report.serverErrors[0]); return report.modelPosts === 1; }, "the first Responses request", 30_000); await firstRequest;
    assert.ok(pendingFirstResponse && !pendingFirstResponse.writableEnded); assert.equal(report.imagePosts, 0);
    const frozen = report.modelContexts[0]; assert.ok(frozen.configuration);
    assert.deepEqual({ model: frozen.configuration.model, ratio: frozen.configuration.ratio, resolution: frozen.configuration.resolution, quality: frozen.configuration.quality, count: frozen.configuration.count },
      { model, ratio: "1:1", resolution: "1K", quality: "high", count: 1 });
    assert.equal(frozen.configuration.configs[0].protocol, "xai-images"); assert.equal(frozen.configuration.bindings[0].gateway, "direct");
    assert.deepEqual(frozen.configuration.configs[0].capabilities.supportedQualities, ["auto", "high"]); assert.deepEqual(frozen.modelEnum, [model]);
    assert.doesNotMatch(JSON.stringify(frozen.configuration), /fixture-agent|fixture-image|fixture-token|fixture-session|apiKey|baseUrl/i);
    await screenshot("frozen-before-live-settings-change");
  });
  await check("Actual preload settings save changes live policy while the model response is paused", async () => {
    report.settingsSave = await ev(`(async()=>{const loaded=await window.naimageConfig.loadSettings();if(!loaded.ok)throw new Error('settings load failed');const current=loaded.settings;
      const saved=await window.naimageConfig.saveSettings({...current,imageRatio:'16:9',imageResolution:'2K',imageQuality:'medium',imageCount:3,
        imageModelBindings:current.imageModelBindings.map(item=>({...item,protocol:'openai-images',gateway:'newapi'})),
        imageModelConfigs:current.imageModelConfigs.map(item=>({...item,protocol:'openai-images',gateway:'newapi',capabilities:{...item.capabilities,supportedQualities:['auto','medium']}}))});
      const reloaded=await window.naimageConfig.loadSettings();return {ok:saved.ok,loaded:reloaded.ok,ratio:reloaded.settings.imageRatio,resolution:reloaded.settings.imageResolution,quality:reloaded.settings.imageQuality,count:reloaded.settings.imageCount};})()`);
    assert.deepEqual(report.settingsSave, { ok: true, loaded: true, ratio: "16:9", resolution: "2K", quality: "medium", count: 3 });
    report.savedLiveSettings = summarySettings(JSON.parse(readFileSync(join(configDir, "app-settings.json"), "utf8")));
    assert.equal(report.savedLiveSettings.config.protocol, "openai-images"); assert.equal(report.savedLiveSettings.binding.gateway, "newapi");
    assert.deepEqual(report.savedLiveSettings.config.supportedQualities, ["auto", "medium"]);
    assert.equal(report.modelPosts, 1); assert.equal(report.imagePosts, 0);
    releaseFirstResponse();
  });
  await check("Real Main and unified service send the frozen native xAI request exactly once", async () => {
    await waitForRuntimeExpression(client, `document.querySelector('.project-agent-panel')?.textContent.includes(${JSON.stringify(doneText)})`, { evaluate: evaluateRuntime, timeoutMs: 60_000, intervalMs: 100 });
    assert.equal(report.serverErrors.length, 0); assert.equal(report.modelPosts, 3); assert.equal(report.imagePosts, 1);
    assert.deepEqual(report.wire, [{ model, n: 1, aspectRatio: "1:1", resolution: "1k", quality: "high", responseFormat: "b64_json", size: null }]);
    for (const context of report.modelContexts) {
      assert.equal(context.configuration.quality, "high"); assert.equal(context.configuration.ratio, "1:1"); assert.equal(context.configuration.resolution, "1K"); assert.equal(context.configuration.count, 1);
      assert.equal(context.configuration.configs[0].protocol, "xai-images"); assert.deepEqual(context.modelEnum, [model]);
    }
    assert.deepEqual(report.modelContexts.map(context => context.inputImages), [0, 0, 1]);
  });
  await check("A decodable managed PNG and canvas result persist to the actual project session", async () => {
    assert.ok(existsSync(reviewPath)); const bytes = readFileSync(reviewPath), metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "png"); assert.equal(metadata.width, 1024); assert.equal(metadata.height, 1024); assert.equal(sha256(bytes), sha256(pngBytes));
    await waitFor(() => {
      const session = JSON.parse(readFileSync(join(projectDir, "session.json"), "utf8"));
      return session.nodes?.some(node => node.assets?.some(asset => asset.path === reviewPath));
    }, "the actual persisted generated node");
    const persisted = singlePersistedResult();
    assert.equal(persisted.ratio, "1:1"); assert.equal(persisted.resolution, "1K");
    report.output = { relativePath: relative(projectDir, reviewPath).replaceAll("\\", "/"), sha256: sha256(bytes), width: metadata.width, height: metadata.height,
      ...persisted };
    report.visible = await ev("(()=>{const nodes=[...document.querySelectorAll('.flow-node')];const images=nodes.flatMap(node=>[...node.querySelectorAll('img')]);return{nodes:nodes.length,decodedImages:images.filter(image=>image.complete&&image.naturalWidth>0).length,done:document.querySelector('.project-agent-panel')?.textContent.includes('本地冻结配置验证完成。')}})()");
    assert.equal(report.visible.nodes, 1); assert.ok(report.visible.decodedImages >= 1); assert.equal(report.visible.done, true);
    await waitFor(async () => {
      const status = await ev("window.naimageAgent.runStatus({projectId:'workflow-main'})");
      if (!status?.ok || status.runs.length) return false;
      report.completedRunStatus = status;
      const saved = JSON.parse(readFileSync(join(projectDir, "session.json"), "utf8"));
      const conversation = saved.conversations?.find(item => item.id === saved.activeConversationId);
      const completed = messages => messages?.some(message => message.content === doneText && message.status === "done") && !messages.some(message => message.status === "running");
      if (!completed(saved.messages) || !completed(conversation?.messages)) return false;
      report.completionPersisted = { sessionRevision: saved.sessionRevision, messageCount: saved.messages.length, conversationMessageCount: conversation.messages.length,
        finalMessage: doneText, runningMessages: 0, malformedProgress: saved.messages.filter(message => message.content === "[object Object]").map(message => ({ id: message.id, meta: message.meta })) };
      return true;
    }, "the completed run and final assistant text to reach the actual saved session before reload");
    report.observedProgress = await ev("window['__agentWorkflowObservedProgress']");
    assert.equal(report.completionPersisted.malformedProgress.length, 0, "Internal protocol diagnostics never become malformed user timeline entries");
    await screenshot("frozen-request-result");
  });
  await check("Actual page reload restores one node, one asset and one output without another request", async () => {
    await ev("window['__agentWorkflowReloadPending']=true");
    await client.send("Page.reload");
    await waitFor(() => ev("!window['__agentWorkflowReloadPending'] && document.readyState==='complete' && Boolean(document.querySelector('.project-agent-composer textarea')) && [...document.querySelectorAll('.flow-node img')].some(image=>image.complete&&image.naturalWidth>0) && document.querySelector('.project-agent-panel')?.textContent.includes('本地冻结配置验证完成。')").catch(() => false), "the saved generated image and conversation after an actual page reload", 60_000);
    report.afterReload = singlePersistedResult();
    assert.deepEqual(report.afterReload, Object.fromEntries(Object.keys(report.afterReload).map(key => [key, report.output[key]])), "Reload preserves the saved asset and occurrence identity");
    report.visibleAfterReload = await ev("(()=>{const nodes=[...document.querySelectorAll('.flow-node')];const images=nodes.flatMap(node=>[...node.querySelectorAll('img')]);return{nodes:nodes.length,decodedImages:images.filter(image=>image.complete&&image.naturalWidth>0).length}})()");
    assert.equal(report.visibleAfterReload.nodes, 1); assert.ok(report.visibleAfterReload.decodedImages >= 1);
    assert.equal(report.imagePosts, 1); assert.equal(report.modelPosts, 3); assert.equal(report.serverErrors.length, 0);
    await screenshot("frozen-request-result-reloaded");
  });
  await stop(); assert.equal(report.shutdown.normalExit, true, "The isolated application exits normally after saving the result");
  report.afterNormalExit = singlePersistedResult(); assert.deepEqual(report.afterNormalExit, report.afterReload, "Normal shutdown preserves the unique result");
  if (!executable) assert.deepEqual(Object.fromEntries(sourceFiles.map(file => [file, sha256(readFileSync(join(root, file)))])), localSourceHashes, "Backend source stayed unchanged during this real Main test");
  assert.equal(report.imagePosts, 1); assert.equal(report.modelPosts, 3); report.ok = true;
} catch (error) {
  report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (client) {
    report.observedProgress ||= await ev("window['__agentWorkflowObservedProgress']").catch(() => null);
    report.failureState = await ev("(()=>({url:location.href,readyState:document.readyState,configBridge:typeof window.naimageConfig,saveSettings:typeof window.naimageConfig?.saveSettings,composerCount:document.querySelectorAll('.project-agent-composer').length,textareaCount:document.querySelectorAll('.project-agent-composer textarea').length,allTextareas:document.querySelectorAll('textarea').length,sendCount:document.querySelectorAll('.project-agent-send').length}))()").catch(diagnosticError => ({ error: diagnosticError.message }));
    await screenshot("failure").catch(() => {});
  }
} finally {
  releaseFirstResponse(); await stop(); await forceKillProcessTree(vite?.pid);
  server.closeAllConnections(); if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
  checkpoint(); console.log(JSON.stringify({ ok: report.ok, packaged: report.packaged, checks: report.checks.length, modelPosts: report.modelPosts, imagePosts: report.imagePosts,
    error: report.error?.message, report: join(runDir, "report.json") }));
}
