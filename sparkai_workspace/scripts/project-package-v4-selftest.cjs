"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");
const { createProjectPackageService } = require("../desktop/project-package-service.cjs");
const { createProjectKnowledgeService } = require("../desktop/project-knowledge-service.cjs");
const { registerProjectIpc } = require("../desktop/ipc/project-ipc.cjs");
const { emptyCommerceCatalog, sanitizeCommerceCatalogDocument } = require("../desktop/project-commerce-catalog.cjs");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const sha = value => createHash("sha256").update(value).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const relative = (base, file) => path.relative(base, file).replace(/\\/g, "/");
const inside = (file, base) => { const value = path.relative(path.resolve(base), path.resolve(file)); return Boolean(value && !value.startsWith("..") && !path.isAbsolute(value)); };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const timestamp = "2026-10-22T00:00:00.000Z";
const record = (root, id) => ({ id, name: id, path: path.join(root, id), sessionPath: path.join(root, id, "session.json"), createdAt: timestamp, updatedAt: timestamp });

function fixtureOwner(root, extra = {}) {
  const projects = new Map(), catalogs = new Map();
  const readSession = project => fs.existsSync(project.sessionPath) ? readJson(project.sessionPath) : { nodes: [], messages: [], conversations: [] };
  const readCatalog = project => catalogs.get(project.id) || emptyCommerceCatalog(timestamp);
  const knowledge = createProjectKnowledgeService({ projectFor: id => projects.get(id), readSession, projectRelativePath: relative,
    resolveProjectRelativePath: path.resolve, catalogService: { readDocument: readCatalog } });
  const dimensions = bytes => bytes.length >= PNG.length && bytes.subarray(0, 8).equals(PNG.subarray(0, 8)) ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
  const options = {
    assetUrlFor: file => `naimage-asset://fixture/${encodeURIComponent(file)}`,
    boundedImageRead: () => { throw new Error("v4 must not read an entire package/video through boundedImageRead"); },
    assertSafeEncodedImageDimensions: bytes => assert.deepEqual(dimensions(bytes), { width: 1, height: 1 }),
    // The native image decoder is injected here. The Electron project-io suite
    // separately exercises production nativeImage decoding and session hydration.
    detectImageFormat: bytes => dimensions(bytes) ? { extension: ".png", mimeType: "image/png" } : null,
    encodedImageDimensions: dimensions,
    nativeImage: { createFromBuffer: bytes => ({ isEmpty: () => !dimensions(bytes), getSize: () => dimensions(bytes) }) },
    comparablePath: file => path.resolve(file).toLowerCase(),
    controlledProjectAssetFile: (file, base) => {
      if (!file || !inside(file, base) || !fs.existsSync(file)) return "";
      const stats = fs.lstatSync(file);
      return stats.isFile() && !stats.isSymbolicLink() && inside(fs.realpathSync(file), fs.realpathSync(base)) ? fs.realpathSync(file) : "";
    },
    createProjectRecord: (name, target) => {
      const project = { ...record(root, `import-${randomUUID()}`), name, path: target, sessionPath: path.join(target, "session.json") };
      projects.set(project.id, project); fs.mkdirSync(target, { recursive: true }); return project;
    },
    defaultSession: { nodes: [], messages: [], conversations: [] },
    buildProjectAssetIndex: () => ({}), hydrateAssetForProject: asset => asset, isComparablePathInside: inside,
    mimeTypeForPath: file => ({ ".png": "image/png", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" })[path.extname(file).toLowerCase()] || "",
    readCommerceCatalog: readCatalog, sanitizeCommerceCatalogDocument,
    projectWritableAssetRoots: base => [path.join(base, "assets"), path.join(base, "output/imagegen"), path.join(base, "output/video"), path.join(base, ".naimage/assets")],
    projectRelativePath: relative, projectSessionFromDisk: readSession,
    resolveProjectRelativePath: (base, value) => {
      if (!value || path.isAbsolute(value) || /[\u0000:]/.test(value) || value.replace(/\\/g, "/").split("/").some(part => !part || part === "." || part === "..")) return "";
      const file = path.resolve(base, value); return inside(file, base) ? file : "";
    },
    safeName: (value, fallback = "asset") => String(value || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-"),
    sanitizeSession: clone, sessionForProjectSave: clone,
    writeCommerceCatalog: (project, catalog) => { catalogs.set(project.id, catalog); writeJson(path.join(project.path, ".naimage/commerce-catalog.json"), catalog); },
    writeJson, writeProjectManifest: (project, session) => writeJson(path.join(project.path, ".naimage/project.json"), { id: project.id, nodes: session.nodes.length }),
    exportProjectKnowledge: project => knowledge.exportPortable(project),
    importProjectKnowledge: (project, document, context) => knowledge.importPortable(project, document, context),
    validatePortableProjectKnowledge: document => knowledge.validatePortable(document),
    ...extra
  };
  return { service: createProjectPackageService(options), options, projects, catalogs, knowledge, readSession };
}

function sourceFixture(root, owner) {
  const project = record(root, "source"); owner.projects.set(project.id, project);
  const imageA = path.join(project.path, "assets/folder-a/same.png"), imageB = path.join(project.path, "assets/folder-b/same.png");
  const video = path.join(project.path, "output/video/movie.mp4");
  for (const file of [imageA, imageB, video]) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(imageA, PNG); fs.writeFileSync(imageB, PNG);
  const videoBytes = Buffer.alloc(256); videoBytes.writeUInt32BE(24, 0); videoBytes.write("ftypisom", 4); fs.writeFileSync(video, videoBytes);
  const asset = (file, occurrenceId) => ({ assetId: "asset-shared", occurrenceId, contentHash: sha(PNG), type: "file", index: 1, path: file,
    relativePath: relative(project.path, file), fileName: "same.png", displayCode: occurrenceId, importRootId: "folder-root", sourceRelativePath: `${occurrenceId}/same.png`, title: occurrenceId });
  const a = asset(imageA, "occ-one"), b = asset(imageB, "occ-two");
  const session = { nodes: [{ id: "A", type: "image", assets: [a], imageParams: { model: "gpt-image-2", prompt: "fixture", referenceImages: [b] },
      layerComposition: { previewAsset: a, mergedAsset: a, layers: [{ id: "layer-a", asset: b }] } },
    { id: "B", type: "image", assets: [b] }, { id: "V", type: "video", videoState: "ready", videoTaskId: "video-task-local-authority", videoTaskState: "running", assets: [],
      videoAsset: { assetId: "video-one", occurrenceId: "occ-video", contentHash: sha(videoBytes), type: "file", path: video, relativePath: "output/video/movie.mp4", fileName: "movie.mp4", mimeType: "video/mp4" } }],
    edges: [{ id: "edge", source: "A", target: "B", kind: "variant" }],
    messages: [{ id: "m", role: "user", content: "history", attachments: { sourceAssets: [a, b], referenceAssets: [b] } }],
    conversations: [{ id: "c", messages: [{ role: "user", content: "conversation-history" }] }], activeConversationId: "c",
    pendingAgentExecution: { taskId: "must-not-travel", taskScope: { apiKey: "synthetic-secret" } }, projectTaskContexts: [{ receiptId: "receipt-local" }],
    localConfig: { apiKey: "synthetic-secret", baseUrl: "https://fixture.invalid/", token: "synthetic-token" } };
  writeJson(project.sessionPath, session);
  const productId = `product-${"1".repeat(32)}`, variantId = `variant-${"2".repeat(32)}`, skuId = `sku-${"3".repeat(32)}`;
  owner.catalogs.set(project.id, { ...emptyCommerceCatalog(timestamp), products: [{ productId, title: "商品", revision: 1, status: "active", createdAt: timestamp, updatedAt: timestamp,
    variants: [{ variantId, title: "红色", optionValues: [], revision: 1, createdAt: timestamp, updatedAt: timestamp }],
    skus: [{ skuId, skuCode: "RED", variantId, revision: 1, createdAt: timestamp, updatedAt: timestamp }],
    assets: [{ linkId: `result-${"4".repeat(32)}`, kind: "result", ownerType: "sku", ownerId: skuId, state: "approved", role: "listing", assetId: a.assetId, occurrenceId: a.occurrenceId,
      contentHash: a.contentHash, relativePath: a.relativePath, fileName: a.fileName, nodeId: "A", assetIndex: 0, createdAt: timestamp }] }] });
  let revision = 0;
  for (const entry of [{ type: "preference", title: "本项目偏好", content: "保留真实颜色", source: "user", scope: { type: "project" }, assetRefs: [] },
    { type: "style_reference", title: "SKU采用样式", content: "沿用已采用成果", source: "user", scope: { type: "sku", productId, skuId }, assetRefs: [a] },
    { type: "preference", title: "Agent建议", content: "尝试浅色", source: "assumption", scope: { type: "variant", productId, variantId }, assetRefs: [] }]) {
    revision = owner.knowledge.save({ expectedProjectId: project.id, expectedRevision: revision, entry }).revision;
  }
  return { project, session, a, b, imageA, imageB, video, videoBytes, productId, variantId, skuId };
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function zipEntries(bytes) {
  const result = []; let cursor = 0;
  while (bytes.readUInt32LE(cursor) === 0x04034b50) {
    const size = bytes.readUInt32LE(cursor + 22), length = bytes.readUInt16LE(cursor + 26), extra = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 30, cursor + 30 + length).toString(), start = cursor + 30 + length + extra;
    result.push({ name, data: Buffer.from(bytes.subarray(start, start + size)) }); cursor = start + size;
  }
  return result;
}
function buildZip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), checksum = crc32(entry.data), local = Buffer.alloc(30), directory = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(entry.data.length, 20); directory.writeUInt32LE(entry.data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    if (entry.symlink) directory.writeUInt32LE(0xa1ff0000, 38);
    locals.push(local, name, entry.data); central.push(directory, name); offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function largeRun(root) {
  fs.mkdirSync(root, { recursive: true }); const owner = fixtureOwner(root), project = record(root, "large-source"); owner.projects.set(project.id, project);
  const file = path.join(project.path, "output/video/large.mp4"), byteLength = 160 * 1024 * 1024;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "wx"), chunk = Buffer.alloc(1024 * 1024, 0x35), hash = createHash("sha256");
  try { for (let index = 0; index < 160; index++) { if (!index) { chunk.writeUInt32BE(24, 0); chunk.write("ftypisom", 4); } fs.writeSync(fd, chunk); hash.update(chunk); } } finally { fs.closeSync(fd); }
  const contentHash = hash.digest("hex");
  writeJson(project.sessionPath, { nodes: [{ id: "V", type: "video", videoState: "ready", assets: [], videoAsset: { assetId: "large-video", occurrenceId: "large-occurrence", contentHash,
    type: "file", path: file, relativePath: "output/video/large.mp4", fileName: "large.mp4", mimeType: "video/mp4" } }], messages: [], conversations: [] });
  global.gc?.(); const baseline = process.memoryUsage(), peakBefore = process.resourceUsage().maxRSS * 1024;
  const started = performance.now(), data = owner.service.packageProject(project, { preset: "share" }), collected = performance.now();
  assert.equal(data.assets[0].data, undefined); assert.ok(Buffer.byteLength(JSON.stringify(data)) < 64 * 1024);
  const output = path.join(root, "large.naimage"), written = owner.service.writeProjectPackageFile(output, data), exported = performance.now();
  assert.ok(written.bytes > 128 * 1024 * 1024);
  const read = owner.service.readProjectPackageFile(output), opened = performance.now();
  const imported = owner.service.importProjectPackage(read, path.join(root, "large-target")), importedAt = performance.now();
  const restored = imported.session.nodes[0].videoAsset;
  assert.equal(fs.statSync(restored.path).size, byteLength); assert.equal(restored.contentHash, contentHash); assert.notEqual(imported.record.id, project.id);
  const peakRss = process.resourceUsage().maxRSS * 1024, memory = process.memoryUsage();
  assert.ok(peakRss - peakBefore < 112 * 1024 * 1024, `Streaming unexpectedly grew RSS by ${peakRss - peakBefore} bytes`);
  return { ok: true, bytes: byteLength, packageBytes: written.bytes, contentHash, pathApi: true, noBase64: true,
    ms: { collect: collected - started, write: exported - collected, openValidate: opened - exported, import: importedAt - opened, total: importedAt - started },
    memory: { baselineRss: baseline.rss, peakBeforeRss: peakBefore, peakRss, peakGrowthBytes: peakRss - peakBefore, endRss: memory.rss, endExternal: memory.external }, realModelRequests: 0 };
}

async function main() {
  if (process.argv[2] === "--large") { console.log(JSON.stringify(largeRun(path.resolve(process.argv[3])))); return; }
  const root = path.resolve(__dirname, "../.diagnostics/project-package-v4", new Date().toISOString().replace(/[:.]/g, "-")); fs.mkdirSync(root, { recursive: true });
  const owner = fixtureOwner(root), { service } = owner, source = sourceFixture(root, owner), checks = [];
  const check = (name, action) => { action(); checks.push(name); console.log(`ok ${checks.length} ${name}`); };
  const file = path.join(root, "archive.naimage"); let archive, read, imported;
  check("archive retains each occurrence and owner relationships while ZIP stores one copy per hash", () => {
    archive = service.packageProject(source.project, { preset: "archive", includeHistory: true });
    assert.equal(archive.version, 4); assert.equal(archive.projectKnowledge.entries.length, 3); assert.equal(archive.session.messages.length, 1);
    assert.ok(archive.assets.filter(asset => asset.contentHash === source.a.contentHash).length > 5);
    assert.equal(archive.assets.some(asset => Object.hasOwn(asset, "data")), false);
    assert.equal(JSON.stringify(archive).includes(source.project.path.replace(/\\/g, "\\\\")), false);
    assert.doesNotMatch(JSON.stringify(archive), /synthetic-secret|synthetic-token|must-not-travel|receipt-local|video-task-local-authority/);
    const result = service.writeProjectPackageFile(file, archive); assert.equal(result.blobs, 2); assert.equal(result.assets, archive.assets.length);
    const entries = zipEntries(fs.readFileSync(file)); assert.equal(entries.filter(entry => entry.name.startsWith("assets/")).length, 2);
    const manifest = JSON.parse(entries.find(entry => entry.name === "manifest.json").data); assert.equal(manifest.assets.length, archive.assets.length);
    read = service.readProjectPackageFile(file); assert.equal(read.assets.length, archive.assets.length); assert.equal(read.assets[0].data, undefined);
  });
  check("import receives new identities and preserves video, layers, provenance, catalog adoption and SKU knowledge", () => {
    imported = service.importProjectPackage(read, path.join(root, "imported"));
    assert.notEqual(imported.record.id, source.project.id); assert.deepEqual(imported.session.projectTaskContexts, []); assert.equal(imported.session.pendingAgentExecution, null);
    const [a, b, video] = imported.session.nodes;
    assert.deepEqual([a.assets[0].occurrenceId, b.assets[0].occurrenceId], ["occ-one", "occ-two"]);
    assert.equal(a.assets[0].path, b.assets[0].path, "same bytes restore one managed blob with two logical occurrences");
    assert.equal(a.assets[0].sourceRelativePath, "occ-one/same.png"); assert.deepEqual(imported.session.edges, source.session.edges);
    assert.equal(a.layerComposition.layers[0].asset.path, a.assets[0].path);
    assert.equal(a.layerComposition.layers[0].asset.occurrenceId, "occ-two");
    assert.equal(a.imageParams.referenceImages[0].occurrenceId, "occ-two");
    assert.deepEqual(fs.readFileSync(video.videoAsset.path), source.videoBytes); assert.ok(inside(video.videoAsset.path, imported.record.path));
    const catalog = owner.catalogs.get(imported.record.id); assert.notEqual(catalog.catalogId, read.commerceCatalog.catalogId);
    assert.equal(catalog.products[0].assets[0].state, "approved"); assert.equal(catalog.products[0].assets[0].relativePath, a.assets[0].relativePath);
    const knowledge = owner.knowledge.list({ expectedProjectId: imported.record.id, includeCommerce: false }).entries;
    assert.equal(knowledge.length, 3); assert.equal(knowledge.find(entry => entry.title === "Agent建议").source, "assumption");
    assert.equal(knowledge.find(entry => entry.title === "Agent建议").status, "suggested");
    const style = knowledge.find(entry => entry.type === "style_reference"); assert.equal(style.scope.skuId, source.skuId); assert.equal(style.assetRefs[0].occurrenceId, "occ-one");
    assert.notEqual(style.knowledgeId, read.projectKnowledge.entries.find(entry => entry.type === "style_reference").knowledgeId);
    assert.equal(JSON.stringify(knowledge).includes("taskId"), false);
  });
  check("share excludes knowledge/history and archive can explicitly omit conversation history", () => {
    const share = service.packageProject(source.project, { preset: "share", includeHistory: true });
    assert.equal(share.projectKnowledge, null); assert.deepEqual(share.session.messages, []); assert.deepEqual(share.session.conversations, []);
    assert.equal(share.commerceCatalog.products.length, 1); assert.ok(share.session.nodes[2].videoAsset.packageAssetKey);
    const withoutHistory = service.packageProject(source.project, { preset: "archive", includeHistory: false });
    assert.equal(withoutHistory.projectKnowledge.entries.length, 3); assert.deepEqual(withoutHistory.session.messages, []);
  });
  check("legacy v1-v3 JSON and old iiimage format retain their bounded import path", () => {
    for (const version of [1, 2, 3]) {
      const data = { format: version === 1 ? "iiimage-project-package" : "naimage-project-package", version,
        project: { name: `legacy-${version}` }, session: { nodes: [{ id: "old", type: "image", assets: [{ type: "file", index: 1, relativePath: "assets/old.png" }] }], messages: [] },
        assets: [{ nodeId: "old", index: 1, type: "file", path: "assets/old.png", fileName: "old.png", data: PNG.toString("base64"), contentHash: "f".repeat(64) }],
        ...(version === 3 ? { commerceCatalog: emptyCommerceCatalog(timestamp) } : {}) };
      const legacy = path.join(root, `legacy-${version}.json`); fs.writeFileSync(legacy, JSON.stringify(data));
      const parsed = service.readProjectPackageFile(legacy), result = service.importProjectPackage(parsed, path.join(root, `legacy-import-${version}`));
      assert.equal(result.session.nodes[0].assets[0].contentHash, sha(PNG)); assert.deepEqual(fs.readFileSync(result.session.nodes[0].assets[0].path), PNG);
    }
  });
  check("truncated, corrupt, hash-forged, missing, traversal, duplicate and symlink ZIP entries fail closed", () => {
    const bytes = fs.readFileSync(file), entries = zipEntries(bytes), imageIndex = entries.findIndex(entry => entry.name.startsWith("assets/"));
    const mutations = [bytes.subarray(0, bytes.length - 1)];
    const corrupt = Buffer.from(bytes); corrupt[50] ^= 0x40; mutations.push(corrupt);
    const hashForged = entries.map(entry => ({ ...entry, data: Buffer.from(entry.data) })); hashForged[imageIndex].data[hashForged[imageIndex].data.length - 1] ^= 0x40; mutations.push(buildZip(hashForged));
    mutations.push(buildZip(entries.filter((_, index) => index !== imageIndex)));
    mutations.push(buildZip([...entries, { name: "../outside.png", data: PNG }]));
    mutations.push(buildZip([...entries, entries[imageIndex]]));
    mutations.push(buildZip(entries.map((entry, index) => ({ ...entry, symlink: index === imageIndex }))));
    for (const [index, mutation] of mutations.entries()) { const bad = path.join(root, `bad-${index}.naimage`); fs.writeFileSync(bad, mutation); assert.throws(() => service.readProjectPackageFile(bad)); }
  });
  check("preflight rejects missing relations, tampered source, image corruption and insufficient disk before target creation", () => {
    const missing = service.packageProject(source.project); missing.session.nodes[0].assets[0].packageAssetKey = "missing";
    const absent = path.join(root, "must-not-exist"); assert.throws(() => service.importProjectPackage(missing, absent), { code: "NAIMAGE_PROJECT_PACKAGE_MISSING_ASSET" }); assert.equal(fs.existsSync(absent), false);
    const lowDisk = fixtureOwner(root, { availableBytesForPath: () => 1 }).service;
    assert.throws(() => lowDisk.writeProjectPackageFile(path.join(root, "no-space.naimage"), archive), { code: "NAIMAGE_PROJECT_PACKAGE_DISK_SPACE" });
    assert.throws(() => lowDisk.importProjectPackage(read, absent), { code: "NAIMAGE_PROJECT_PACKAGE_DISK_SPACE" }); assert.equal(fs.existsSync(absent), false);
    assert.equal(fs.existsSync(path.join(root, "no-space.naimage")), false);
    const broken = { format: "naimage-project-package", version: 2, project: { name: "bad-image" }, session: { nodes: [], messages: [] },
      assets: [{ path: "assets/fake.png", fileName: "fake.png", data: Buffer.from("not an image").toString("base64") }] };
    assert.throws(() => service.importProjectPackage(broken, absent), { code: "NAIMAGE_PROJECT_PACKAGE_IMAGE_INVALID" }); assert.equal(fs.existsSync(absent), false);
    const stale = service.packageProject(source.project); fs.appendFileSync(source.imageA, "changed");
    assert.throws(() => service.writeProjectPackageFile(path.join(root, "stale.naimage"), stale), { code: "NAIMAGE_PROJECT_PACKAGE_CHECKSUM" });
    fs.writeFileSync(source.imageA, PNG);
  });
  check("late knowledge-owner rejection removes the new partial project and leaves existing projects untouched", () => {
    const rejected = fixtureOwner(root, { importProjectKnowledge: () => { throw Object.assign(new Error("synthetic owner rejection"), { code: "KNOWLEDGE_PORTABLE_INVALID" }); } }).service;
    const target = path.join(root, "failed-import"); assert.throws(() => rejected.importProjectPackage(read, target), { code: "KNOWLEDGE_PORTABLE_INVALID" }); assert.equal(fs.existsSync(target), false);
    assert.throws(() => service.importProjectPackage(read, imported.record.path), { code: "NAIMAGE_PROJECT_PACKAGE_TARGET_EXISTS" }); assert.equal(fs.existsSync(imported.record.sessionPath), true);
  });
  {
    const handlers = new Map(); let choiceCalls = 0, saveCalls = 0, response = 2;
    const savedSession = fs.readFileSync(source.project.sessionPath);
    registerProjectIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      dialog: { showMessageBox: async () => { choiceCalls++; return { response }; }, showSaveDialog: async () => ({ canceled: false, filePath: path.join(root, `ipc-${++saveCalls}.naimage`) }) },
      log: () => {}, readProjectList: () => ({ activeProjectId: source.project.id, projects: [source.project] }), getActiveProject: () => source.project,
      desktopRoot: root, safeName: owner.options.safeName, packageProject: service.packageProject, writeProjectPackageFile: service.writeProjectPackageFile });
    const handler = handlers.get("naimage:project:export");
    assert.equal((await handler({}, { expectedProjectId: "other", preset: "share" })).errorCode, "PROJECT_CHANGED");
    assert.equal((await handler({}, { preset: "share", path: path.join(root, "forbidden.naimage") })).errorCode, "PROJECT_PACKAGE_OPTIONS_INVALID");
    assert.equal((await handler({}, { preset: "unsupported" })).errorCode, "PROJECT_PACKAGE_OPTIONS_INVALID");
    const shared = await handler({}, { expectedProjectId: source.project.id, preset: "share", includeHistory: true });
    assert.equal(shared.ok, true); assert.equal(shared.preset, "share"); assert.equal(shared.includeHistory, false); assert.equal(choiceCalls, 0);
    const archived = await handler({}, { expectedProjectId: source.project.id, preset: "archive", includeHistory: false });
    assert.equal(archived.ok, true); assert.equal(archived.includeHistory, false); assert.equal(choiceCalls, 0);
    const native = await handler({}); assert.equal(native.ok, true); assert.equal(native.includeHistory, true); assert.equal(choiceCalls, 1);
    response = 3; assert.equal((await handler({})).canceled, true); assert.equal(saveCalls, 3);
    assert.deepEqual(fs.readFileSync(source.project.sessionPath), savedSession);
    checks.push("Main export presets validate project/options, retain native picker and never rewrite source session");
    console.log(`ok ${checks.length} ${checks.at(-1)}`);
  }
  const child = spawnSync(process.execPath, ["--expose-gc", __filename, "--large", path.join(root, "large")], { cwd: path.resolve(__dirname, ".."), windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr || child.error?.message); const large = JSON.parse(child.stdout.trim()); checks.push("160MiB video ZIP uses path-based streaming with measured time and bounded RSS");
  const report = { ok: true, version: 4, checks, count: checks.length, large, nativeImage: "injected PNG fixture decoder; production Electron decoder covered by project-io", realModelRequests: 0,
    source: ["desktop/project-package-service.cjs", "desktop/project-knowledge-service.cjs", "desktop/ipc/project-ipc.cjs"].map(file => ({ file, sha256: sha(fs.readFileSync(path.resolve(__dirname, "..", file))) })) };
  writeJson(path.join(root, "report.json"), report); console.log(JSON.stringify({ ok: true, checks: checks.length, report: path.join(root, "report.json"), large }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
