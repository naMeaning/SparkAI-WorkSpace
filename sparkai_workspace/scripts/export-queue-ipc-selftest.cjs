"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { initializeCanvas, readPsd } = require("ag-psd");
const { registerAssetIpc } = require("../desktop/ipc/asset-ipc.cjs");
const { createImageCollectionExportService } = require("../desktop/image-collection-export-service.cjs");
const { createExportCenterStateService } = require("../desktop/export-center-state-service.cjs");
const { convertImageForExport } = require("../desktop/image-export-service.cjs");
const { writeStreamingZip } = require("../desktop/project-package-service.cjs");
const { exportLayeredPsd, preparePsdRasterSource } = require("../psd-export.cjs");

initializeCanvas(undefined, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash("sha256").update(value).digest("hex");
const waitTick = () => new Promise(resolve => setTimeout(resolve, 10));
const root = path.join(__dirname, "..", ".diagnostics", "export-queue-ipc", new Date().toISOString().replace(/[:.]/g, "-"));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const safeStem = (value, fallback) => String(value || fallback || "image").replace(/[\\/:*?"<>|]/g, " ").trim();
const inside = (candidate, parent) => { const relative = path.relative(parent, candidate); return !relative.startsWith("..") && !path.isAbsolute(relative); };
function uniquePath(parent, desired) {
  const parsed = path.parse(desired); let result = path.join(parent, desired);
  for (let index = 2; fs.existsSync(result); index += 1) result = path.join(parent, `${parsed.name} (${index})${parsed.ext}`);
  return result;
}
function zipEntries(file) {
  const bytes = fs.readFileSync(file), result = new Map(); let cursor = 0;
  while (bytes.readUInt32LE(cursor) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(cursor + 8), 0, "archive must contain stored streaming entries");
    const size = bytes.readUInt32LE(cursor + 18), nameLength = bytes.readUInt16LE(cursor + 26), extraLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString("utf8"), offset = cursor + 30 + nameLength + extraLength;
    result.set(name, bytes.subarray(offset, offset + size)); cursor = offset + size;
  }
  assert.equal(bytes.readUInt32LE(cursor), 0x02014b50); assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), result.size);
  return result;
}

async function run() {
  fs.mkdirSync(root, { recursive: true });
  const project = { id: "queue-project-a", path: path.join(root, "project-a") }, other = { id: "queue-project-b", path: path.join(root, "project-b") };
  const delivery = path.join(root, "delivery"), sourceRoot = path.join(project.path, "output", "imagegen"), cache = path.join(project.path, ".naimage", "cache");
  for (const folder of [sourceRoot, other.path, delivery, cache]) fs.mkdirSync(folder, { recursive: true });
  const png = path.join(sourceRoot, "alpha.png"), webp = path.join(sourceRoot, "second.webp"), layer = path.join(sourceRoot, "top.png");
  await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 210, g: 50, b: 80, alpha: 0.4 } } }).png().toFile(png);
  await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 50, g: 120, b: 200, alpha: 0.8 } } }).webp().toFile(webp);
  await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 50, g: 190, b: 90, alpha: 0.6 } } }).png().toFile(layer);
  const asset = file => ({ type: "file", assetId: `asset-${path.basename(file)}`, occurrenceId: `occ-${path.basename(file)}`, contentHash: hash(fs.readFileSync(file)), path: file, relativePath: path.relative(project.path, file).replace(/\\/g, "/"), width: 12, height: 8 });
  const first = asset(png), second = asset(webp), top = asset(layer);
  const collection = { id: "collection-a", name: "Original group", kind: "batch", collectionRole: "results", items: [
    { id: "item-two", assetId: second.assetId, assetIndex: 2, requestIndex: 3, status: "done", prompt: "second" },
    { id: "item-one", assetId: first.assetId, assetIndex: 1, requestIndex: 1, status: "done", prompt: "first" },
    { id: "item-failed", requestIndex: 4, status: "error", error: "retained fixture slot" }
  ] };
  let session = { nodes: [
    { id: "images", type: "image", title: "Original group", assets: [first, second], imageCollection: collection, imageContainerSpec: { collection } },
    { id: "bottom", type: "image", title: "Bottom", assets: [first], layerGroup: { id: "layer-group", order: 1, total: 2, compositionWidth: 12, compositionHeight: 8, layerTitle: "Bottom", visible: true, opacity: 1 } },
    { id: "top", type: "image", title: "Top", assets: [top], layerGroup: { id: "layer-group", order: 2, total: 2, compositionWidth: 12, compositionHeight: 8, layerTitle: "Top", visible: true, opacity: 0.65 } }
  ] };
  let active = project.id, nextGate = null, failureSource = "", failureName = "", selectedDirectory = delivery; const conversionCalls = [];
  const projects = [project, other], projectList = () => ({ activeProjectId: active, projects });
  const ownerOptions = {
    getProjectById: id => projects.find(item => item.id === id), readProjectList: projectList,
    projectSessionFromDisk: () => clone(session),
    controlledProjectAssetFile(candidate, projectPath) { return candidate && inside(candidate, path.join(projectPath, "output")) && fs.existsSync(candidate) ? fs.realpathSync(candidate) : ""; },
    resolveProjectRelativePath(projectPath, relative) { const candidate = path.resolve(projectPath, relative); return inside(candidate, projectPath) ? candidate : ""; }
  };
  function gateNextConversion() {
    let entered, release; const result = { ready: new Promise(resolve => { entered = resolve; }), release: () => release(), wait: new Promise(resolve => { release = resolve; }), entered };
    result.enter = entered; nextGate = result; return result;
  }
  async function converter(input, output, format, options) {
    conversionCalls.push(path.basename(output));
    if (nextGate) { const gate = nextGate; nextGate = null; gate.enter(); await gate.wait; }
    if (failureSource === input || failureName && path.basename(output).startsWith(failureName)) {
      failureSource = ""; failureName = ""; throw Object.assign(new Error(`fixture conversion failure '${root}'`), { code: "FIXTURE_CONVERSION_FAILED" });
    }
    return convertImageForExport(input, output, format, options);
  }
  const collections = createImageCollectionExportService({ ...ownerOptions, convertImageForExport: converter });
  const state = createExportCenterStateService(ownerOptions), handlers = new Map();
  const ipcOptions = {
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    BrowserWindow: { fromWebContents: () => null }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selectedDirectory] }) }, shell: {}, log: () => {},
    createAssetExportContext(id) { assert.equal(id, active, "admission must use the active project"); return { project: projects.find(item => item.id === id) }; },
    async materializeManagedImageAsset(item, context) {
      assert.equal(inside(item.path, path.join(context.project.path, "output")), true, "managed source required");
      return { asset: clone(item), path: item.path, extension: path.extname(item.path), mimeType: item.path.endsWith("webp") ? "image/webp" : "image/png", size: fs.statSync(item.path).size };
    },
    comparablePath: value => path.resolve(value).toLowerCase(), safeExportStem: safeStem, uniqueExportPath: uniquePath,
    releaseTransientExportSources: () => {}, retainTransientExportSource: () => {}, secureExportSourceCacheDir: () => cache,
    convertImageForExport: converter, preparePsdRasterSource, exportLayeredPsd, projectSessionFromDisk: () => clone(session),
    imageCollectionExportService: collections, exportCenterStateService: state, readJson, writeJson
  };
  registerAssetIpc(ipcOptions);
  const call = (suffix, payload = {}) => handlers.get(`naimage:asset:${suffix}`)({ sender: {} }, payload);
  const start = async payload => { const result = await call("export-managed-queue:start", { projectId: project.id, ...payload }); assert.equal(result.ok, true, result.error); return result; };
  const wait = async id => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { const result = await call("export-managed-queue:status", { projectId: project.id, queueId: id }); assert.equal(result.ok, true, result.error); if (!["queued", "running"].includes(result.status)) return result; await waitTick(); }
    throw new Error("queue did not finish");
  };
  const imageJob = (name, source = first) => ({ items: [{ asset: clone(source), suggestedName: name }] });
  const groups = [];

  const gate = gateNextConversion(), input = imageJob("frozen-alpha");
  const frozen = await start(input); await gate.ready;
  input.items[0].suggestedName = "mutated-name"; input.items[0].asset.path = webp;
  const secondClient = await call("export-managed-queue:status", { projectId: project.id, queueId: frozen.queueId });
  assert.equal(secondClient.snapshotHash, frozen.snapshotHash); assert.equal(secondClient.config.format, "original");
  const after = await start(imageJob("after-switch", second)); active = other.id;
  for (const action of ["status", "cancel", "retry-failed"]) {
    for (const [payload, code] of [[{ queueId: frozen.queueId }, "PROJECT_REQUIRED"], [{ projectId: other.id, queueId: frozen.queueId }, "PROJECT_CHANGED"]]) {
      const rejected = await call(`export-managed-queue:${action}`, payload);
      assert.equal(rejected.ok, false, `${action} must reject missing or mismatched project identity`);
      assert.equal(rejected.errorCode, code);
      assert.equal("results" in rejected || "items" in rejected || "snapshotHash" in rejected, false, "denied controls must disclose no queue details");
    }
  }
  assert.equal((await call("export-managed-queue:status", {})).errorCode, "PROJECT_REQUIRED");
  const otherList = await call("export-managed-queue:status", { projectId: other.id });
  assert.equal(otherList.ok, true); assert.deepEqual(otherList.jobs, []); assert.deepEqual(otherList.history, []);
  assert.equal((await call("export-managed-queue:status", { projectId: project.id, queueId: frozen.queueId })).status, "running");
  gate.release();
  assert.equal((await wait(frozen.queueId)).status, "succeeded"); assert.equal((await wait(after.queueId)).status, "succeeded"); active = project.id;
  assert.deepEqual(fs.readFileSync(path.join(project.path, "exports", "images", "frozen-alpha.png")), fs.readFileSync(png));
  assert.deepEqual(fs.readFileSync(path.join(project.path, "exports", "images", "after-switch.webp")), fs.readFileSync(webp));
  assert.equal(fs.existsSync(path.join(other.path, "exports")), false); groups.push("two clients, frozen config, project switching, original alpha bytes");

  failureName = "retry-fail";
  const partial = await start({ items: ["retry-success", "retry-fail", "retry-later"].map(suggestedName => ({ asset: first, suggestedName })) });
  const failed = await wait(partial.queueId); assert.equal(failed.status, "failed"); assert.equal(failed.results.filter(item => item.ok).length, 2);
  assert.equal(JSON.stringify(failed).includes(root.replace(/\\/g, "\\\\")), false, "live failures must redact paths");
  const successfulCalls = conversionCalls.filter(name => /^retry-(success|later)/.test(name)).length;
  const beforeDeniedRetry = conversionCalls.length;
  assert.equal((await call("export-managed-queue:retry-failed", { projectId: other.id, queueId: partial.queueId })).errorCode, "PROJECT_CHANGED");
  await waitTick(); assert.equal(conversionCalls.length, beforeDeniedRetry, "cross-project retry must dispatch nothing");
  assert.equal((await wait(partial.queueId)).status, "failed");
  assert.equal((await call("export-managed-queue:retry-failed", { projectId: project.id, queueId: partial.queueId })).ok, true);
  assert.equal((await wait(partial.queueId)).status, "succeeded");
  assert.equal(conversionCalls.filter(name => /^retry-(success|later)/.test(name)).length, successfulCalls);
  groups.push("partial failure retries only failed item");
  groups.push("project-bound status/cancel/retry reject missing identity and cross-project attacks without disclosure or dispatch");

  const cancellationGate = gateNextConversion(), running = await start({ items: [{ asset: first, suggestedName: "cancel-running" }, { asset: second, suggestedName: "cancel-next" }] });
  await cancellationGate.ready; const queued = await start(imageJob("cancel-queued"));
  assert.equal((await call("export-managed-queue:cancel", { projectId: project.id, queueId: queued.queueId })).status, "cancelled");
  await call("export-managed-queue:cancel", { projectId: project.id, queueId: running.queueId }); cancellationGate.release();
  assert.equal((await wait(running.queueId)).status, "cancelled");
  for (const name of ["cancel-running.png", "cancel-next.webp", "cancel-queued.png"]) assert.equal(fs.existsSync(path.join(project.path, "exports", "images", name)), false);
  groups.push("running and queued cancellation publish no incomplete files");

  const driftGate = gateNextConversion(), blocker = await start(imageJob("drift-blocker")); await driftGate.ready;
  const drift = await start(imageJob("drift-target", second)), savedSource = fs.readFileSync(webp); fs.appendFileSync(webp, "changed"); driftGate.release();
  await wait(blocker.queueId); const drifted = await wait(drift.queueId);
  assert.equal(drifted.status, "failed"); assert.equal(drifted.results[0].errorCode, "IMAGE_EXPORT_SOURCE_CHANGED");
  assert.equal(fs.existsSync(path.join(project.path, "exports", "images", "drift-target.webp")), false); fs.writeFileSync(webp, savedSource);
  groups.push("source drift fails before destination publication");

  const incrementalInput = { ...imageJob("incremental-integrity"), incremental: true };
  const incremental = await start(incrementalInput); assert.equal((await wait(incremental.queueId)).status, "succeeded");
  const unchanged = await start(incrementalInput); assert.equal((await wait(unchanged.queueId)).results[0].skipped, true);
  fs.writeFileSync(path.join(project.path, "exports", "images", "incremental-integrity.png"), "corrupted output");
  const repaired = await start(incrementalInput), repairedResult = await wait(repaired.queueId);
  assert.equal(repairedResult.status, "succeeded"); assert.equal(repairedResult.results[0].skipped, undefined);
  assert.deepEqual(fs.readFileSync(path.join(project.path, repairedResult.results[0].relativePath)), fs.readFileSync(png));
  groups.push("incremental skipping verifies the prior output hash");

  const collectionRequest = { expectedProjectId: project.id, collectionIds: [collection.id], format: "original", filenameTemplate: "{index}-{request}", conflictPolicy: "keep-both", incremental: false };
  const collectionPreview = await collections.previewCollections(collectionRequest), collectionGate = gateNextConversion();
  const collectionBlocker = await start(imageJob("group-blocker")); await collectionGate.ready;
  const collectionJob = await start({ ...collectionRequest, target: "collection", previewToken: collectionPreview.previewToken });
  session.nodes[0].title = "Renamed after admission"; session.nodes[0].imageCollection.name = "Renamed after admission"; active = other.id; collectionGate.release();
  await wait(collectionBlocker.queueId); const collectionResult = await wait(collectionJob.queueId); assert.equal(collectionResult.status, "succeeded"); active = project.id;
  const groupPath = path.join(project.path, "image-groups", "Original group"), manifest = readJson(path.join(groupPath, "image-group.json"));
  assert.equal(manifest.group.name, "Original group"); assert.deepEqual(manifest.images.map(item => item.requestIndex), [1, 3, 4]);
  assert.equal(manifest.images[2].status, "error"); assert.equal(manifest.images[0].occurrenceId, first.occurrenceId);
  assert.deepEqual(fs.readFileSync(path.join(groupPath, manifest.images[0].fileName)), fs.readFileSync(png));
  assert.deepEqual(fs.readFileSync(path.join(groupPath, manifest.images[1].fileName)), fs.readFileSync(webp));
  session.nodes[0].title = "Original group"; session.nodes[0].imageCollection.name = "Original group";
  const previousManifest = fs.readFileSync(path.join(groupPath, "image-group.json")); failureSource = webp;
  const rollbackRequest = { ...collectionRequest, conflictPolicy: "overwrite", format: "png" }, rollbackPreview = await collections.previewCollections(rollbackRequest);
  const rollback = await start({ ...rollbackRequest, target: "collection", previewToken: rollbackPreview.previewToken });
  assert.equal((await wait(rollback.queueId)).status, "failed"); assert.deepEqual(fs.readFileSync(path.join(groupPath, "image-group.json")), previousManifest);
  assert.equal(fs.readdirSync(path.dirname(groupPath)).some(name => /^\.(staging|backup)-/.test(name)), false);
  groups.push("collection frozen metadata, mixed original formats, slots, full transaction rollback");

  const zipRequest = { ...collectionRequest, conflictPolicy: "skip" }, zipPreview = await collections.previewCollections(zipRequest);
  assert.equal(zipPreview.skippedCount, 1);
  const collectionZip = await start({ ...zipRequest, target: "collection", container: "zip", previewToken: zipPreview.previewToken });
  const zipResult = await wait(collectionZip.queueId); assert.equal(zipResult.status, "succeeded");
  const archive = path.join(project.path, zipResult.results[0].relativePath), contents = zipEntries(archive);
  assert.equal(contents.size, 3); assert.equal([...contents.keys()].some(name => name.endsWith("/image-group.json")), true);
  assert.deepEqual(contents.get(`Original group/${manifest.images[0].fileName}`), fs.readFileSync(png));
  const imageZip = await start({ ...imageJob("zip-image"), container: "zip" });
  const imageZipResult = await wait(imageZip.queueId); assert.equal(imageZipResult.status, "succeeded");
  const imageContents = zipEntries(path.join(project.path, imageZipResult.results[0].relativePath));
  assert.deepEqual(imageContents.get("zip-image.png"), fs.readFileSync(png)); assert.equal(JSON.parse(imageContents.get("images.json")).images[0].occurrenceId, first.occurrenceId);
  groups.push("collection ZIP includes skipped-on-disk groups, image ZIP provenance, original alpha bytes");

  const psd = await start({ target: "psd", items: [{ nodeId: "bottom", kind: "layer-group", suggestedName: "layered" }, { nodeId: "images", kind: "asset", assetIndex: 1, suggestedName: "single-webp" }] });
  const psdResult = await wait(psd.queueId); assert.equal(psdResult.status, "succeeded", JSON.stringify(psdResult.results));
  const layered = readPsd(fs.readFileSync(path.join(project.path, "exports", "psd", "layered.psd")), { useImageData: true });
  assert.equal(layered.width, 12); assert.equal(layered.height, 8); assert.deepEqual(layered.children.map(item => item.name), ["Top", "Bottom"]);
  assert.equal(layered.children[0].imageData.data[3] > 0 && layered.children[0].imageData.data[3] < 255, true);
  assert.equal(readPsd(fs.readFileSync(path.join(project.path, "exports", "psd", "single-webp.psd")), { useImageData: true }).children.length, 1);
  groups.push("real PSD worker preserves layers, dimensions, alpha and converts single WebP");

  const authorization = await call("authorize-export-directory", { projectId: project.id }); assert.equal(authorization.ok, true);
  const external = await start({ ...imageJob("external"), authorizationId: authorization.authorizationId });
  const externalResult = await wait(external.queueId); assert.equal(externalResult.status, "succeeded"); assert.equal("path" in externalResult.results[0], false);
  assert.equal(externalResult.results[0].relativePath, undefined);
  assert.deepEqual(fs.readFileSync(path.join(delivery, "external.png")), fs.readFileSync(png));
  const externalCollectionPreview = await collections.previewCollections(collectionRequest);
  const externalCollection = await start({ ...collectionRequest, target: "collection", authorizationId: authorization.authorizationId, previewToken: externalCollectionPreview.previewToken });
  assert.equal((await wait(externalCollection.queueId)).status, "succeeded"); assert.equal(fs.existsSync(path.join(delivery, "Original group", "image-group.json")), true);
  const rejected = await call("export-managed-queue:start", { projectId: project.id, outputPath: path.join(root, "forbidden.png"), ...imageJob("forbidden") });
  assert.equal(rejected.ok, false); assert.equal(rejected.errorCode, "EXPORT_TARGET_INVALID");
  const receipt = fs.readFileSync(path.join(project.path, ".naimage", "export-jobs.json"), "utf8");
  assert.equal(receipt.includes(project.path.replace(/\\/g, "\\\\")), false); assert.equal(receipt.includes(authorization.authorizationId), false);
  assert.equal((await state.load({ expectedProjectId: project.id })).state.history.some(item => item.target === "psd"), true);
  const movedDelivery = `${delivery}-moved`; fs.renameSync(delivery, movedDelivery); fs.mkdirSync(delivery);
  const replacedDirectory = await call("export-managed-queue:start", { projectId: project.id, authorizationId: authorization.authorizationId, ...imageJob("replaced-directory") });
  assert.equal(replacedDirectory.ok, false); assert.equal(replacedDirectory.errorCode, "IMAGE_EXPORT_AUTHORIZATION_INVALID");
  fs.rmdirSync(delivery); fs.renameSync(movedDelivery, delivery);
  const linkedDirectory = path.join(root, "linked-delivery"); fs.symlinkSync(delivery, linkedDirectory, "junction"); selectedDirectory = linkedDirectory;
  assert.equal((await call("authorize-export-directory", { projectId: project.id })).ok, false); selectedDirectory = delivery;
  groups.push("Main directory authorization, all-target history and path-free receipts");

  const storedFile = path.join(project.path, ".naimage", "export-jobs.json"), stored = readJson(storedFile), prior = clone(stored.jobs[0]);
  prior.id = "interrupted-fixture"; prior.status = "running"; prior.finishedAt = undefined; prior.results = []; prior.completed = 0;
  const foreignReceipt = clone(prior); foreignReceipt.id = "foreign-project-receipt"; foreignReceipt.snapshot.projectId = other.id;
  stored.jobs.push(prior, foreignReceipt); writeJson(storedFile, stored);
  const restartedHandlers = new Map(), dispatchCount = conversionCalls.length;
  registerAssetIpc({ ...ipcOptions, ipcMain: { handle: (channel, callback) => restartedHandlers.set(channel, callback) } });
  const restored = await restartedHandlers.get("naimage:asset:export-managed-queue:status")({}, { projectId: project.id });
  assert.equal(restored.jobs.length, 0); assert.equal(restored.history.find(item => item.queueId === prior.id).status, "interrupted");
  assert.equal(restored.history.some(item => item.queueId === foreignReceipt.id), false, "history must filter receipt project ownership too");
  assert.equal(conversionCalls.length, dispatchCount); groups.push("fresh Main instance projects unfinished receipts as interrupted without replay");

  const directZip = path.join(root, "direct.zip"), aborted = new AbortController(); aborted.abort();
  await assert.rejects(writeStreamingZip(directZip, [{ name: "asset.png", filePath: png }], { signal: aborted.signal }), error => error.code === "EXPORT_CANCELLED");
  assert.equal(fs.existsSync(directZip), false);
  await assert.rejects(writeStreamingZip(directZip, [{ name: "../escape", data: "unsafe" }]));
  const statfs = fsp.statfs; fsp.statfs = async () => ({ bavail: 0, bsize: 4096 });
  try { await assert.rejects(writeStreamingZip(directZip, [{ name: "asset.png", filePath: png }]), error => error.code === "EXPORT_DISK_SPACE_INSUFFICIENT"); } finally { fsp.statfs = statfs; }
  assert.equal(fs.existsSync(directZip), false);
  const concurrent = await Promise.allSettled([writeStreamingZip(directZip, [{ name: "one", data: "first" }]), writeStreamingZip(directZip, [{ name: "two", data: "second" }])]);
  assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1); assert.equal(zipEntries(directZip).size, 1);
  await writeStreamingZip(directZip, [{ name: "replacement", data: "last" }], { overwrite: true });
  assert.equal(zipEntries(directZip).get("replacement").toString(), "last");
  assert.equal(fs.readdirSync(root).some(name => /\.tmp$/.test(name)), false);
  groups.push("streaming ZIP cancellation, traversal, disk-space preflight and atomic conflict handling");
  return { ok: true, groups, requests: { realModel: 0, realImage: 0, realVideo: 0 }, report: path.join(root, "report.json") };
}

run().then(result => { writeJson(result.report, result); process.stdout.write(`${JSON.stringify(result)}\n`); }).catch(error => {
  writeJson(path.join(root, "report.json"), { ok: false, error: error.stack || String(error) }); console.error(error); process.exitCode = 1;
});
