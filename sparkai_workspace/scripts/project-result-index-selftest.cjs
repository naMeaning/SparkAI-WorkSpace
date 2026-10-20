"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const sharp = require("sharp");
const { createProjectResultIndex } = require("../desktop/project-result-index.cjs");
const { createProjectCommerceCatalogService, emptyCommerceCatalog } = require("../desktop/project-commerce-catalog.cjs");
const { createProjectCreationService } = require("../desktop/project-creation-service.cjs");
const { createImageObservationLedger, verifyObservationEvidence } = require("../runtime/image-observation-evidence.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");

const root = path.resolve(__dirname, "../.diagnostics/project-result-index", new Date().toISOString().replace(/[:.]/g, "-"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const target = asset => ({ assetId: asset.assetId, occurrenceId: asset.occurrenceId, contentHash: asset.contentHash });
const key = asset => JSON.stringify(target(asset));
const relative = (base, file) => path.relative(base, file).replace(/\\/g, "/");
const id = (prefix, index) => `${prefix}-${index.toString(16).padStart(32, "0")}`;
const report = { ok: false, realModelRequests: 0, modelCalls: 0, checks: [], benchmarks: [] };
const checkpoint = () => fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));

async function fixture(name, count, { small = false } = {}) {
  const folder = path.join(root, name), project = { id: name, path: folder, sessionPath: path.join(folder, "session.json") };
  fs.mkdirSync(path.join(folder, "assets"), { recursive: true });
  const images = await Promise.all(Array.from({ length: 8 }, (_, index) => sharp({ create: { width: 24, height: 24, channels: 3,
    background: { r: 40 + index * 20, g: 100, b: 140 } } }).png().toBuffer()));
  const nodes = [];
  for (let index = 0; index < count; index++) {
    const bytes = images[index === 1 ? 0 : index % images.length], relativePath = `assets/${index.toString().padStart(4, "0")}.png`;
    fs.writeFileSync(path.join(folder, relativePath), bytes);
    nodes.push({ id: `node-${index}`, type: "image", title: small ? ["音箱来源", "同字节第二次导入", "暖色已观察场景", "仅Prompt暖色", "视觉名称无证明", "屏幕产品", "带标签结果", "隐私测试"][index] : `作品 ${index.toString().padStart(4, "0")}`,
      status: "done", imageState: "done", x: index * 20, y: 0, prompt: index % 2 ? "暖色音箱居家场景" : "冷色音箱产品展示",
      assets: [{ assetId: `blob-${hash(bytes).slice(0, 32)}`, occurrenceId: `occ-${(index + 1).toString(16).padStart(32, "0")}`,
        contentHash: hash(bytes), relativePath, path: path.join(folder, relativePath), type: "file", status: "done", width: 24, height: 24,
        generation: { version: 1, completedAt: new Date(Date.UTC(2026, 9, 20, 0, 0, index)).toISOString() },
        ...(index === 4 ? { contentName: { displayName: "暖色音箱", source: "visual", confidence: "high" } } : {}) }] });
  }
  if (small) { nodes[6].tags = ["温馨", "首页"]; nodes[7].prompt = "apiKey=sk-fixtureabcdefgh https://example.invalid/path?token=fixture C:\\private\\fixture.png /Users/fixture/private.png"; }
  const first = nodes[0].assets[0];
  for (let index = 2; index < count; index += small ? count : 10) nodes[index].taskProvenance = {
    version: 1, taskScopeSnapshotHash: `scope-${"a".repeat(32)}`, resultPolicy: "single",
    sourceAssetId: first.assetId, sourceOccurrenceId: first.occurrenceId, sourceContentHash: first.contentHash, sourceNodeId: nodes[0].id };
  const save = value => fs.writeFileSync(project.sessionPath, JSON.stringify(sanitizeSession(value)));
  save({ nodes, conversations: [{ id: "c", messages: [] }], activeConversationId: "c", selectedNodeId: "node-5" });
  const read = () => JSON.parse(fs.readFileSync(project.sessionPath, "utf8"));
  const projects = [project], projectFor = value => projects.find(item => item.id === value) || null;
  const catalog = createProjectCommerceCatalogService({ getProjectById: projectFor, projectCommerceCatalogPath: value => path.join(value.path, ".naimage/commerce-catalog.json"),
    projectRelativePath: relative, resolveProjectRelativePath: path.resolve, projectSessionFromDisk: read, readProjectList: () => ({ projects }) });
  const creation = createProjectCreationService({ projectFor, readSession: read, catalogService: catalog, projectRelativePath: relative,
    resolveProjectRelativePath: path.resolve, verifyObservationEvidence });
  const timestamp = "2026-10-20T00:00:00.000Z", document = emptyCommerceCatalog(timestamp, id("catalog", 1));
  document.products = [0, 1].map(group => ({ productId: id("product", group + 1), title: group ? "显示器" : "音箱", revision: 1, status: "active", createdAt: timestamp, updatedAt: timestamp,
    variants: [{ variantId: id("variant", group + 1), title: group ? "黑色" : "暖白色", optionValues: [{ name: "Color", value: group ? "Black" : "Ivory" }], revision: 1, createdAt: timestamp, updatedAt: timestamp }],
    skus: [{ skuId: id("sku", group + 1), skuCode: group ? "SCREEN-01" : "SPEAKER-01", variantId: id("variant", group + 1), platforms: [], revision: 1, createdAt: timestamp, updatedAt: timestamp }],
    assets: [], platforms: [] }));
  for (const [index, node] of read().nodes.entries()) {
    if (small && index === 1) continue;
    const group = small ? index === 5 ? 1 : 0 : index % 5 === 0 ? 1 : 0, product = document.products[group], asset = node.assets[0];
    product.assets.push({ linkId: id("result", index + 1), kind: "result", ownerType: "sku", ownerId: product.skus[0].skuId,
      role: "scene", ...target(asset), relativePath: asset.relativePath, fileName: `${index}.png`, nodeId: node.id, assetIndex: 0,
      state: small ? index === 2 ? "approved" : "candidate" : index % 3 === 0 ? "approved" : "candidate", createdAt: timestamp });
  }
  catalog.writeDocument(project, document);
  const requirements = { goal: { text: "检查音箱场景", source: "user" }, usage: { text: "商品页面暖色场景", source: "user" },
    slots: [{ slotId: "hero", label: "场景图", source: "user" }],
    preserve: [{ criterionId: "identity", text: "保持来源形状", source: "user", kind: "source_consistency", sourceTargets: [target(first)] }],
    adjustable: [], conditions: [{ criterionId: "scene", text: "居家场景", source: "user", kind: "visual" }], fileRules: { width: 24, height: 24, formats: ["png"] } };
  const ref = creation.updateRequirements({ expectedProjectId: project.id, conversationId: "c", expectedRevision: 0, requirements }).requirementRef;
  const reviewedIndexes = small ? [2] : [2, 4, 6, 8].filter(index => index < count);
  for (const index of reviewedIndexes) {
    const saved = read().nodes[index].assets[0], locator = { expectedProjectId: project.id, conversationId: "c", requirementId: ref.requirementId, expectedRevision: ref.revision };
    await creation.checkResults({ ...locator, target: target(saved), slotId: "hero" });
    const ledger = createImageObservationLedger({ projectId: project.id, conversationId: "c", taskId: "", runId: "observation-run", projectRoot: folder });
    const messages = [saved, first].map(asset => {
      const file = path.join(folder, asset.relativePath), modelImage = { dataUrl: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`, sourceContentHash: asset.contentHash };
      ledger.stage({ imagePath: file, modelImage, assets: [{ ...asset, path: file }], requirementRef: ref });
      return { role: "user", content: [{ type: "input_image", image_url: modelImage.dataUrl }] };
    });
    ledger.consume(messages, { status: "completed", output: [] }, "observed-round-2");
    creation.recordReview({ ...locator, runId: "observation-run", target: target(saved), slotId: "hero", verdict: "pass", summary: "暖色木桌上的音箱居家场景",
      findings: [{ criterionId: "identity", status: "pass", note: "来源形状保留" }, { criterionId: "scene", status: "pass", note: "暖色室内背景" }],
      observationEvidence: ledger.proofFor({ target: target(saved), requirementId: ref.requirementId, expectedRequirementsRevision: ref.revision, sourceTargets: [target(first)] }) });
    ledger.close();
  }
  const options = { projectFor, readSession: read, catalogService: catalog, creationService: creation, resolveProjectRelativePath: path.resolve };
  return { project, catalog, creation, requirements, ref, options, read, save, nodes: read().nodes, folder, newIndex: () => createProjectResultIndex(options) };
}

async function check(name, run) { await run(); report.checks.push(name); checkpoint(); process.stdout.write(`ok ${report.checks.length} ${name}\n`); }
async function main() {
  fs.mkdirSync(root, { recursive: true }); checkpoint();
  const state = await fixture("contracts", 8, { small: true }), index = state.newIndex(), input = { expectedProjectId: state.project.id };
  const source = state.nodes[0].assets[0], observed = state.nodes[2].assets[0], originalSession = fs.readFileSync(state.project.sessionPath);
  const authoritativeFiles = [state.project.sessionPath, path.join(state.folder, ".naimage/commerce-catalog.json"), path.join(state.folder, ".naimage/creation.json")];
  const authoritativeHashes = authoritativeFiles.map(file => hash(fs.readFileSync(file)));
  await check("real consumed-pixel review is separate from Prompt, visual names and user labels", async () => {
    const found = await index.search({ ...input, query: { description: { text: "暖色", source: "observed" } } });
    assert.equal(found.total, 1); assert.equal(key(found.results[0].target), key(observed)); assert.equal(found.results[0].observation.status, "observed");
    assert.ok(found.results[0].matchReasons.some(reason => reason.source === "observed"));
    const intended = await index.search({ ...input, query: { description: { text: "暖色", source: "intended" } } });
    assert.ok(intended.results.some(value => value.nodeId === "node-3" && value.observation.status === "unobserved"));
    const all = await index.search(input); assert.equal(all.results.find(value => value.nodeId === "node-4").observation.status, "unobserved");
    const tagged = await index.search({ ...input, query: { text: "温馨" } }); assert.equal(tagged.total, 1); assert.ok(tagged.results[0].matchReasons.some(reason => reason.source === "user-label"));
  });
  await check("combined object, usage, exact source, adoption and observed description filters", async () => {
    const found = await index.search({ ...input, query: { usage: "商品页面", objectId: "SPEAKER-01", source: target(source), adoption: "approved", description: { text: "暖色", source: "observed" } } });
    assert.equal(found.total, 1); assert.equal(key(found.results[0].target), key(observed));
    assert.equal(found.results[0].objects.some(value => value.type === "sku"), true); assert.equal(found.results[0].objects.some(value => value.type === "variant"), true);
    assert.equal((await index.search({ ...input, query: { objectId: "SCREEN-01", description: { text: "暖色", source: "observed" } } })).total, 0);
    assert.equal((await index.search({ ...input, query: { text: "绝不存在的物体" } })).total, 0);
  });
  await check("equal image bytes keep separate occurrences and stable page ordering", async () => {
    const all = await index.search({ ...input, limit: 50, sort: "name" }); assert.equal(all.total, 8);
    const duplicateRows = all.results.filter(value => value.target.contentHash === source.contentHash);
    assert.equal(duplicateRows.length, 2); assert.equal(new Set(duplicateRows.map(value => value.target.occurrenceId)).size, 2);
    const pages = [];
    for (let offset = 0; offset < 8; offset += 3) pages.push(...(await index.search({ ...input, limit: 3, offset, sort: "name" })).results.map(value => key(value.target)));
    assert.deepEqual(pages, all.results.map(value => key(value.target))); assert.equal(new Set(pages).size, 8);
    const newest = await index.search({ ...input, sort: "newest" }); assert.equal(newest.results[0].nodeId, "node-7");
    await assert.rejects(index.search({ ...input, limit: 51 }), { code: "RESULT_QUERY_INVALID" });
    await assert.rejects(index.search({ ...input, offset: -1 }), { code: "RESULT_QUERY_INVALID" });
  });
  await check("search writes only disposable cache and preserves selection, Scope and owner documents", async () => {
    await index.search({ ...input, query: { text: "暖色" } });
    assert.deepEqual(authoritativeFiles.map(file => hash(fs.readFileSync(file))), authoritativeHashes);
    assert.deepEqual(fs.readFileSync(state.project.sessionPath), originalSession);
    const dto = JSON.stringify(await index.search(input)), cache = fs.readFileSync(path.join(state.folder, ".naimage/result-index.json"), "utf8");
    for (const value of [dto, cache]) assert.doesNotMatch(value, /sk-fixtureabcdefgh|example\.invalid|private[\\/]+fixture|"(?:path|relativePath|url|assetUrl)"|data:image|modelRoundId|observation-run/);
    const beforeReads = index.diagnostics().fileReads; await index.search(input); assert.equal(index.diagnostics().fileReads, beforeReads, "Hot metadata queries do not reread unchanged image bytes");
  });
  await check("explicit use revalidates exact targets and returns paths only to the private Main caller", async () => {
    const use = await index.resolveUse({ ...input, targets: [target(observed)] });
    assert.equal(use.materials.length, 1); assert.equal(use.materials[0].nodeId, "node-2"); assert.equal(use.materials[0].assetIndex, 0);
    assert.equal(fs.existsSync(use.materials[0].path), true); assert.deepEqual(target(use.materials[0]), target(observed));
    await assert.rejects(index.resolveUse({ ...input, targets: [target(observed), target(observed)] }), { code: "RESULT_TARGET_INVALID" });
    await assert.rejects(index.resolveUse({ ...input, targets: [{ ...target(observed), contentHash: "0".repeat(64) }] }), { code: "RESULT_TARGET_STALE" });
    await assert.rejects(index.search({ expectedProjectId: "other-project" }), { code: "PROJECT_NOT_FOUND" });
    assert.deepEqual(fs.readFileSync(state.project.sessionPath), originalSession);
  });
  await check("catalog revocation, rename and real session save/reopen invalidate projections", async () => {
    const catalog = state.catalog.list(input).catalog, product = catalog.products.find(value => value.assets.some(link => link.occurrenceId === observed.occurrenceId));
    const link = product.assets.find(value => value.occurrenceId === observed.occurrenceId);
    state.catalog.updateResultState({ ...input, expectedCatalogRevision: catalog.revision, productId: product.productId, expectedProductRevision: product.revision, linkId: link.linkId, state: "candidate" });
    assert.equal((await index.search({ ...input, query: { adoption: "approved" } })).total, 0);
    const session = state.read(); session.nodes[2].title = "人工改名成果"; session.nodes[2].assets[0].title = "人工改名成果";
    const movedPath = "assets/moved-result.png"; fs.renameSync(path.join(state.folder, observed.relativePath), path.join(state.folder, movedPath));
    session.nodes[2].assets[0].path = path.join(state.folder, movedPath); session.nodes[2].assets[0].relativePath = movedPath; observed.relativePath = movedPath;
    state.save(session);
    const renamed = await index.search({ ...input, query: { text: "人工改名成果" } }); assert.equal(renamed.total, 1); assert.equal(renamed.results[0].observation.status, "observed");
    const reopened = state.newIndex(); assert.deepEqual((await reopened.search({ ...input, query: { text: "人工改名成果" } })).results[0].target, target(observed));
    assert.equal(reopened.diagnostics().cacheLoads, 1); assert.equal(reopened.diagnostics().fileReads, 0);
  });
  await check("changed source or requirement invalidates observed description and approved status", async () => {
    const catalog = state.catalog.list(input).catalog, product = catalog.products.find(value => value.assets.some(link => link.occurrenceId === observed.occurrenceId));
    const link = product.assets.find(value => value.occurrenceId === observed.occurrenceId);
    state.catalog.updateResultState({ ...input, expectedCatalogRevision: catalog.revision, productId: product.productId, expectedProductRevision: product.revision, linkId: link.linkId, state: "approved" });
    assert.equal((await index.search({ ...input, query: { adoption: "approved" } })).total, 1);
    const sourceFile = path.join(state.folder, source.relativePath), bytes = fs.readFileSync(sourceFile);
    fs.writeFileSync(sourceFile, Buffer.concat([bytes, Buffer.from("changed")]));
    assert.equal((await index.search({ ...input, query: { description: { text: "暖色", source: "observed" } } })).total, 0);
    assert.equal((await index.search(input)).results.find(value => value.nodeId === "node-2").observation.status, "stale");
    assert.equal((await index.search({ ...input, query: { adoption: "approved" } })).total, 0);
    fs.writeFileSync(sourceFile, bytes);
    assert.equal((await index.search({ ...input, query: { description: { text: "暖色", source: "observed" } } })).total, 1);
    state.creation.updateRequirements({ ...input, conversationId: "c", expectedRevision: state.ref.revision, requirements: { ...state.requirements, usage: { text: "新的详情页", source: "user" } } });
    assert.equal((await index.search({ ...input, query: { description: { text: "暖色", source: "observed" } } })).total, 0);
    assert.equal((await index.search({ ...input, query: { adoption: "approved" } })).total, 0);
  });
  await check("file replacement, same-byte reimport and deletion cannot inherit stale evidence", async () => {
    const file = path.join(state.folder, observed.relativePath), bytes = fs.readFileSync(file); fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from("replaced")]));
    assert.equal((await index.search(input)).results.some(value => value.nodeId === "node-2"), false);
    await assert.rejects(index.resolveUse({ ...input, targets: [target(observed)] }), { code: "RESULT_TARGET_STALE" });
    fs.writeFileSync(file, bytes);
    let session = state.read(); const reimported = { ...session.nodes[2], id: "node-reimport", title: "重新导入", assets: [{ ...session.nodes[2].assets[0], occurrenceId: `occ-${"e".repeat(32)}` }] };
    delete reimported.taskProvenance; session.nodes.push(reimported); state.save(session);
    const fresh = (await index.search(input)).results.find(value => value.nodeId === "node-reimport"); assert.ok(fresh); assert.equal(fresh.observation.status, "unobserved"); assert.equal(fresh.adoption.state, "candidate");
    session = state.read(); session.nodes = session.nodes.filter(value => value.id !== "node-2"); state.save(session);
    assert.equal((await index.search(input)).results.some(value => value.nodeId === "node-2"), false);
    fs.unlinkSync(path.join(state.folder, state.nodes[3].assets[0].relativePath));
    assert.equal((await index.search(input)).results.some(value => value.nodeId === "node-3"), false);
  });
  await check("corrupt or removed index rebuilds from owners without changing them", async () => {
    const files = authoritativeFiles.map(file => hash(fs.readFileSync(file))), cacheFile = path.join(state.folder, ".naimage/result-index.json");
    fs.writeFileSync(cacheFile, "broken cache"); const rebuilt = state.newIndex();
    const first = await rebuilt.search(input); assert.ok(first.results.length > 0); assert.equal(rebuilt.diagnostics().cacheRebuilds, 1);
    assert.equal((await rebuilt.rebuild(input)).count, first.total);
    fs.unlinkSync(cacheFile); const fresh = state.newIndex(); assert.equal((await fresh.search(input)).total, first.total);
    assert.deepEqual(authoritativeFiles.map(file => hash(fs.readFileSync(file))), files);
  });
  await check("two projects with equal identities remain isolated and legacy blob links never adopt another import", async () => {
    const other = await fixture("other-project", 8, { small: true }), otherSession = other.read();
    otherSession.nodes[7].assets[0].title = "另项目专属名称"; other.save(otherSession);
    const both = createProjectResultIndex({ projectFor: value => value === state.project.id ? state.project : value === other.project.id ? other.project : null,
      readSession: value => value === state.project.id ? state.read() : other.read(), resolveProjectRelativePath: path.resolve,
      catalogService: { list: value => (value.expectedProjectId === state.project.id ? state.catalog : other.catalog).list(value),
        readDocument: (project, options) => (project.id === state.project.id ? state.catalog : other.catalog).readDocument(project, options) },
      creationService: { searchSnapshot: value => (value.expectedProjectId === state.project.id ? state.creation : other.creation).searchSnapshot(value) } });
    assert.equal((await both.search({ ...input, query: { text: "另项目专属名称" } })).total, 0);
    assert.equal((await both.search({ expectedProjectId: other.project.id, query: { text: "另项目专属名称" } })).total, 1);
    const catalog = other.catalog.readDocument(other.project), sourceLink = catalog.products[0].assets.find(value => value.occurrenceId === other.nodes[0].assets[0].occurrenceId);
    delete sourceLink.occurrenceId; sourceLink.state = "approved"; other.catalog.writeDocument(other.project, catalog);
    const rows = (await both.search({ expectedProjectId: other.project.id })).results.filter(value => value.target.contentHash === other.nodes[0].assets[0].contentHash);
    assert.equal(rows.length, 2); assert.ok(rows.every(value => value.adoption.state === "candidate"), "A blob-only legacy link is ambiguous across occurrences");
  });
  report.contractDiagnostics = index.diagnostics();
  report.conditions = { node: process.version, electron: process.versions.electron || null, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model || "", cpus: os.cpus().length, imagePixels: "24x24 PNG", concurrency: 8,
    cold: "Fresh index instance with deleted derived cache; OS filesystem cache is not cleared. Includes authoritative reads, stat, SHA-256 and projection.",
    hot: "Same live instance, authority read plus stat/fingerprint validation; no unchanged image content reread.",
    interpretation: "Local fixture timings only; no remote model, embedding, image decode during search, or semantic-accuracy claim." };
  const queries = [
    { name: "text", query: { text: "暖色" } },
    { name: "combined", query: { usage: "scene", objectId: "SPEAKER-01", adoption: "approved" } },
    { name: "observed", query: { description: { text: "暖色", source: "observed" } } },
    { name: "source", query: null },
    { name: "no-match", query: { text: "绝不存在的物体" } }
  ];
  for (const count of [100, 500, 1000]) {
    const sample = await fixture(`benchmark-${count}`, count), raw = { assets: count, metadataBytes: fs.statSync(sample.project.sessionPath).size, queries: [] };
    const scoped = { expectedProjectId: sample.project.id, limit: 20 };
    for (const spec of queries) {
      fs.rmSync(path.join(sample.folder, ".naimage/result-index.json"), { force: true });
      const engine = sample.newIndex(), query = spec.query || { source: target(sample.nodes[0].assets[0]) };
      const started = performance.now(), first = await engine.search({ ...scoped, query }); const coldMs = performance.now() - started;
      const before = engine.diagnostics(), hotMs = [];
      for (let iteration = 0; iteration < 5; iteration++) {
        const began = performance.now(), next = await engine.search({ ...scoped, query }); hotMs.push(performance.now() - began);
        assert.deepEqual(next, first);
      }
      const after = engine.diagnostics(); assert.equal(after.fileReads, before.fileReads);
      raw.queries.push({ name: spec.name, query, total: first.total, returned: first.results.length, coldMs, hotMs, coldFileReads: before.fileReads, hotFileReads: after.fileReads - before.fileReads });
    }
    report.benchmarks.push(raw); checkpoint(); process.stdout.write(`benchmark ${count}: ${raw.queries.length} fixed queries, 5 hot samples each\n`);
  }
  report.ok = true; checkpoint();
  console.log(JSON.stringify({ ok: true, checks: report.checks.length, benchmarkAssetCounts: report.benchmarks.map(value => value.assets), realModelRequests: 0, report: path.join(root, "report.json") }));
}
main().catch(error => { report.error = error.message; checkpoint(); console.error(error); process.exitCode = 1; });
