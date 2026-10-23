"use strict";

// Exercise actual Electron Main owners and the ordinary transports. Only two
// loopback HTTP fixtures and a fake ComfyUI server are allowed to receive data.
// There is no aidebug backend, transport success shim, account or real model.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const { createHash } = require("node:crypto");
const { app, dialog } = require("electron");
const sharp = require("sharp");
const { createMockServer } = require("./comfyui-executor-selftest.cjs");
const { createComfyUiConnectionProfileService } = require("../desktop/comfyui-connection-service.cjs");
const { imageConfigSnapshot } = require("../runtime/image-config-snapshot.mjs");

const runDir = path.resolve(__dirname, "..", ".diagnostics", "electron", `agent-offline-main-${Date.now()}`);
const configDir = path.join(runDir, "config"), projectDir = path.join(runDir, "project"), projectId = "offline-main-project";
for (const folder of [configDir, projectDir, path.join(projectDir, "assets"), path.join(runDir, "user-data")]) fs.mkdirSync(folder, { recursive: true });
const project = { id: projectId, name: "Offline Main fixture", path: projectDir, sessionPath: path.join(projectDir, "session.json"), external: true };
fs.writeFileSync(path.join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: projectId, projects: [project] }));
const settingsFile = path.join(configDir, "app-settings.json");
fs.writeFileSync(settingsFile, JSON.stringify({ accessMode: "account", accountBaseUrl: "http://127.0.0.1:9", serverUrl: "http://127.0.0.1:9", agentModel: "fixture-cloud", serverSessionCookie: "", serverToken: "", serverUserId: "", selectedAccountTokenId: "", networkProxyUrl: "" }));
process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
process.env.NAIMAGE_CONFIG_DIR = configDir;
process.env.NAIMAGE_DEBUG_DIR = path.join(runDir, "runtime");
delete process.env.NAIMAGE_AIDEBUG;
delete process.env.NAIMAGE_AIDEBUG_MOCK_AGENT;
app.commandLine.appendSwitch("user-data-dir", path.join(runDir, "user-data"));

const externalAttempts = [], networkRequests = [], results = [], skipped = [], liveBindings = new Set();
const loopback = value => { const host = String(value || "localhost").replace(/^\[|\]$/g, "").toLowerCase(); return host === "localhost" || host === "::1" || /^127\./.test(host); };
const nativeHttpRequest = http.request, nativeHttpsRequest = https.request, nativeLookup = dns.lookup, nativePromiseLookup = dns.promises.lookup;
function guardedRequest(original, args) {
  const target = args[0], host = typeof target === "string" || target instanceof URL ? new URL(target).hostname : target.hostname || target.host || "localhost";
  if (!loopback(host)) { externalAttempts.push({ boundary: "http", host: "redacted-nonloopback" }); throw Object.assign(new Error("The fixture forbids external network."), { code: "FIXTURE_EXTERNAL_NETWORK_FORBIDDEN" }); }
  networkRequests.push({ method: args[0]?.method || "GET", host: String(host) }); return original.apply(this, args);
}
http.request = function(...args) { return guardedRequest.call(this, nativeHttpRequest, args); };
https.request = function(...args) { return guardedRequest.call(this, nativeHttpsRequest, args); };
dns.lookup = function(host, ...args) { if (!loopback(host)) { externalAttempts.push({ boundary: "dns", host: "redacted-nonloopback" }); const callback = args.find(value => typeof value === "function"); process.nextTick(() => callback(Object.assign(new Error("External DNS is forbidden by the fixture."), { code: "FIXTURE_EXTERNAL_NETWORK_FORBIDDEN" }))); return; } return nativeLookup.call(this, host, ...args); };
dns.promises.lookup = async function(host, ...args) { if (!loopback(host)) { externalAttempts.push({ boundary: "dns", host: "redacted-nonloopback" }); throw Object.assign(new Error("External DNS is forbidden by the fixture."), { code: "FIXTURE_EXTERNAL_NETWORK_FORBIDDEN" }); } return nativePromiseLookup.call(this, host, ...args); };

// These profiles are never contacted. A regression is contained by the
// deny-only watcher above, and fails the test instead of reaching a real host.
const connections = createComfyUiConnectionProfileService({ configPath: path.join(configDir, "comfyui-connections.json") });
const remote = connections.create({ id: "offline-denied-remote", label: "Denied fake remote", networkScope: "remote", baseUrl: "https://comfy-denied.invalid", credentialRef: { mode: "none" } });
const lan = connections.create({ id: "offline-denied-lan", label: "Denied fake LAN", networkScope: "lan", baseUrl: "http://192.168.52.9:8188", credentialRef: { mode: "none" } });
const owner = require("../electron-main.cjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const readyOnly = process.argv.includes("--ready-only");
const requiredExports = ["listAgentModels", "resolveVideoTaskCredentials", "requestVideoTaskJson", "fetchVideoTaskBinary", "imageBufferFromRemoteUrl"];
const picks = [];
dialog.showOpenDialog = async () => { const file = picks.shift(); assert(file, "A native file choice must be explicitly queued by the fixture."); return { canceled: false, filePaths: [file] }; };
dialog.showMessageBox = async () => ({ response: 1 });
const check = async (name, action) => { const started = Date.now(); await action(); results.push({ name, ok: true, durationMs: Date.now() - started }); if (process.argv.includes("--verbose")) process.stdout.write(`PASS ${name}\n`); };
const blocked = async (action, expected = "AGENT_OFFLINE_BLOCKED") => { const before = { local: localRequests.length, cloud: cloudRequests.length, external: externalAttempts.length, http: networkRequests.length }; await assert.rejects(async () => action(), error => { assert.equal(error.code, expected, error.message); return true; }); assert.deepEqual({ local: localRequests.length, cloud: cloudRequests.length, external: externalAttempts.length, http: networkRequests.length }, before, "A denied action must stop before DNS or HTTP."); };
const localRequests = [], cloudRequests = []; let localBehavior = "text", cloudServer, localServer, comfy, settings, localA, localB, localBinding, cloudBinding, runtimeGeneratedAsset;
async function fixtureServer(requests, local) {
  const server = http.createServer((request, response) => {
    let data = ""; request.on("data", chunk => { data += chunk; }); request.on("end", () => {
      let body; try { body = JSON.parse(data); } catch {}
      requests.push({ method: request.method, path: request.url, model: body?.model, authorization: !!request.headers.authorization, cookie: !!request.headers.cookie, body });
      if (!local) { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, fixture: "ordinary-main-transport" })); return; }
      assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/chat/completions");
      if (localBehavior === "disconnect") return request.socket.destroy();
      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        const first = JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "local " }, finish_reason: null }] }), second = JSON.stringify({ choices: [{ index: 0, delta: { content: "stream" }, finish_reason: "stop" }] });
        response.write(`data: ${first}\n\n`); response.end(`data: ${second}\n\ndata: [DONE]\n\n`); return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `local:${body.model}` } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return server;
}
async function importLocal(label, modelId, baseUrl, capabilities = {}) {
  const file = path.join(runDir, `${label}.json`); fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, label, kind: "local-openai-compatible", modelId, baseUrl, capabilities: { tools: true, vision: false, contextWindowTokens: 8192, maxOutputTokens: 512, ...capabilities } })); picks.push(file);
  const receipt = await owner.agentProviderService.importProfile({}); assert.equal(receipt.ok, true, receipt.error); assert.equal(JSON.stringify(receipt).includes(baseUrl), false); return receipt.profile;
}
async function select(profileId, strictOffline) { const receipt = await owner.agentProviderService.select({ projectId, profileId, strictOffline }); assert.equal(receipt.ok, true, receipt.error); return receipt; }
async function bind(runId, incoming = settings, context = {}) { const receipt = await owner.bindAgentExecution(incoming, { projectId, runId, ...context }); liveBindings.add(receipt.bindingId); return receipt; }
async function release(binding) { if (!binding) return; await owner.agentProviderService.releaseBinding(binding.bindingId); liveBindings.delete(binding.bindingId); }
const chat = (binding, extra = {}) => owner.serverChatCompletion({ agentBindingId: binding.bindingId, model: binding.settings.agentModel, messages: [{ role: "user", content: "fixture only" }], max_tokens: 128, stream: false, ...extra });
function comfyPayload(connection, name) { const template = owner.comfyUiTemplateService.list().templates.find(item => item.id === "stock-generate"); return { provider: "comfyui", projectId, conversationId: "offline-conversation", runId: name, operationId: name, requestIndex: 1, prompt: "fake loopback only", comfyui: owner.comfyUiTemplateService.resolve({ ...connection, templateId: template.id, templateHash: template.templateHash, checkpoint: "fixture.safetensors", width: 64, height: 96, seed: 123, steps: 12, cfg: 6.5, sampler: "euler", scheduler: "normal", denoise: 1 }) }; }
const taskScope = { version: 2, origin: "chat", scopeType: "none", snapshotHash: "offline-main-frozen-scope", sourceNodeIds: [], sourceAssets: [], referenceAssets: [], imageConfig: { model: "fixture-cloud-image", models: ["fixture-cloud-image"], ratio: "1:1" } };
const taskFile = path.join(projectDir, ".naimage", "agent", "tasks.json");
function admitTask(name) {
  const context = { projectId, conversationId: "offline-conversation", runId: `${name}-run` };
  context.taskScope = { ...taskScope, projectKnowledge: owner.projectKnowledgeService.freezeForTask(context), creation: owner.creationService.requirementRefForTask({ ...context, prompt: "fixture task only" }) };
  const admitted = owner.agentTaskService.admit({ ...context, submissionId: name, prompt: "fixture task only" }, "offline-main-owner");
  context.taskId = admitted.task.taskId; owner.agentTaskService.claimRun(context, "offline-main-owner"); return context;
}
function continueTask(context, questionId) {
  const session = JSON.parse(fs.readFileSync(project.sessionPath, "utf8"));
  session.pendingAgentExecution = { ...context, requestId: questionId, kind: "clarify", question: "fixture question", options: [{ id: "continue", label: "Continue" }] };
  fs.writeFileSync(project.sessionPath, JSON.stringify(session));
  owner.agentTaskService.settle({ ...context, outcome: "waiting" }, "offline-main-owner");
  const waiting = owner.agentTaskService.get(context).task;
  const answer = owner.agentTaskService.claimAnswer({ ...context, expectedVersion: waiting.version, questionId, optionId: "continue" }, "offline-main-owner");
  const resumed = { ...context, runId: answer.runId };
  owner.agentTaskService.admit(resumed, "offline-main-owner"); owner.agentTaskService.claimRun(resumed, "offline-main-owner"); return resumed;
}
function settleTask(context) { owner.agentTaskService.settle({ ...context, outcome: "completed" }, "offline-main-owner"); const session = JSON.parse(fs.readFileSync(project.sessionPath, "utf8")); delete session.pendingAgentExecution; fs.writeFileSync(project.sessionPath, JSON.stringify(session)); }
const storedTask = context => JSON.parse(fs.readFileSync(taskFile, "utf8")).tasks.find(task => task.taskId === context.taskId);
async function main() {
  await app.whenReady();
  if (!readyOnly) for (const name of requiredExports) assert.equal(typeof owner[name], "function", `Main selftest export required: ${name}`);
  if (!readyOnly) assert.equal(typeof owner.agentTaskService?.admit, "function", "Main task owner selftest export required");
  if (!readyOnly) assert.equal(typeof owner.getAgentRuntime, "function", "Main single runtime selftest export required");
  cloudServer = await fixtureServer(cloudRequests, false); localServer = await fixtureServer(localRequests, true);
  const cloudBase = `http://127.0.0.1:${cloudServer.address().port}`, localBase = `http://127.0.0.1:${localServer.address().port}`;
  settings = owner.migrateSettings({ accessMode: "account", accountBaseUrl: cloudBase, serverUrl: cloudBase, relayBaseUrl: cloudBase, updateBaseUrl: cloudBase, agentModel: "fixture-cloud", imageModel: "fixture-cloud-image", videoModel: "fixture-cloud-video", serverSessionCookie: "", serverToken: "", serverUserId: "", selectedAccountTokenId: "", networkProxyUrl: "" });
  fs.writeFileSync(settingsFile, JSON.stringify(settings)); fs.writeFileSync(project.sessionPath, JSON.stringify({ ...owner.defaultSession, conversations: [{ id: "offline-conversation", messages: [] }], nodes: [] }));
  const png = await sharp({ create: { width: 64, height: 96, channels: 4, background: "#336699" } }).png().toBuffer();
  comfy = await createMockServer({ output: { "9": { images: [{ filename: "offline-main.png", subfolder: "fixture", type: "output" }] } } }, png);
  await check("Main uses ordinary cloud transport before offline mode", async () => { const response = await owner.newApiTransportFetch(`${cloudBase}/transport-proof`, { method: "GET", maxResponseBytes: 1024 }); assert.equal(response.ok, true); await response.text(); assert.equal(cloudRequests.length, 1); assert.equal(cloudRequests[0].path, "/transport-proof"); cloudRequests.length = 0; });
  await check("native local profiles are private and Main binding needs no cloud account", async () => {
    cloudBinding = await bind("frozen-cloud"); localA = await importLocal("local-a", "gpt-6.1-sol", localBase); localB = await importLocal("local-b", "fixture-local-b", localBase);
    await select(localA.profileId, true); localBinding = await bind("local-no-account"); assert.equal(localBinding.settings.agentModel, localA.modelId); assert.equal(localBinding.settings.compactModel, localA.modelId); assert.equal(localBinding.settings.agentExecution.providerKind, "local-openai-compatible");
    const result = await chat(localBinding); assert.equal(result.choices[0].message.content, `local:${localA.modelId}`); assert.equal(localRequests.length, 1); assert.equal(localRequests[0].path, "/v1/chat/completions"); assert.equal(localRequests[0].authorization, false); assert.equal(localRequests[0].cookie, false); assert.equal(cloudRequests.length, 0);
    const publicSnapshot = localBinding.settings.agentExecution; assert(!JSON.stringify(publicSnapshot).includes(localBase)); assert.equal(publicSnapshot.strictOffline, true);
  });
  await check("strict mode blocks frozen cloud chat, raw cloud transport and image owner", async () => { await blocked(() => chat(cloudBinding)); await blocked(() => owner.newApiTransportFetch(`${cloudBase}/forbidden-cloud`, { method: "GET" })); await blocked(() => owner.callNewApiImageWithSession(settings, { projectId, runId: "strict-cloud-image", operationId: "strict-cloud-image", model: "fixture-cloud-image", prompt: "never submit", count: 1 })); assert.equal(owner.imageOperationJournal.list(projectId).length, 0); });
  await check("local Main request cannot omit binding or replace the frozen model", async () => { await blocked(() => owner.serverChatCompletion({ model: localA.modelId, messages: [{ role: "user", content: "no binding" }] }), "AGENT_PROVIDER_BINDING_MISSING"); await blocked(() => chat(localBinding, { model: "fixture-cloud" }), "AGENT_MODEL_CONFLICT"); });
  await check("strict mode blocks LAN and remote ComfyUI before journal or network", async () => { for (const connection of [remote, lan]) await blocked(() => owner.callNewApiImageWithSession(settings, comfyPayload({ connectionId: connection.id }, `strict-${connection.networkScope}`))); assert.equal(owner.imageOperationJournal.list(projectId).length, 0); assert.equal(comfy.posts.length, 0); });
  await check("strict mode permits a pinned loopback ComfyUI task and original journal", async () => { const result = await owner.callNewApiImageWithSession(settings, comfyPayload({ baseUrl: comfy.baseUrl }, "strict-local-comfy")); assert.equal(result.images.length, 1); assert.equal(comfy.posts.length, 1); assert.equal(comfy.views.length, 1); const record = owner.imageOperationJournal.find(projectId, "strict-local-comfy"); assert(record); assert.equal(record.comfyui.networkScope, "local"); assert.equal(record.taskId, "prompt-1"); assert.equal(record.comfyui.baseUrl, undefined); });
  await check("strict mode blocks new artifact network downloads at Main store admission", async () => { const bytes = Buffer.from("fake GGUF not installed"), artifact = { id: "strict-main-artifact", kind: "model", modelType: "llm", format: "file", filename: "fixture.gguf", bytes: bytes.length, expandedBytes: bytes.length, sha256: hash(bytes), url: `https://127.0.0.1:${cloudServer.address().port}/artifact.gguf`, license: { id: "MIT fixture", url: "https://example.com/LICENSE" }, components: [{ name: "fixture", version: "1", license: { id: "MIT fixture", url: "https://example.com/LICENSE" } }], dependencies: [], destination: "models" }; await blocked(() => owner.managedArtifactStore.ensureArtifact(artifact, { jobId: "strict-main-artifact" }), "MANAGED_ARTIFACT_OFFLINE_BLOCKED"); });
  await check("profile selection changes affect the next run while old binding stays local", async () => { await select(localB.profileId, false); const result = await chat(localBinding); assert.equal(result.model, localA.modelId); assert.equal(localRequests.at(-1).model, localA.modelId); const next = await bind("second-profile"); assert.equal(next.settings.agentModel, localB.modelId); assert.equal((await chat(next)).model, localB.modelId); await release(next); assert.equal(cloudRequests.length, 0); });
  if (owner.agentTaskService) {
    await check("Main task owner persists redacted provider before any local model request", async () => {
      const context = admitTask("main-provider-receipt"), before = networkRequests.length;
      const bound = await bind(context.runId, { ...settings, agentExecution: cloudBinding.settings.agentExecution }, context), receipt = storedTask(context).agentExecution;
      assert.equal(networkRequests.length, before); assert.equal(receipt.profileId, localB.profileId); assert.equal(receipt.modelId, localB.modelId);
      assert.equal(receipt.bindingId, undefined); assert.equal(JSON.stringify(receipt).includes(localBase), false); assert.equal(JSON.stringify(receipt).includes("credential"), false);
      assert.equal(owner.agentTaskService.get(context).task.agentExecution, undefined); assert.equal(bound.settings.agentExecution.profileId, localB.profileId, "Renderer settings cannot replace the Main selection");
      assert.equal((await chat(bound)).model, localB.modelId); await release(bound);
      let resumed = continueTask(context, "receipt-question"); const resumedBinding = await bind(resumed.runId, settings, resumed);
      assert.notEqual(resumedBinding.bindingId, bound.bindingId); assert.deepEqual(storedTask(resumed).agentExecution, receipt); assert.equal((await chat(resumedBinding)).model, localB.modelId); await release(resumedBinding);
      resumed = continueTask(resumed, "drift-question"); await select(localA.profileId, false);
      await blocked(() => bind(resumed.runId, settings, resumed), "AGENT_PROVIDER_RECOVERY_CHANGED"); assert.deepEqual(storedTask(resumed).agentExecution, receipt);
      await select(localB.profileId, false); const restored = await bind(resumed.runId, settings, resumed); await release(restored); settleTask(resumed);
    });
    await check("Main rejects legacy local continuation without a provider receipt before network", async () => {
      const context = continueTask(admitTask("legacy-local-without-receipt"), "legacy-question");
      assert.equal(storedTask(context).agentExecution, undefined);
      await blocked(() => bind(context.runId, settings, context), "AGENT_PROVIDER_RECOVERY_MISSING"); settleTask(context);
    });
    await check("Main provider persistence failure rejects before network and releases its binding", async () => {
      const context = admitTask("provider-persistence-failure"), before = networkRequests.length; await select(localA.profileId, true);
      fs.mkdirSync(`${taskFile}.tmp`);
      try { await assert.rejects(() => bind(context.runId, settings, context), error => ["EISDIR", "EACCES", "EPERM"].includes(error.code)); }
      finally { fs.rmdirSync(`${taskFile}.tmp`); }
      assert.equal(networkRequests.length, before); assert.equal(storedTask(context).agentExecution, undefined);
      await select(localB.profileId, false); settleTask(context);
    });
  }
  if (typeof owner.getAgentRuntime === "function") await check("actual Main Runtime image_gen submits local ComfyUI and repeats by original journal", async () => {
    const resolved = comfyPayload({ baseUrl: comfy.baseUrl }, "runtime-configuration").comfyui;
    const comfyui = Object.fromEntries(["connectionId", "templateId", "templateHash", "checkpoint", "seed", "width", "height", "steps", "cfg", "sampler", "scheduler", "denoise"].map(key => [key, resolved[key]]));
    await select(localA.profileId, true); const bound = await bind("actual-runtime-image", { ...settings, imageProvider: "comfyui", comfyui });
    const context = { projectId, conversationId: "offline-conversation", runId: "actual-runtime-image", toolRunId: "actual-runtime-image-tool", operationId: "actual-runtime-image-tool", settings: bound.settings,
      nodes: [], selectedNodeId: "", selectedNodeIds: [], taskScope: { ...taskScope, imageConfig: imageConfigSnapshot(bound.settings) } };
    const runtime = owner.getAgentRuntime(), before = comfy.posts.length, args = { operation: "generate", prompt: "fake runtime generation only", count: 1 };
    const result = await runtime.runTool("image_gen", args, context);
    assert.equal(result.envelope.ok, true); assert.equal(comfy.posts.length, before + 1);
    runtimeGeneratedAsset = result.actions.find(action => action.type === "workflow.node.create")?.node?.assets?.[0]; assert(runtimeGeneratedAsset);
    assert.deepEqual(fs.readFileSync(runtimeGeneratedAsset.path), png); assert.equal(runtimeGeneratedAsset.contentHash, hash(png));
    const record = owner.imageOperationJournal.find(projectId, context.operationId, 1); assert.equal(record.state, "saved"); assert.equal(record.comfyui.connectionId, comfyui.connectionId); assert.equal(record.requestIndex, 1);
    const repeated = await runtime.runTool("image_gen", args, context); assert.equal(repeated.envelope.ok, true); assert.equal(comfy.posts.length, before + 1, "Repeat image tool uses the original saved operation");
    assert.equal(repeated.actions.find(action => action.type === "workflow.node.create")?.node?.assets?.[0]?.assetId, runtimeGeneratedAsset.assetId);
    assert.equal(cloudRequests.length, 0); await release(bound); await select(localB.profileId, false);
  });
  if (typeof owner.getAgentRuntime === "function") await check("actual Main Runtime inpaint binds managed mask and preserves every protected pixel", async () => {
    const source = runtimeGeneratedAsset, sourceNode = { id: "runtime-source", type: "image", assets: [source], outputs: 1, imageState: "done" };
    const session = JSON.parse(fs.readFileSync(project.sessionPath, "utf8")); session.nodes = [sourceNode]; fs.writeFileSync(project.sessionPath, JSON.stringify(session));
    const identity = value => Object.fromEntries(["assetId", "occurrenceId", "contentHash"].map(key => [key, value[key]])), target = identity(source);
    const pixels = Buffer.alloc(64 * 96 * 4, 255); for (let pixel = 0; pixel < 64 * 48; pixel++) pixels[pixel * 4 + 3] = 0;
    const maskPng = await sharp(pixels, { raw: { width: 64, height: 96, channels: 4 } }).png().toBuffer();
    const saved = await owner.creationMaskService.save({ expectedProjectId: projectId, conversationId: "offline-conversation", target, dataUrl: `data:image/png;base64,${maskPng.toString("base64")}` });
    const mask = { ...saved.mask, revision: saved.revision }, material = owner.creationMaskService.resolve({ expectedProjectId: projectId, conversationId: "offline-conversation", target, mask });
    const sourceBefore = fs.readFileSync(source.path), maskBefore = fs.readFileSync(material.path), editedPng = await sharp({ create: { width: 64, height: 96, channels: 4, background: "#16bb68" } }).png().toBuffer();
    const template = owner.comfyUiTemplateService.list().templates.find(item => item.id === "stock-inpaint"), resolved = comfyPayload({ baseUrl: comfy.baseUrl }, "runtime-configuration").comfyui;
    const comfyui = { connectionId: resolved.connectionId, templateId: template.id, templateHash: template.templateHash, checkpoint: "fixture.safetensors", width: 64, height: 96, seed: 123, denoise: 1 };
    await select(localA.profileId, true); const bound = await bind("actual-runtime-inpaint", { ...settings, imageProvider: "comfyui", comfyui });
    const context = { projectId, conversationId: "offline-conversation", runId: "actual-runtime-inpaint", toolRunId: "actual-runtime-inpaint-tool", operationId: "actual-runtime-inpaint-tool", settings: bound.settings,
      nodes: [sourceNode], selectedNodeId: sourceNode.id, selectedNodeIds: [sourceNode.id], taskScope: { ...taskScope, scopeType: "single", sourceNodeIds: [sourceNode.id],
        sourceAssets: [{ ...source, nodeId: sourceNode.id, assetIndex: 0, role: "source" }], maskAssets: [{ ...material, target }], imageConfig: imageConfigSnapshot(bound.settings) } };
    const before = { posts: comfy.posts.length, uploads: comfy.uploads.length }, args = { operation: "edit", prompt: "fake runtime inpaint only", count: 1 };
    comfy.config.uploadImages = [sourceBefore, maskBefore]; comfy.config.imageBytes = editedPng;
    try {
      const runtime = owner.getAgentRuntime(), result = await runtime.runTool("image_gen", args, context); assert.equal(result.envelope.ok, true);
      assert.equal(comfy.posts.length, before.posts + 1); assert.equal(comfy.uploads.length, before.uploads + 2);
      const output = result.actions.find(action => action.type === "workflow.node.create")?.node?.assets?.[0]; assert(output); assert.notEqual(output.assetId, source.assetId);
      const record = owner.imageOperationJournal.find(projectId, context.operationId, 1); assert.equal(record.state, "saved"); assert.equal(record.comfyui.capability, "inpaint");
      assert.deepEqual(record.comfyui.inputs.map(input => input.role), ["sourceImage", "maskImage"]); assert.deepEqual(record.comfyui.maskBindings, { sourceHash: target.contentHash, maskHash: mask.contentHash, width: 64, height: 96, revision: saved.revision });
      assert.equal(output.localProcessing.maskComposite.verified, true);
      const outputPixels = await sharp(fs.readFileSync(output.path)).ensureAlpha().raw().toBuffer(), originalPixels = await sharp(sourceBefore).ensureAlpha().raw().toBuffer(), changedPixels = await sharp(editedPng).ensureAlpha().raw().toBuffer();
      assert.deepEqual(outputPixels.subarray(0, 64 * 48 * 4), changedPixels.subarray(0, 64 * 48 * 4)); assert.deepEqual(outputPixels.subarray(64 * 48 * 4), originalPixels.subarray(64 * 48 * 4));
      assert.deepEqual(fs.readFileSync(source.path), sourceBefore); assert.deepEqual(fs.readFileSync(material.path), maskBefore);
      const repeated = await runtime.runTool("image_gen", args, context); assert.equal(repeated.envelope.ok, true); assert.equal(comfy.posts.length, before.posts + 1); assert.equal(comfy.uploads.length, before.uploads + 2);
    } finally { delete comfy.config.imageBytes; delete comfy.config.uploadImages; await release(bound); await select(localB.profileId, false); }
  });
  await check("Main local streaming remains Chat Completions with no model-name routing", async () => { const events = [], result = await chat(localBinding, { stream: true, onStreamEvent: event => events.push(event) }); assert.equal(result.stream, true); assert.equal(events.map(event => event.choices[0].delta.content || "").join(""), "local stream"); assert.equal(localRequests.at(-1).path, "/v1/chat/completions"); assert.equal(cloudRequests.length, 0); });
  await check("local connection loss makes one attempt and never falls back to cloud", async () => { const before = localRequests.length; localBehavior = "disconnect"; await assert.rejects(chat(localBinding), error => error.code === "AGENT_PROVIDER_CONNECTION_FAILED" && error.unsafeToRetry === true); localBehavior = "text"; assert.equal(localRequests.length, before + 1); assert.equal(cloudRequests.length, 0); });
  for (const name of requiredExports) if (typeof owner[name] !== "function") { assert(readyOnly); skipped.push(name); }
  if (typeof owner.listAgentModels === "function") await check("Main model list uses local snapshot without any cloud discovery", async () => { const before = [localRequests.length, cloudRequests.length, networkRequests.length]; for (const provider of ["agent", "image", "video"]) { const listed = await owner.listAgentModels(provider, settings); assert.equal(listed.cacheSource, "local-profile"); assert.deepEqual(listed.models, provider === "agent" ? [localB.modelId] : []); } assert.deepEqual([localRequests.length, cloudRequests.length, networkRequests.length], before); });
  if (typeof owner.resolveVideoTaskCredentials === "function") await check("Main strict video credential resolution stops before account access", async () => { await blocked(() => owner.resolveVideoTaskCredentials({ model: "fixture-cloud-video" })); });
  if (typeof owner.requestVideoTaskJson === "function") await check("Main strict video JSON blocks create and poll requests", async () => { const credentials = { baseUrl: cloudBase, apiKey: "synthetic-never-sent" }; for (const method of ["POST", "GET"]) await blocked(() => owner.requestVideoTaskJson({ credentials, endpoint: "/v1/videos", method, body: method === "POST" ? { model: "fixture-cloud-video" } : undefined })); });
  if (typeof owner.fetchVideoTaskBinary === "function") await check("Main strict video download blocks both credential origin and public branch", async () => { const credentials = { baseUrl: cloudBase, apiKey: "synthetic-never-sent" }; for (const endpointOrUrl of [`${cloudBase}/video.mp4`, `${localBase}/public-video.mp4`]) await blocked(() => owner.fetchVideoTaskBinary({ credentials, endpointOrUrl })); });
  if (typeof owner.imageBufferFromRemoteUrl === "function") await check("Main strict image download blocks recovery/export result URLs", async () => { await blocked(() => owner.imageBufferFromRemoteUrl(`${cloudBase}/image.png`)); });
  await check("frozen strict binding keeps cloud and list gates after selecting cloud", async () => { await select("cloud", false); assert.equal(owner.agentProviderService.isStrictOffline(projectId), true); await blocked(() => owner.serverChatCompletion({ model: "fixture-cloud", messages: [{ role: "user", content: "never cloud" }] })); if (typeof owner.listAgentModels === "function") await blocked(() => owner.listAgentModels("agent", settings)); await blocked(() => bind("cloud-while-strict")); });
  await check("released binding never reconnects or silently creates a replacement", async () => { await release(localBinding); await blocked(() => chat(localBinding), "AGENT_PROVIDER_BINDING_MISSING"); await release(cloudBinding); assert.equal(owner.agentProviderService.isStrictOffline(projectId), false, "A failed receipt write must not leak a strict binding"); });
  assert.equal(externalAttempts.length, 0); assert.equal(cloudRequests.length, 0);
  const report = { ok: true, cases: results.length, results, skipped, readyOnly, cloudRequestsAfterStrict: cloudRequests.length, localChatPosts: localRequests.length, loopbackComfyPosts: comfy.posts.length, loopbackComfyViews: comfy.views.length, loopbackComfyUploads: comfy.uploads.length, externalAttempts: externalAttempts.length, realModelRequests: 0, aidebugBackendUsed: false };
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2)); process.stdout.write(JSON.stringify({ ...report, results: undefined, report: path.join(runDir, "report.json") }) + "\n");
}
async function cleanup() {
  await Promise.all([...liveBindings].map(bindingId => owner.agentProviderService.releaseBinding(bindingId)));
  await owner.agentProviderService.dispose(); await owner.managedLocalLlmService.dispose(); owner.managedArtifactStore.dispose?.();
  await comfy?.close();
  for (const server of [cloudServer, localServer]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  http.request = nativeHttpRequest; https.request = nativeHttpsRequest; dns.lookup = nativeLookup; dns.promises.lookup = nativePromiseLookup;
}
main().then(async () => { await cleanup(); app.exit(0); }).catch(async error => { fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify({ ok: false, cases: results.length, results, skipped, failure: String(error.stack || error), externalAttempts }, null, 2)); process.stderr.write(String(error.stack || error) + "\n"); try { await cleanup(); } finally { app.exit(1); } });
