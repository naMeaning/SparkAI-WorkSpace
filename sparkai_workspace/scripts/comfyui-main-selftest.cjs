"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { mkdirSync, writeFileSync, readFileSync, renameSync, symlinkSync, unlinkSync } = require("node:fs");
const sharp = require("sharp");
const { app, dialog } = require("electron");
const { spawn } = require("node:child_process");
const { createMockServer } = require("./comfyui-executor-selftest.cjs");
const { registerServerIpc } = require("../desktop/ipc/server-ipc.cjs");
const { stableHash } = require("../runtime/image-generation/comfyui-executor.cjs");
const { createComfyUiConnectionProfileService } = require("../desktop/comfyui-connection-service.cjs");
const { modelConnectionIdentity } = require("../desktop/model-catalog.cjs");

const runDir = process.env.NAIMAGE_COMFY_MAIN_RESUME_DIR || path.resolve(__dirname, "../.diagnostics/electron", `comfyui-main-${Date.now()}`);
const projectDir = path.join(runDir, "project"), configDir = path.join(runDir, "config"), projectId = "comfyui-main-fixture";
for (const directory of [projectDir, configDir, path.join(runDir, "user-data"), path.join(projectDir, "assets")]) mkdirSync(directory, { recursive: true });
const project = { id: projectId, name: "Local ComfyUI fixture", path: projectDir, sessionPath: path.join(projectDir, "session.json"), external: true };
writeFileSync(path.join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: projectId, projects: [project] }));
process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
process.env.NAIMAGE_CONFIG_DIR = configDir;
process.env.NAIMAGE_DEBUG_DIR = path.join(runDir, "runtime");
app.commandLine.appendSwitch("user-data-dir", path.join(runDir, process.env.NAIMAGE_COMFY_MAIN_RECOVERY_KEY ? "recovery-user-data" : "user-data"));
// Recovery deliberately shares the image journal with its still-running parent.
// The managed installer is unrelated to this fixture and keeps its exclusive
// process lock; give that subsystem a separate root in each recovery process.
if (process.env.NAIMAGE_COMFY_MAIN_RECOVERY_KEY) {
  const recoveryRoot = path.join(runDir, "recovery-managed", createHash("sha256").update(process.env.NAIMAGE_COMFY_MAIN_RECOVERY_KEY).digest("hex"));
  const storeModule = require("../desktop/managed-artifact-store.cjs");
  const runtimeModule = require("../desktop/comfyui-runtime-service.cjs");
  const createStore = storeModule.createManagedArtifactStore, createRuntime = runtimeModule.createComfyUiRuntimeService;
  storeModule.createManagedArtifactStore = options => createStore({ ...options, root: path.join(recoveryRoot, "artifacts") });
  runtimeModule.createComfyUiRuntimeService = options => createRuntime({ ...options, rootDir: path.join(recoveryRoot, "comfyui") });
}
process.on("uncaughtException", error => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
const owner = require("../electron-main.cjs");
const settings = { imageCount: 1, imageOutputFormat: "png" }, handlers = new Map(), results = [];
let png, posts = 0, views = 0, uploads = 0, restartProcesses = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

registerServerIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, migrateSettings: value => value, readJson: () => settings, defaultSettings: settings,
  getProjectById: id => id === projectId ? project : null, readProjectList: () => ({ activeProjectId: projectId, projects: [project] }), log() {}, emitAgentProgress() {}, removeOwnedDataUrlTemp() {},
  callNewApiImageWithSession: owner.callNewApiImageWithSession, deliverGeneratedImageResult: owner.deliverGeneratedImageResult,
  imageOperationJournal: owner.imageOperationJournal, comfyUiTemplateService: owner.comfyUiTemplateService, comfyUiMaskService: owner.comfyUiMaskService });
const generate = payload => handlers.get("naimage:server:generate-image")({ sender: { id: 1 } }, payload);

function payload(server, name, extra = {}) {
  const templateId = extra.templateId || "stock-generate";
  const template = owner.comfyUiTemplateService.list().templates.find(value => value.id === templateId);
  return { provider: "comfyui", projectId, conversationId: "conversation-fixture", runId: name, operationId: name, requestIndex: 1, prompt: "loopback fixture",
    comfyui: { templateId, templateHash: template.templateHash, baseUrl: server.baseUrl, checkpoint: "fixture.safetensors", width: 64, height: 96, seed: 123,
      steps: 12, cfg: 6.5, sampler: "euler", scheduler: "normal", denoise: 1 }, ...extra };
}
function resolved(request) { return { ...request, comfyui: owner.comfyUiTemplateService.resolve(request.comfyui) }; }
const identity = asset => ({ assetId: asset.assetId, occurrenceId: asset.occurrenceId, contentHash: asset.contentHash });
function typedPayload(server, name, capability, materials, extra = {}) {
  const request = payload(server, name, { templateId: `stock-${capability}`, ...extra }); delete request.templateId;
  Object.assign(request.comfyui, materials);
  if (capability === "cutout") for (const field of ["checkpoint", "seed", "width", "height", "steps", "cfg", "sampler", "scheduler", "denoise"]) delete request.comfyui[field];
  return request;
}
async function recoverInNewMain(key) {
  restartProcesses++;
  const child = spawn(process.execPath, [__filename], { windowsHide: true, env: { ...process.env, NAIMAGE_COMFY_MAIN_RESUME_DIR: runDir, NAIMAGE_COMFY_MAIN_RECOVERY_KEY: key }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, 0, output);
  return JSON.parse(readFileSync(path.join(runDir, `restart-${key}.json`), "utf8"));
}
async function assertProtectedHalf(bytes, original, edited) {
  const output = await sharp(bytes).ensureAlpha().raw().toBuffer(), source = await sharp(original).ensureAlpha().raw().toBuffer(), replacement = await sharp(edited).ensureAlpha().raw().toBuffer();
  const boundary = 64 * 48 * 4;
  assert.deepEqual(output.subarray(boundary), source.subarray(boundary), "every protected pixel equals the original source");
  assert.deepEqual(output.subarray(0, boundary), replacement.subarray(0, boundary), "the transparent processing region contains the returned edit");
}
async function fixture(config, fn) {
  const server = await createMockServer({ output: { "9": { images: [{ filename: "main-result.png", subfolder: "fixtures", type: "output" }] } }, ...config }, png);
  try { return await fn(server); } finally { posts += server.posts.length; views += server.views.length; uploads += server.uploads.length; await server.close(); }
}
async function test(name, fn) { await fn(); results.push({ name, ok: true }); }

async function main() {
  await app.whenReady();
  png = await sharp({ create: { width: 64, height: 96, channels: 4, background: "#447799" } }).png().toBuffer();
  const sourcePath = path.join(projectDir, "assets", "source.png"); writeFileSync(sourcePath, png);
  const source = { type: "file", path: sourcePath, assetId: "asset-source", occurrenceId: "occ-0123456789abcdef0123456789abcdef", contentHash: digest(png), canvasNodeId: "source", canvasAssetIndex: 0 };
  writeFileSync(project.sessionPath, JSON.stringify({ ...owner.defaultSession, conversations: [{ id: "conversation-fixture", messages: [] }, { id: "other-conversation", messages: [] }], sessionRevision: 7, nodes: [{ id: "source", type: "image", status: "done", imageState: "done", assets: [source], outputs: 1, x: 0, y: 0 }] }));
  await test("IPC uses Main journal and original-byte asset delivery", () => fixture({}, async server => {
    const request = payload(server, "comfy-main-unique");
    const result = await generate(request); assert.equal(result.ok, true, result.error); assert.equal(result.assets.length, 1); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 1);
    assert.equal(server.posts[0].prompt["3"].inputs.steps, 12); assert.equal(server.posts[0].prompt["3"].inputs.cfg, 6.5); assert.equal(server.posts[0].prompt["3"].inputs.sampler_name, "euler"); assert.equal(server.posts[0].prompt["3"].inputs.scheduler, "normal"); assert.equal(server.posts[0].prompt["3"].inputs.denoise, 1);
    const asset = result.assets[0]; assert.deepEqual(readFileSync(asset.path), png); assert.equal(asset.contentHash, digest(png)); assert.equal(asset.width, 64); assert.equal(asset.height, 96);
    assert.equal(path.relative(projectDir, asset.path).startsWith(".."), false); assert.equal(asset.generation.request.model, "fixture.safetensors");
    assert.equal(asset.generation.request.protocol, "comfyui"); assert.equal(asset.generation.request.seed, 123); assert.equal(asset.generation.request.quality, undefined);
    assert.equal(asset.generation.request.templateId, "stock-generate"); assert.equal(asset.generation.request.workflowHash.length, 64); assert.equal(asset.generation.response.seed, 123); assert.equal(asset.generation.response.size, "64x96");
    const item = owner.imageOperationJournal.find(projectId, request.operationId, 1); assert.equal(item.state, "saved"); assert.equal(item.taskId, "prompt-1"); assert.equal(item.comfyui.actualParams.seed, 123); assert.equal(item.comfyui.actualParams.steps, 12); assert.equal(item.comfyui.actualParams.cfg, 6.5); assert.equal(item.comfyui.actualParams.sampler, "euler"); assert.equal(item.comfyui.actualParams.scheduler, "normal"); assert.equal(item.comfyui.actualParams.denoise, 1); assert.equal(item.comfyui.workflowHash.length, 64); assert.equal(item.comfyui.outputNodeId, "9"); assert.equal(item.projectRevision, 7);
    assert.equal(item.comfyui.schemaVersion, 2); assert.equal(item.comfyui.policyVersion, owner.comfyUiTemplateService.list().templates.find(template => template.id === request.comfyui.templateId).policyVersion); assert.match(item.comfyui.capabilitiesHash, /^[a-f0-9]{64}$/);
    assert.ok(item.comfyui.connectionId); assert.match(item.comfyui.connectionHash, /^[a-f0-9]{64}$/); assert.equal(item.comfyui.baseUrl, undefined);
    assert.equal(JSON.stringify(item).includes(server.baseUrl), false); assert.equal(JSON.stringify(item).includes("credentialRef"), false);
    const repeated = await generate(request); assert.equal(repeated.ok, true, repeated.error); assert.deepEqual(repeated.assets, result.assets); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 1);
    assert.equal(repeated.size, "64x96"); assert.equal(owner.imageOperationJournal.list(projectId).find(row => row.key === item.key).providerState, "succeeded");
    const conflict = await generate({ ...request, prompt: "changed prompt" }); assert.equal(conflict.ok, false); assert.equal(conflict.errorCode, "COMFYUI_SUBMISSION_CONFLICT"); assert.equal(server.posts.length, 1);
    for (const [field, value] of [["sampler", "dpmpp_2m"], ["steps", 13], ["cfg", 7.5]]) {
      const samplingConflict = await generate({ ...request, comfyui: { ...request.comfyui, [field]: value } });
      assert.equal(samplingConflict.ok, false); assert.equal(samplingConflict.errorCode, "COMFYUI_SUBMISSION_CONFLICT"); assert.equal(server.posts.length, 1);
    }
  }));
  await test("raw workflows/inputs and template drift cannot bypass journal", () => fixture({}, async server => {
    for (const field of ["workflow", "inputs", "inputMappings", "baseUrl"]) {
      const result = await generate({ ...payload(server, `comfy-raw-${field}`), [field]: field === "baseUrl" ? server.baseUrl : [] }); assert.equal(result.ok, false); assert.equal(result.errorCode, "COMFYUI_REQUEST_INVALID");
    }
    const request = payload(server, "comfy-template-drift"); request.comfyui.templateHash = "0".repeat(64); const result = await generate(request); assert.equal(result.ok, false); assert.equal(result.errorCode, "COMFYUI_TEMPLATE_CHANGED"); assert.equal(server.posts.length, 0);
  }));
  await test("project image input is hashed, uploaded and frozen by Main", () => fixture({}, async server => {
    const request = payload(server, "comfy-img2img", { templateId: "stock-img2img", referenceImages: [source] }); delete request.templateId;
    const result = await generate(request); assert.equal(result.ok, true, result.error); assert.equal(server.uploads.length, 1); assert.equal(server.posts[0].prompt["10"].inputs.image, "task-inputs/uploaded.png");
    const item = owner.imageOperationJournal.find(projectId, request.operationId); assert.equal(item.sources[0].contentHash, digest(png)); assert.equal(item.comfyui.inputs[0].sha256, digest(png)); assert.equal(item.comfyui.actualParams.width, 64);
    assert.deepEqual(item.sourceNodeIds, ["source"]); assert.deepEqual(result.assets[0].generation.request.sourceHashes, [digest(png)]);
    assert.deepEqual(readFileSync(result.assets[0].path), png);
  }));
  await test("input content drift and paths outside project are refused before POST", () => fixture({}, async server => {
    const changed = payload(server, "comfy-input-hash", { templateId: "stock-img2img", referenceImages: [{ ...source, contentHash: "0".repeat(64) }] }); delete changed.templateId;
    const first = await generate(changed); assert.equal(first.errorCode, "COMFYUI_INPUT_CHANGED");
    const outside = path.join(runDir, "outside.png"); writeFileSync(outside, png);
    const invalid = payload(server, "comfy-outside", { templateId: "stock-img2img", referenceImages: [{ ...source, path: outside }] }); delete invalid.templateId;
    const second = await generate(invalid); assert.equal(second.errorCode, "COMFYUI_INPUT_NOT_MANAGED"); assert.equal(server.posts.length, 0); assert.equal(server.uploads.length, 0);
  }));
  await test("unknown submission is durable and recovers only the original queued/history task", () => fixture({ disconnect: true, hold: true }, async server => {
    const request = payload(server, "comfy-main-unknown");
    const initial = await generate(request); assert.equal(initial.errorCode, "COMFYUI_SUBMISSION_UNKNOWN"); assert.equal(initial.unsafeToRetry, true);
    let item = owner.imageOperationJournal.find(projectId, request.operationId); assert.equal(item.state, "uncertain"); assert.ok(item.comfyui.clientId); assert.equal(item.taskId, "");
    assert.equal(item.comfyui.schemaVersion, 2); assert.ok(item.comfyui.policyVersion); assert.match(item.comfyui.capabilitiesHash, /^[a-f0-9]{64}$/);
    const pending = await owner.imageOperationJournal.recover(projectId, item.key); assert.equal(pending.pending, true); item = owner.imageOperationJournal.get(projectId, item.key); assert.equal(item.taskId, "prompt-1"); assert.equal(item.providerState, "queued"); assert.equal(server.posts.length, 1);
    server.finish("prompt-1", server.pending[0]);
    const recovered = await owner.imageOperationJournal.recover(projectId, item.key); assert.equal(recovered.assets.length, 1); assert.deepEqual(readFileSync(recovered.assets[0].path), png); assert.equal(server.posts.length, 1);
    assert.equal(recovered.assets[0].generation.request.protocol, "comfyui"); assert.equal(recovered.assets[0].generation.request.seed, 123); assert.equal(recovered.assets[0].generation.request.templateHash, item.comfyui.templateHash);
    const repeated = await generate(request); assert.equal(repeated.ok, true, repeated.error); assert.deepEqual(repeated.assets, recovered.assets); assert.equal(server.posts.length, 1);
  }));
  await test("legacy v1 hash replay conflicts safely while original snapshot remains recoverable", () => fixture({ disconnect: true, hold: true }, async server => {
    const request = payload(server, "comfy-main-legacy");
    for (const field of ["steps", "cfg", "sampler", "scheduler", "denoise"]) delete request.comfyui[field];
    assert.equal((await generate(request)).errorCode, "COMFYUI_SUBMISSION_UNKNOWN");
    const canonical = owner.comfyUiTemplateService.resolve(request.comfyui);
    const legacyMappings = canonical.inputMappings.filter(mapping => !["steps", "cfg", "sampler", "scheduler", "denoise"].includes(mapping.kind));
    const legacyHash = stableHash({ workflow: canonical.workflow, inputMappings: legacyMappings, outputNodeId: canonical.outputNodeId });
    const journalFile = path.join(projectDir, ".naimage", "image-operations", "journal.json"), journal = JSON.parse(readFileSync(journalFile, "utf8"));
    const legacy = journal.operations.find(item => item.operationId === request.operationId);
    legacy.requestHash = stableHash({ templateId: canonical.templateId, templateHash: legacyHash, baseUrl: canonical.baseUrl, checkpoint: canonical.checkpoint,
      seed: canonical.seed, width: canonical.width, height: canonical.height, prompt: request.prompt, negativePrompt: canonical.negativePrompt, sources: [], requireAlpha: false });
    legacy.comfyui.schemaVersion = 1; legacy.comfyui.templateHash = legacyHash; legacy.comfyui.inputMappings = legacyMappings;
    delete legacy.comfyui.policyVersion; delete legacy.comfyui.capabilitiesHash;
    // A genuine pre-profile v1 journal persisted only the loopback URL and
    // the historical model-catalog connection identity.
    legacy.comfyui.baseUrl = server.baseUrl;
    delete legacy.comfyui.connectionId; delete legacy.comfyui.connectionHash; delete legacy.comfyui.networkScope;
    legacy.connectionId = modelConnectionIdentity(server.baseUrl, ""); legacy.transport = "local";
    writeFileSync(journalFile, JSON.stringify(journal));
    const replay = await generate({ ...request, comfyui: { ...request.comfyui, templateHash: legacyHash } });
    assert.equal(replay.errorCode, "COMFYUI_SUBMISSION_CONFLICT"); assert.equal(replay.unsafeToRetry, true); assert.equal(server.posts.length, 1);
    const pending = await owner.imageOperationJournal.recover(projectId, legacy.key); assert.equal(pending.pending, true); assert.equal(server.posts.length, 1);
    server.finish("prompt-1", server.pending[0]);
    const recovered = await owner.imageOperationJournal.recover(projectId, legacy.key); assert.equal(recovered.assets.length, 1); assert.equal(recovered.operation.comfyui.schemaVersion, 1); assert.equal(recovered.operation.comfyui.templateHash, legacyHash); assert.equal(server.posts.length, 1);
    assert.deepEqual(readFileSync(recovered.assets[0].path), png);
  }));
  await test("profile endpoint drift rejects replay and recovery before network", () => fixture({ disconnect: true, hold: true }, async server => {
    const request = payload(server, "comfy-profile-drift");
    assert.equal((await generate(request)).errorCode, "COMFYUI_SUBMISSION_UNKNOWN");
    const item = owner.imageOperationJournal.find(projectId, request.operationId);
    const service = owner.comfyUiTemplateService.connectionService;
    const profile = service.getInternal(item.comfyui.connectionId);
    const reads = server.gets.length;
    service.update(profile.id, { baseUrl: `${server.baseUrl}/changed` });
    const idRequest = { ...request, comfyui: { ...request.comfyui, connectionId: profile.id } };
    delete idRequest.comfyui.baseUrl;
    assert.equal((await generate(idRequest)).errorCode, "COMFYUI_SUBMISSION_CONFLICT");
    await assert.rejects(owner.imageOperationJournal.recover(projectId, item.key), { code: "COMFYUI_TASK_OWNERSHIP_MISMATCH" });
    assert.equal(server.posts.length, 1); assert.equal(server.gets.length, reads);
    service.update(profile.id, { baseUrl: profile.baseUrl });
    assert.equal((await owner.imageOperationJournal.recover(projectId, item.key)).pending, true);
    assert.equal(server.posts.length, 1);
  }));
  await test("definite prompt rejection stays terminal and cannot enter recovery or resubmit", () => fixture({ promptStatus: 400 }, async server => {
    const request = payload(server, "comfy-main-rejected");
    assert.equal((await generate(request)).errorCode, "COMFYUI_PROMPT_REJECTED");
    const item = owner.imageOperationJournal.find(projectId, request.operationId), row = owner.imageOperationJournal.list(projectId).find(value => value.key === item.key);
    assert.equal(item.state, "rejected"); assert.equal(row.providerState, "rejected"); assert.equal(row.canRecover, false); assert.equal(row.canCancel, false);
    const queries = server.gets.length;
    await assert.rejects(owner.imageOperationJournal.recover(projectId, item.key), { code: "IMAGE_OPERATION_TERMINAL" });
    assert.equal((await generate(request)).errorCode, "IMAGE_OPERATION_TERMINAL"); assert.equal(server.posts.length, 1); assert.equal(server.gets.length, queries);
  }));
  await test("saved output content drift is rejected without download or resubmission", () => fixture({}, async server => {
    const request = payload(server, "comfy-output-drift"), initial = await generate(request); assert.equal(initial.ok, true, initial.error);
    writeFileSync(initial.assets[0].path, Buffer.from("changed local file"));
    const replay = await generate(request); assert.equal(replay.errorCode, "IMAGE_SAVED_ASSET_CHANGED"); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 1);
  }));
  await test("Main cancel uses frozen prompt/client; late wait error cannot revive canceled task", () => fixture({ hold: true }, async server => {
    const controller = new AbortController(), request = payload(server, "comfy-main-cancel");
    await assert.rejects(owner.callNewApiImageWithSession(settings, { ...resolved(request), signal: controller.signal, onAccepted() { controller.abort(); } }), error => error.code === "ABORT_ERR");
    const item = owner.imageOperationJournal.find(projectId, request.operationId); assert.equal(item.state, "accepted");
    const result = await owner.imageOperationJournal.cancel(projectId, item.key); assert.equal(result.canceled, true); assert.deepEqual(server.deletes, [{ delete: ["prompt-1"] }]);
    owner.imageOperationJournal.failed(item, { code: "COMFYUI_TIMEOUT", unsafeToRetry: true }); assert.equal(owner.imageOperationJournal.get(projectId, item.key).state, "canceled"); assert.equal(owner.imageOperationJournal.list(projectId).find(row => row.key === item.key).canCancel, false); assert.equal(server.posts.length, 1);
  }));
  await test("alpha recovery validates staged original bytes after local delivery failure", async () => {
    const { verifyAlphaSubject } = require("../runtime/image-generation/edit-capabilities.cjs");
    const transparent = Buffer.alloc(64 * 96 * 4, 255); for (let i = 0; i < 64 * 48; i++) transparent[i * 4 + 3] = 0;
    const alphaPng = await sharp(transparent, { raw: { width: 64, height: 96, channels: 4 } }).png().toBuffer();
    const item = owner.imageOperationJournal.start({ projectId, operationId: "alpha-recovery", model: "fixture", runId: "alpha", parameters: { outputFormat: "png" } });
    const opaque = { data: [{ b64_json: png.toString("base64") }] }; owner.imageOperationJournal.received(item, opaque, { requireAlpha: true });
    await assert.rejects(owner.imageOperationJournal.deliver(item, opaque, {}, false), error => error.code === "IMAGE_EDIT_ALPHA_INVALID"); assert.equal(owner.imageOperationJournal.get(projectId, item.key).slots[0].processed, false);
    await assert.rejects(owner.imageOperationJournal.recover(projectId, item.key), error => error.code === "IMAGE_EDIT_ALPHA_INVALID");
    // A separate valid result owns its own staged pixels and alpha evidence.
    const valid = owner.imageOperationJournal.start({ projectId, operationId: "alpha-valid", model: "fixture", runId: "alpha", parameters: { outputFormat: "png" } });
    const result = { data: [{ b64_json: alphaPng.toString("base64") }] }; owner.imageOperationJournal.received(valid, result, { requireAlpha: true });
    const assets = await owner.imageOperationJournal.deliver(valid, result, {}, false); assert.equal(assets[0].localProcessing.alpha.verified, true); assert.equal((await verifyAlphaSubject(readFileSync(assets[0].path))).ok, true);
    assert.equal(owner.imageOperationJournal.get(projectId, valid.key).assets[0].localProcessing.alpha.transparentRatio, 0.5);
  });
  await test("connection IPC wraps service records and preserves the public credential boundary", async () => {
    const connectionHandlers = new Map();
    const connectionService = createComfyUiConnectionProfileService();
    let inspected = 0, imported = 0, cancelImport = false;
    registerServerIpc({
      ipcMain: { handle: (name, callback) => connectionHandlers.set(name, callback) },
      comfyUiConnectionService: connectionService,
      comfyUiCredentialStore: { importCredential: async ({ mode }) => { imported++; return cancelImport ? { ok: true, canceled: true } : { ok: true, credentialRef: { mode, id: "fixture-credential-ref" } }; } },
      comfyUiTemplateService: { inspect: async input => { inspected++; return { ok: true, connectionId: input.connectionId, checkpoints: ["fixture.safetensors"] }; } }
    });
    const control = input => connectionHandlers.get("naimage:server:comfyui")({}, input);
    for (const input of [{ connectionId: "" }, { connectionId: 7 }, { profileId: null }, { connectionId: "one", profileId: "two" }]) {
      const invalid = await control({ action: "inspect", baseUrl: "http://127.0.0.1:8188", ...input });
      assert.equal(invalid.errorCode, "COMFYUI_CONNECTION_PROFILE_INVALID");
    }
    assert.equal(inspected, 0);
    const denied = await control({ action: "connections-save", label: "Fixture", networkScope: "local", baseUrl: "http://127.0.0.1:8188" });
    assert.equal(denied.ok, false); assert.equal(denied.errorCode, "COMFYUI_CONNECTION_CONFIRMATION_REQUIRED");
    assert.equal(connectionService.list().length, 0);
    const saved = await control({ action: "connections-save", label: "Fixture", networkScope: "local", baseUrl: "http://127.0.0.1:8188", confirmed: true });
    assert.equal(saved.ok, true); assert.equal(saved.connections.length, 1); assert.equal(saved.connection.connectionId, "comfyui-local");
    assert.equal(saved.connection.credentialMode, "none"); assert.equal(saved.connection.credentialConfigured, false);
    assert.equal(saved.connection.credentialRef, undefined); assert.equal(saved.connection.id, undefined);
    assert.equal(JSON.stringify(saved).includes("fixture-credential-ref"), false);
    const listed = await control({ action: "connections-list" });
    assert.equal(listed.ok, true); assert.equal(Array.isArray(listed.connections), true); assert.deepEqual(listed.connections, saved.connections);
    const reference = { connectionId: saved.connection.connectionId, credentialType: "bearer", confirmed: true };
    assert.equal((await control({ action: "connections-credential-import", ...reference, confirmed: false })).ok, false);
    assert.equal(imported, 0);
    assert.equal((await control({ action: "connections-credential-import", ...reference, path: "C:/private.json" })).ok, false);
    assert.equal(imported, 0);
    const bound = await control({ action: "connections-credential-import", ...reference });
    assert.equal(bound.ok, true); assert.equal(bound.connection.credentialMode, "bearer"); assert.equal(bound.connection.credentialConfigured, true);
    assert.equal(imported, 1); assert.equal(JSON.stringify(bound).includes("fixture-credential-ref"), false);
    cancelImport = true;
    const canceled = await control({ action: "connections-credential-import", ...reference, credentialType: "basic" });
    assert.equal(canceled.canceled, true); assert.equal(connectionService.get(saved.connection.connectionId).credentialMode, "bearer");
    const updated = await control({ action: "connections-save", profileId: saved.connection.connectionId, label: "Renamed fixture", networkScope: "local", baseUrl: "http://127.0.0.1:8188", confirmed: true });
    assert.equal(updated.ok, true); assert.equal(updated.connection.label, "Renamed fixture"); assert.equal(updated.connections.length, 1);
    assert.equal(updated.connection.credentialMode, "bearer"); assert.equal(connectionService.getInternal(saved.connection.connectionId).credentialRef.id, "fixture-credential-ref");
    const metadata = await control({ action: "connections-update-metadata", connectionId: saved.connection.connectionId, label: "Automation name", enabled: false, confirmed: true });
    assert.equal(metadata.ok, true); assert.equal(metadata.connection.label, "Automation name"); assert.equal(metadata.connection.enabled, false);
    assert.equal(metadata.connection.baseUrl, "http://127.0.0.1:8188", "GUI IPC keeps its safe endpoint summary");
    assert.equal(connectionService.getInternal(saved.connection.connectionId).credentialRef.id, "fixture-credential-ref");
    const beforeInvalidMetadata = connectionService.getInternal(saved.connection.connectionId);
    for (const extra of [{ baseUrl: "http://127.0.0.1:9000" }, { networkScope: "remote" }, { credentialType: "none" }, { enabled: "false" }, { label: "" }]) {
      assert.equal((await control({ action: "connections-update-metadata", connectionId: saved.connection.connectionId, label: "Rejected", confirmed: true, ...extra })).ok, false);
      assert.deepEqual(connectionService.getInternal(saved.connection.connectionId), beforeInvalidMetadata);
    }
    assert.equal((await control({ action: "connections-update-metadata", connectionId: "unknown", label: "No implicit create", confirmed: true })).errorCode, "COMFYUI_CONNECTION_NOT_FOUND");
    const changedMode = await control({ action: "connections-save", connectionId: saved.connection.connectionId, label: "No implicit change", networkScope: "local", baseUrl: "http://127.0.0.1:8188", credentialType: "basic", confirmed: true });
    assert.equal(changedMode.errorCode, "COMFYUI_CREDENTIAL_IMPORT_REQUIRED");
    assert.equal((await control({ action: "connections-save", connectionId: saved.connection.connectionId, label: "No exposed ref", networkScope: "local", baseUrl: "http://127.0.0.1:8188", credentialRef: "no-ref", confirmed: true })).ok, false);
    assert.equal((await control({ action: "connections-save", connectionId: "first", profileId: "second", label: "Invalid alias", networkScope: "local", baseUrl: "http://127.0.0.1:8188", confirmed: true })).ok, false);
    const tested = await control({ action: "connections-test", connectionId: saved.connection.connectionId, confirmed: false });
    assert.equal(tested.ok, false); assert.equal(inspected, 0);
    const removed = await control({ action: "connections-delete", profileId: saved.connection.connectionId, confirmed: true });
    assert.equal(removed.ok, true); assert.equal(removed.removed, true); assert.deepEqual(removed.connections, []);
  });
  const maskPixels = Buffer.alloc(64 * 96 * 4, 255);
  for (let pixel = 0; pixel < 64 * 48; pixel++) maskPixels[pixel * 4 + 3] = 0;
  const maskPng = await sharp(maskPixels, { raw: { width: 64, height: 96, channels: 4 } }).png().toBuffer();
  const savedMask = await owner.creationMaskService.save({ expectedProjectId: projectId, conversationId: "conversation-fixture", target: identity(source), dataUrl: `data:image/png;base64,${maskPng.toString("base64")}` });
  const mask = { ...savedMask.mask, revision: savedMask.revision };
  const maskMaterial = owner.creationMaskService.resolve({ expectedProjectId: projectId, conversationId: "conversation-fixture", target: identity(source), mask });
  const managedMaskBytes = readFileSync(maskMaterial.path);
  const editedPng = await sharp({ create: { width: 64, height: 96, channels: 4, background: "#16bb68" } }).png().toBuffer();
  const materials = { sourceImage: identity(source), maskImage: mask };
  await test("typed project identity owns img2img input and prompt over the legacy outer group", () => fixture({}, async server => {
    const request = typedPayload(server, "comfy-typed-img2img", "img2img", { sourceImage: identity(source), prompt: "explicit typed prompt" }, { editImage: { path: "C:/not-a-project-image.png" }, referenceImages: [{ path: "C:/also-ignored.png" }] });
    const response = await generate(request); assert.equal(response.ok, true, response.error); assert.equal(server.uploads.length, 1);
    assert.equal(server.posts[0].prompt["6"].inputs.text, "explicit typed prompt");
    const item = owner.imageOperationJournal.find(projectId, request.operationId);
    assert.equal(item.comfyui.inputs[0].role, "sourceImage"); assert.equal(item.comfyui.inputs[0].assetId, source.assetId);
    assert.equal((await generate({ ...request, prompt: "ignored outer prompt drift" })).ok, true); assert.equal(server.posts.length, 1);
  }));
  await test("inpaint freezes source and mask roles and keeps every protected original pixel", () => fixture({ uploadImages: [png, managedMaskBytes], imageBytes: editedPng }, async server => {
    const sourceBefore = readFileSync(sourcePath), maskBefore = readFileSync(maskMaterial.path);
    const request = typedPayload(server, "comfy-inpaint", "inpaint", materials);
    const response = await generate(request); assert.equal(response.ok, true, response.error); assert.equal(server.uploads.length, 2);
    assert.equal(server.posts[0].prompt["10"].inputs.image, "task-inputs/uploaded.png"); assert.equal(server.posts[0].prompt["11"].inputs.image, "task-inputs/uploaded-2.png");
    const item = owner.imageOperationJournal.find(projectId, request.operationId);
    assert.equal(item.comfyui.schemaVersion, 3); assert.equal(item.comfyui.capability, "inpaint"); assert.equal(item.comfyui.actualParams.denoise, 1);
    assert.deepEqual(item.comfyui.inputs.map(value => value.role), ["sourceImage", "maskImage"]);
    assert.deepEqual(item.comfyui.maskBindings, { sourceHash: source.contentHash, maskHash: mask.contentHash, width: 64, height: 96, revision: 1 });
    assert.deepEqual(item.sourceNodeIds, ["source"]); assert.equal(item.sources.length, 1);
    assert.equal(item.processing.sourceHash, source.contentHash); assert.equal(item.processing.maskHash, mask.contentHash);
    assert.equal(response.assets[0].localProcessing.maskComposite.verified, true);
    assert.deepEqual(response.assets[0].generation.request.sourceHashes, [source.contentHash]);
    assert.deepEqual(response.assets[0].generation.request.maskBindings, item.comfyui.maskBindings);
    await assertProtectedHalf(readFileSync(response.assets[0].path), png, editedPng);
    assert.deepEqual(readFileSync(sourcePath), sourceBefore); assert.deepEqual(readFileSync(maskMaterial.path), maskBefore);
  }));
  await test("mask path, revision, source and conversation mismatches fail before any upload or POST", () => fixture({ uploadImages: [png, managedMaskBytes] }, async server => {
    const invalid = [
      [{ ...materials, maskImage: { ...mask, path: maskMaterial.path } }, {}, "COMFYUI_INPUT_INVALID"],
      [{ ...materials, maskImage: { ...mask, dataUrl: `data:image/png;base64,${maskPng.toString("base64")}` } }, {}, "COMFYUI_INPUT_INVALID"],
      [{ ...materials, maskImage: { ...mask, revision: 2 } }, {}, "CREATION_MASK_REVISION_INVALID"],
      [{ ...materials, maskImage: { ...savedMask.mask } }, {}, "COMFYUI_INPUT_INVALID"],
      [materials, { conversationId: "other-conversation" }, "CREATION_MASK_IDENTITY_INVALID"],
      [materials, { maskImage: { path: maskMaterial.path } }, "COMFYUI_INPUT_INVALID"],
      [{ ...materials, sourceImage: { ...identity(source), contentHash: "0".repeat(64) } }, {}, "COMFYUI_INPUT_CHANGED"]
    ];
    for (const [index, [input, outer, code]] of invalid.entries()) {
      const response = await generate(typedPayload(server, `comfy-mask-reject-${index}`, "inpaint", input, outer));
      assert.equal(response.errorCode, code, response.error);
    }
    assert.equal(server.uploads.length, 0); assert.equal(server.posts.length, 0);
  }));
  await test("native import persists an exact non-canvas identity for masks and fake inpaint", async () => {
    const nativeFile = path.join(runDir, "native-import.png"); writeFileSync(nativeFile, png);
    const imported = await owner.importLocalImagesToProject({ projectId, paths: [nativeFile], maxFiles: 1 });
    assert.equal(imported.ok, true, imported.error); assert.equal(imported.assets.length, 1);
    const importedAsset = imported.assets[0], importedIdentity = identity(importedAsset);
    assert.equal(importedIdentity.assetId, `asset-${digest(png)}`); assert.ok(importedIdentity.occurrenceId); assert.notEqual(importedIdentity.occurrenceId, source.occurrenceId);
    const document = JSON.parse(readFileSync(path.join(projectDir, ".naimage", "imported-materials.json"), "utf8"));
    assert.equal(JSON.stringify(document).includes(nativeFile), false);
    assert.equal(JSON.parse(readFileSync(project.sessionPath, "utf8")).nodes.some(node => node.assets?.some(asset => asset.occurrenceId === importedIdentity.occurrenceId)), false);
    const saved = await owner.creationMaskService.save({ expectedProjectId: projectId, conversationId: "conversation-fixture", target: importedIdentity, dataUrl: `data:image/png;base64,${maskPng.toString("base64")}` });
    const importedMask = { ...saved.mask, revision: saved.revision };
    await fixture({ uploadImages: [png, managedMaskBytes], imageBytes: editedPng }, async server => {
      const request = typedPayload(server, "comfy-native-import", "inpaint", { sourceImage: importedIdentity, maskImage: importedMask });
      const response = await generate(request); assert.equal(response.ok, true, response.error);
      await assertProtectedHalf(readFileSync(response.assets[0].path), png, editedPng);
      const item = owner.imageOperationJournal.find(projectId, request.operationId); assert.equal(item.sources[0].occurrenceId, importedIdentity.occurrenceId); assert.deepEqual(item.sourceNodeIds, []);
      assert.equal((await generate(typedPayload(server, "comfy-wrong-source-mask", "inpaint", { sourceImage: importedIdentity, maskImage: mask }))).errorCode, "CREATION_MASK_IDENTITY_INVALID");
      writeFileSync(importedAsset.path, editedPng);
      assert.equal((await generate(typedPayload(server, "comfy-import-drift", "inpaint", { sourceImage: importedIdentity, maskImage: importedMask }))).errorCode, "COMFYUI_INPUT_CHANGED");
      assert.equal(server.posts.length, 1); assert.equal(server.uploads.length, 2); writeFileSync(importedAsset.path, png);
      const forged = { ...importedIdentity, occurrenceId: "occ-unregistered" };
      assert.equal((await generate(typedPayload(server, "comfy-import-forged", "img2img", { sourceImage: forged }))).errorCode, "COMFYUI_INPUT_CHANGED");
      assert.equal(server.posts.length, 1);
      renameSync(importedAsset.path, `${importedAsset.path}.saved`);
      try {
        symlinkSync(sourcePath, importedAsset.path);
        assert.equal((await generate(typedPayload(server, "comfy-import-linked", "img2img", { sourceImage: importedIdentity }))).errorCode, "COMFYUI_INPUT_CHANGED");
      } finally { unlinkSync(importedAsset.path); renameSync(`${importedAsset.path}.saved`, importedAsset.path); }
      const otherProject = { id: "other-project", path: path.join(runDir, "other-project") }; mkdirSync(otherProject.path, { recursive: true });
      assert.equal(owner.projectAssetRepository.resolveRegisteredMaterial(otherProject, importedIdentity), null);
      assert.equal(server.posts.length, 1); assert.equal(server.uploads.length, 2);
    });
  });
  await test("native mask picker rechecks project and source after await and returns no paths", async () => {
    const nativeMask = path.join(runDir, "native-mask.png"); writeFileSync(nativeMask, maskPng);
    const originalPicker = dialog.showOpenDialog, listFile = path.join(configDir, "project-list.json"), listText = readFileSync(listFile, "utf8");
    const switchedPath = path.join(runDir, "switched-project"); mkdirSync(switchedPath, { recursive: true });
    try {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      assert.equal((await owner.comfyUiMaskService.importMask({ projectId, conversationId: "conversation-fixture", sourceImage: identity(source), confirmed: true })).canceled, true);
      dialog.showOpenDialog = async () => { writeFileSync(listFile, JSON.stringify({ activeProjectId: "switched-project", projects: [project, { ...project, id: "switched-project", path: switchedPath, sessionPath: path.join(switchedPath, "session.json") }] })); return { canceled: false, filePaths: [nativeMask] }; };
      await assert.rejects(owner.comfyUiMaskService.importMask({ projectId, conversationId: "conversation-fixture", sourceImage: identity(source), confirmed: true })); writeFileSync(listFile, listText);
      dialog.showOpenDialog = async () => { writeFileSync(sourcePath, editedPng); return { canceled: false, filePaths: [nativeMask] }; };
      await assert.rejects(owner.comfyUiMaskService.importMask({ projectId, conversationId: "conversation-fixture", sourceImage: identity(source), confirmed: true }), { code: "COMFYUI_INPUT_CHANGED" }); writeFileSync(sourcePath, png);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nativeMask] });
      const saved = await owner.comfyUiMaskService.importMask({ projectId, conversationId: "conversation-fixture", sourceImage: identity(source), confirmed: true });
      assert.equal(saved.ok, true); assert.equal(saved.mask.revision, 2); assert.deepEqual(saved.mask.sourceImage, identity(source)); assert.equal(JSON.stringify(saved).includes(runDir), false); assert.equal(JSON.stringify(saved).includes("data:"), false);
    } finally { dialog.showOpenDialog = originalPicker; writeFileSync(listFile, listText); writeFileSync(sourcePath, png); }
  });
  const alphaPixels = await sharp(png).ensureAlpha().raw().toBuffer();
  for (let pixel = 0; pixel < 64 * 48; pixel++) alphaPixels[pixel * 4 + 3] = 0;
  const alphaResult = await sharp(alphaPixels, { raw: { width: 64, height: 96, channels: 4 } }).png().toBuffer();
  await test("mask cutout freezes seedless model-free dimensions and verifies raw output alpha", () => fixture({ uploadImages: [png, managedMaskBytes], imageBytes: alphaResult }, async server => {
    const request = typedPayload(server, "comfy-cutout", "cutout", materials), response = await generate(request);
    assert.equal(response.ok, true, response.error); assert.deepEqual(readFileSync(response.assets[0].path), alphaResult);
    assert.equal(Object.values(server.posts[0].prompt).some(node => ["KSampler", "CheckpointLoaderSimple"].includes(node.class_type)), false);
    const item = owner.imageOperationJournal.find(projectId, request.operationId); assert.equal(item.comfyui.schemaVersion, 3); assert.equal(item.comfyui.capability, "cutout"); assert.equal(item.comfyui.alphaRequired, true);
    assert.deepEqual(item.comfyui.actualParams, { model: "comfyui-mask", width: 64, height: 96, batchSize: 1 }); assert.deepEqual(item.processing, { kind: "alpha", requireAlpha: true });
    assert.equal(response.assets[0].localProcessing.alpha.verified, true); assert.equal(response.assets[0].localProcessing.alpha.transparentRatio, 0.5);
    assert.equal((await generate(request)).ok, true); assert.equal(server.posts.length, 1);
  }));
  await test("opaque cutout bytes cannot be delivered or bypassed by replay", () => fixture({ uploadImages: [png, managedMaskBytes] }, async server => {
    const request = typedPayload(server, "comfy-cutout-opaque", "cutout", materials), response = await generate(request);
    assert.equal(response.errorCode, "IMAGE_EDIT_ALPHA_INVALID"); assert.equal(response.unsafeToRetry, true);
    const item = owner.imageOperationJournal.find(projectId, request.operationId); assert.equal(item.state, "delivery-failed"); assert.equal(item.assets.length, 0);
    assert.equal((await generate(request)).errorCode, "IMAGE_EDIT_ALPHA_INVALID"); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 1);
  }));
  async function capacityMaterials(name, sourceBytes, maskBytes) {
    const sourceFile = path.join(projectDir, "assets", `${name}.png`); writeFileSync(sourceFile, sourceBytes);
    const target = { assetId: `asset-${name}`, occurrenceId: `occ-${digest(Buffer.from(name)).slice(0, 32)}`, contentHash: digest(sourceBytes) };
    const session = JSON.parse(readFileSync(project.sessionPath, "utf8"));
    session.nodes.push({ id: name, type: "image", status: "done", imageState: "done", assets: [{ ...target, type: "file", path: sourceFile }], outputs: 1, x: 0, y: 0 });
    writeFileSync(project.sessionPath, JSON.stringify(session));
    const saved = await owner.creationMaskService.save({ expectedProjectId: projectId, conversationId: "conversation-fixture", target, dataUrl: `data:image/png;base64,${maskBytes.toString("base64")}` });
    return { sourceImage: target, maskImage: { ...saved.mask, revision: saved.revision } };
  }
  await test("inpaint rejects a valid managed mask above the compositor limit before any network", async () => {
    const sourceBytes = await sharp({ create: { width: 1200, height: 1000, channels: 4, background: "#447799" } }).png().toBuffer();
    const maskBytes = await sharp(randomBytes(1200 * 1000 * 4), { raw: { width: 1200, height: 1000, channels: 4 } }).png().toBuffer();
    const input = await capacityMaterials("mask-capacity", sourceBytes, maskBytes);
    const stored = owner.creationMaskService.resolve({ expectedProjectId: projectId, conversationId: "conversation-fixture", target: input.sourceImage, mask: input.maskImage });
    assert.ok(readFileSync(stored.path).length >= 4 * 1024 * 1024);
    await fixture({}, async server => {
      const response = await generate(typedPayload(server, "comfy-mask-capacity", "inpaint", input)); assert.equal(response.errorCode, "IMAGE_INVALID_INPUT");
      assert.equal(server.gets.length, 0); assert.equal(server.uploads.length, 0); assert.equal(server.posts.length, 0);
    });
  });
  await test("inpaint and cutout refuse 32–64M sources before network when local verification cannot decode them", async () => {
    const sourceBytes = await sharp({ create: { width: 8000, height: 4096, channels: 4, background: "#447799" } }).png().toBuffer();
    const maskBytes = await sharp({ create: { width: 8000, height: 4096, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } }).png().toBuffer();
    const input = await capacityMaterials("pixel-capacity", sourceBytes, maskBytes);
    await fixture({}, async server => {
      assert.equal((await generate(typedPayload(server, "comfy-inpaint-pixel-capacity", "inpaint", input))).errorCode, "IMAGE_INVALID_INPUT");
      const cutout = await generate(typedPayload(server, "comfy-cutout-pixel-capacity", "cutout", input)); assert.equal(cutout.errorCode, "COMFYUI_INPUT_INVALID"); assert.match(cutout.error, /3200/);
      assert.equal(server.gets.length, 0); assert.equal(server.uploads.length, 0); assert.equal(server.posts.length, 0);
    });
  });
  await test("lost acknowledgment persists mask processing before POST and new Main recovers without resubmit", () => fixture({ uploadImages: [png, managedMaskBytes], imageBytes: editedPng, hold: true, abortDuringPost() {
    const item = owner.imageOperationJournal.find(projectId, "comfy-inpaint-restart");
    assert.equal(item.processing.sourceHash, source.contentHash); assert.equal(item.processing.maskHash, mask.contentHash); assert.equal(item.comfyui.schemaVersion, 3); assert.equal(item.taskId, "");
  } }, async server => {
    const request = typedPayload(server, "comfy-inpaint-restart", "inpaint", materials), response = await generate(request);
    assert.equal(response.errorCode, "COMFYUI_SUBMISSION_UNKNOWN");
    const item = owner.imageOperationJournal.find(projectId, request.operationId); assert.equal(item.state, "uncertain"); assert.equal(item.comfyui.promptId, undefined);
    server.finish("prompt-1", server.pending[0]);
    const recovered = await recoverInNewMain(item.key); assert.equal(recovered.ok, true, recovered.code); assert.equal(recovered.assets.length, 1);
    await assertProtectedHalf(readFileSync(recovered.assets[0].path), png, editedPng); assert.equal(recovered.assets[0].localProcessing.maskComposite.verified, true);
    const replay = await generate(request); assert.equal(replay.ok, true, replay.error); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 1);
  }));
  await test("new Main rejects tampered staged masks while preserving the original result and unique POST", () => fixture({ uploadImages: [png, managedMaskBytes], imageBytes: editedPng, hold: true, disconnect: true }, async server => {
    const request = typedPayload(server, "comfy-inpaint-mask-drift", "inpaint", materials); assert.equal((await generate(request)).errorCode, "COMFYUI_SUBMISSION_UNKNOWN");
    const item = owner.imageOperationJournal.find(projectId, request.operationId); server.finish("prompt-1", server.pending[0]);
    writeFileSync(path.join(projectDir, ".naimage", "image-operations", `${item.key}-mask.bin`), png);
    const recovered = await recoverInNewMain(item.key); assert.equal(recovered.ok, false); assert.equal(recovered.code, "IMAGE_PROCESSING_MASK_CHANGED");
    assert.equal(owner.imageOperationJournal.get(projectId, item.key).assets.length, 0); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 1);
  }));
  await pause(20);
  const report = { ok: true, cases: results.length, results, loopbackPromptPosts: posts, loopbackViews: views, loopbackUploads: uploads, restartProcesses, realModelRequests: 0 };
  writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2)); process.stdout.write(`${JSON.stringify({ ...report, results: undefined, reportPath: path.join(runDir, "report.json") })}\n`);
}

async function recoveryMain() {
  await app.whenReady();
  const key = process.env.NAIMAGE_COMFY_MAIN_RECOVERY_KEY;
  let report;
  try { const recovered = await owner.imageOperationJournal.recover(projectId, key); report = { ok: true, assets: recovered.assets, state: recovered.operation.state }; }
  catch (error) { report = { ok: false, code: error.code }; }
  writeFileSync(path.join(runDir, `restart-${key}.json`), JSON.stringify(report));
}
(process.env.NAIMAGE_COMFY_MAIN_RECOVERY_KEY ? recoveryMain() : main()).then(() => app.exit(0)).catch(error => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
