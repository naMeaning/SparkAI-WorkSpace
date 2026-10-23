"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync, readFileSync } = require("node:fs");
const sharp = require("sharp");
const { app } = require("electron");
const { createMockServer } = require("./comfyui-executor-selftest.cjs");
const { registerServerIpc } = require("../desktop/ipc/server-ipc.cjs");
const { stableHash } = require("../runtime/image-generation/comfyui-executor.cjs");
const { createComfyUiConnectionProfileService } = require("../desktop/comfyui-connection-service.cjs");
const { modelConnectionIdentity } = require("../desktop/model-catalog.cjs");

const runDir = path.resolve(__dirname, "../.diagnostics/electron", `comfyui-main-${Date.now()}`);
const projectDir = path.join(runDir, "project"), configDir = path.join(runDir, "config"), projectId = "comfyui-main-fixture";
for (const directory of [projectDir, configDir, path.join(runDir, "user-data"), path.join(projectDir, "assets")]) mkdirSync(directory, { recursive: true });
const project = { id: projectId, name: "Local ComfyUI fixture", path: projectDir, sessionPath: path.join(projectDir, "session.json"), external: true };
writeFileSync(path.join(configDir, "project-list.json"), JSON.stringify({ activeProjectId: projectId, projects: [project] }));
process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
process.env.NAIMAGE_CONFIG_DIR = configDir;
process.env.NAIMAGE_DEBUG_DIR = path.join(runDir, "runtime");
app.commandLine.appendSwitch("user-data-dir", path.join(runDir, "user-data"));
const owner = require("../electron-main.cjs");
const settings = { imageCount: 1, imageOutputFormat: "png" }, handlers = new Map(), results = [];
let png, posts = 0, views = 0, uploads = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

registerServerIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, migrateSettings: value => value, readJson: () => settings, defaultSettings: settings,
  getProjectById: id => id === projectId ? project : null, readProjectList: () => ({ activeProjectId: projectId, projects: [project] }), log() {}, emitAgentProgress() {}, removeOwnedDataUrlTemp() {},
  callNewApiImageWithSession: owner.callNewApiImageWithSession, deliverGeneratedImageResult: owner.deliverGeneratedImageResult,
  imageOperationJournal: owner.imageOperationJournal, comfyUiTemplateService: owner.comfyUiTemplateService });
const generate = payload => handlers.get("naimage:server:generate-image")({ sender: { id: 1 } }, payload);

function payload(server, name, extra = {}) {
  const templateId = extra.templateId || "stock-generate";
  const template = owner.comfyUiTemplateService.list().templates.find(value => value.id === templateId);
  return { provider: "comfyui", projectId, conversationId: "conversation-fixture", runId: name, operationId: name, requestIndex: 1, prompt: "loopback fixture",
    comfyui: { templateId, templateHash: template.templateHash, baseUrl: server.baseUrl, checkpoint: "fixture.safetensors", width: 64, height: 96, seed: 123,
      steps: 12, cfg: 6.5, sampler: "euler", scheduler: "normal", denoise: 1 }, ...extra };
}
function resolved(request) { return { ...request, comfyui: owner.comfyUiTemplateService.resolve(request.comfyui) }; }
async function fixture(config, fn) {
  const server = await createMockServer({ output: { "9": { images: [{ filename: "main-result.png", subfolder: "fixtures", type: "output" }] } }, ...config }, png);
  try { return await fn(server); } finally { posts += server.posts.length; views += server.views.length; uploads += server.uploads.length; await server.close(); }
}
async function test(name, fn) { await fn(); results.push({ name, ok: true }); }

async function main() {
  await app.whenReady();
  png = await sharp({ create: { width: 64, height: 96, channels: 4, background: "#447799" } }).png().toBuffer();
  const sourcePath = path.join(projectDir, "assets", "source.png"); writeFileSync(sourcePath, png);
  const source = { type: "file", path: sourcePath, assetId: "asset-source", occurrenceId: "occ-source", contentHash: digest(png), canvasNodeId: "source", canvasAssetIndex: 0 };
  writeFileSync(project.sessionPath, JSON.stringify({ ...owner.defaultSession, sessionRevision: 7, nodes: [{ id: "source", type: "image", status: "done", imageState: "done", assets: [source], outputs: 1, x: 0, y: 0 }] }));
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
  await pause(20);
  const report = { ok: true, cases: results.length, results, loopbackPromptPosts: posts, loopbackViews: views, loopbackUploads: uploads, realModelRequests: 0 };
  writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2)); process.stdout.write(`${JSON.stringify({ ...report, results: undefined, reportPath: path.join(runDir, "report.json") })}\n`);
}

main().then(() => app.exit(0)).catch(error => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
