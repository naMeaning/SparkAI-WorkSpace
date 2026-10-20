"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const sharp = require("sharp");
const { createProjectKnowledgeService } = require("../desktop/project-knowledge-service.cjs");
const { createProjectCommerceCatalogService } = require("../desktop/project-commerce-catalog.cjs");
const { normalizeProjectKnowledgeSnapshot, projectKnowledgeEntryFingerprint, projectKnowledgeSnapshotFingerprint,
  projectKnowledgeReceipt, normalizeProjectKnowledgeReceipt, projectKnowledgePromptText } = require("../runtime/project-knowledge-contract.mjs");
const { normalizeProjectTaskContexts, appendProjectTaskContext, mergeProjectTaskContexts, findProjectTaskContext } = require("../runtime/project-task-contexts.mjs");

const root = path.resolve(__dirname, "../.diagnostics/project-knowledge", new Date().toISOString().replace(/[:.]/g, "-"));
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const relative = (base, file) => path.relative(base, file || "").replace(/\\/g, "/");
const checks = [], evidence = {};
function check(name, operation) { operation(); checks.push(name); console.log(`ok ${checks.length} ${name}`); }

async function main() {
  const projects = ["project-a", "project-b"].map(id => ({ id, path: path.join(root, id), sessionPath: path.join(root, id, "session.json") }));
  const sessions = new Map(projects.map(project => [project.id, { schemaVersion: 5, activeConversationId: "first", conversations: [{ id: "first" }, { id: "next" }], nodes: [] }]));
  for (const project of projects) fs.mkdirSync(path.join(project.path, "assets"), { recursive: true });
  const projectFor = id => projects.find(project => project.id === id);
  const readSession = project => sessions.get(typeof project === "string" ? project : project.id);
  const catalog = createProjectCommerceCatalogService({ getProjectById: projectFor, projectCommerceCatalogPath: project => path.join(project.path, ".naimage/commerce-catalog.json"),
    projectRelativePath: relative, resolveProjectRelativePath: path.resolve, projectSessionFromDisk: readSession, readProjectList: () => ({ projects }) });
  const options = { projectFor, readSession, catalogService: catalog, projectRelativePath: relative, resolveProjectRelativePath: path.resolve };
  let owner = createProjectKnowledgeService(options);
  const at = { expectedProjectId: projects[0].id }, other = { expectedProjectId: projects[1].id }, file = path.join(projects[0].path, ".naimage/project-knowledge.json");
  const save = entry => owner.save({ ...at, expectedRevision: owner.list({ ...at, includeCommerce: false }).revision, entry });
  const entry = (title, extra = {}) => ({ type: "preference", title, content: `${title}的长期规则`, scope: { type: "project" }, source: "user", assetRefs: [], ...extra });
  let emptySnapshot, initialSnapshot, globalEntry, suggestion, promoted;
  check("old projects read as stable empty snapshots without creating knowledge or catalog files", () => {
    emptySnapshot = owner.freezeForTask(at);
    assert.deepEqual(emptySnapshot.entries, []); assert.equal(emptySnapshot.revision, 0);
    assert.deepEqual(owner.freezeForTask(at), emptySnapshot);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(path.join(projects[0].path, ".naimage/commerce-catalog.json")), false);
    assert.deepEqual(normalizeProjectKnowledgeSnapshot(clone(emptySnapshot)), emptySnapshot);
  });
  check("explicit user knowledge crosses sessions but never projects or temporary feedback", () => {
    globalEntry = save(entry("项目长期规范", { type: "brand_rule", content: "保持暖色、清晰标识和简洁背景" })).entry;
    initialSnapshot = owner.freezeForTask({ ...at, conversationId: "first" });
    assert.equal(initialSnapshot.entries.length, 1);
    assert.deepEqual(owner.freezeForTask({ ...at, conversationId: "next", prompt: "本次临时换成蓝色" }), initialSnapshot);
    assert.deepEqual(owner.freezeForTask(other).entries, []);
    assert.throws(() => owner.list({ ...at, projectId: projects[1].id }), { code: "KNOWLEDGE_PROJECT_MISMATCH" });
    fs.mkdirSync(path.join(projects[0].path, ".naimage/memory"), { recursive: true });
    fs.writeFileSync(path.join(projects[0].path, ".naimage/memory/old-fast-memory.txt"), "把不确定的销量自动记为事实");
    assert.deepEqual(owner.freezeForTask(at), initialSnapshot, "No FastMemory is promoted by browsing or task creation");
  });
  check("Agent assumptions remain suggestions until explicit promotion", () => {
    suggestion = save(entry("建议的配色", { source: "assumption", content: "可以尝试米色背景" })).entry;
    assert.equal(suggestion.status, "suggested");
    assert.ok(!owner.freezeForTask(at).entries.some(value => value.knowledgeId === suggestion.knowledgeId));
    let revision = owner.list(at).revision;
    assert.throws(() => owner.setStatus({ ...at, expectedRevision: revision, knowledgeId: suggestion.knowledgeId, status: "active" }), { code: "KNOWLEDGE_STATUS_INVALID" });
    assert.throws(() => owner.save({ ...at, expectedRevision: revision, knowledgeId: suggestion.knowledgeId, entry: { source: "user" } }), { code: "KNOWLEDGE_SOURCE_INVALID" });
    promoted = owner.promote({ ...at, expectedRevision: revision, expectedEntryRevision: 1, knowledgeId: suggestion.knowledgeId }).entry;
    assert.equal(promoted.source, "user"); assert.equal(promoted.revision, 2);
    assert.ok(owner.freezeForTask(at).entries.some(value => value.knowledgeId === promoted.knowledgeId));
    assert.equal(owner.history({ ...at, knowledgeId: suggestion.knowledgeId }).versions[0].source, "assumption");
  });
  check("two Main instances enforce store and entry CAS, disable and deletion tombstones", () => {
    const secondOwner = createProjectKnowledgeService(options), stale = owner.list(at).revision;
    const changed = secondOwner.save({ ...at, expectedRevision: stale, knowledgeId: globalEntry.knowledgeId, expectedEntryRevision: 1,
      entry: { content: "保持暖色，Logo完整，不添加未经证实的参数" } });
    const bytes = fs.readFileSync(file);
    assert.throws(() => owner.save({ ...at, expectedRevision: stale, knowledgeId: globalEntry.knowledgeId, entry: { content: "陈旧窗口的旧内容" } }), { code: "KNOWLEDGE_REVISION_CONFLICT" });
    assert.throws(() => owner.save({ ...at, expectedRevision: changed.revision, expectedEntryRevision: 1, knowledgeId: globalEntry.knowledgeId,
      entry: { content: "陈旧单条版本" } }), { code: "KNOWLEDGE_ENTRY_CONFLICT" });
    assert.deepEqual(fs.readFileSync(file), bytes);
    const disabled = owner.setStatus({ ...at, expectedRevision: changed.revision, expectedEntryRevision: 2, knowledgeId: globalEntry.knowledgeId, status: "inactive" });
    assert.ok(!owner.freezeForTask(at).entries.some(value => value.knowledgeId === globalEntry.knowledgeId));
    const deleted = owner.setStatus({ ...at, expectedRevision: disabled.revision, knowledgeId: globalEntry.knowledgeId, status: "deleted" });
    assert.throws(() => owner.save({ ...at, expectedRevision: deleted.revision, knowledgeId: globalEntry.knowledgeId, entry: { content: "不能恢复已删除知识" } }), { code: "KNOWLEDGE_DELETED" });
    assert.equal(owner.history({ ...at, knowledgeId: globalEntry.knowledgeId }).versions.length, 4);
    assert.equal(owner.list(at).entries.some(value => value.knowledgeId === globalEntry.knowledgeId), false);
    assert.equal(owner.list({ ...at, includeDeleted: true }).entries.find(value => value.knowledgeId === globalEntry.knowledgeId).status, "deleted");
  });

  const a = projects[0], session = sessions.get(a.id);
  const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#cc9966" } }).png().toBuffer();
  const assets = [];
  for (let index = 0; index < 4; index++) {
    const relativePath = `assets/source-${index}.png`, absolutePath = path.join(a.path, relativePath);
    fs.writeFileSync(absolutePath, png);
    const asset = { assetId: `knowledge-asset-${index}`, occurrenceId: `knowledge-occ-${index}`, contentHash: hash(png), relativePath, path: absolutePath,
      fileName: `source-${index}.png`, width: 12, height: 12, type: "file", status: "done" };
    assets.push(asset); session.nodes.push({ id: `node-${index}`, type: "image", title: `素材 ${index}`, assets: [asset] });
  }
  let catalogRevision = catalog.list(at).catalogRevision;
  let speaker = catalog.saveProduct({ ...at, expectedCatalogRevision: catalogRevision, title: "便携音箱", brand: "North", productCode: "SPEAKER",
    brandStyle: { version: 1, enabled: true, colors: ["#d09050"], logoUsage: "保持Logo原始形状", visualStyle: "自然暖色光" },
    variants: [{ title: "红色", optionValues: [{ name: "颜色", value: "红色" }] }], skus: [{ skuCode: "RED-01", title: "红色音箱", variantIndex: 0 }] }).product;
  catalogRevision = catalog.list(at).catalogRevision;
  let cup = catalog.saveProduct({ ...at, expectedCatalogRevision: catalogRevision, title: "旅行杯", brand: "South", brandStyle: { version: 1, enabled: true, colors: ["#3399cc"] } }).product;
  function currentProduct(productId) { return catalog.list(at).catalog.products.find(product => product.productId === productId); }
  function assign(productId, index, extra = {}) {
    const current = currentProduct(productId);
    return catalog.assignAssets({ ...at, expectedCatalogRevision: catalog.list(at).catalogRevision, expectedProductRevision: current.revision,
      productId, kind: "master", assets: [{ nodeId: `node-${index}`, assetIndex: 0 }], ...extra });
  }
  assign(speaker.productId, 0, { ownerType: "sku", ownerId: speaker.skus[0].skuId });
  assign(cup.productId, 1);
  assign(speaker.productId, 2, { kind: "brand", role: "logo" });
  const speakerScope = { type: "product", productId: speaker.productId }, variantScope = { type: "variant", productId: speaker.productId, variantId: speaker.variants[0].variantId },
    skuScope = { type: "sku", productId: speaker.productId, skuId: speaker.skus[0].skuId };
  let productEntry, skuEntry, catalogFrozen;
  check("exact TaskScope materials select only their product, variant and SKU rules", () => {
    productEntry = save(entry("音箱专属事实", { type: "product_fact", content: "用户确认此音箱外壳为织物", scope: speakerScope })).entry;
    save(entry("红色变体规则", { content: "保持红色外壳", scope: variantScope }));
    skuEntry = save(entry("RED-01规则", { content: "不改变红色SKU标识", scope: skuScope })).entry;
    save(entry("杯子规则", { content: "只适用于旅行杯", scope: { type: "product", productId: cup.productId } }));
    const fromScope = owner.freezeForTask({ ...at, taskScope: { materials: [{ ...assets[0], role: "source" }, { ...assets[1], role: "reference" }] } });
    assert.deepEqual(fromScope.objects, [skuScope]);
    assert.ok(fromScope.entries.some(value => value.knowledgeId === productEntry.knowledgeId));
    assert.ok(fromScope.entries.some(value => value.knowledgeId === skuEntry.knowledgeId));
    assert.ok(fromScope.entries.some(value => value.title === "红色变体规则"));
    assert.ok(!fromScope.entries.some(value => value.content.includes("旅行杯")));
    const normalizedReferenceProjection = owner.freezeForTask({ ...at, taskScope: { sourceAssets: [{ ...assets[0], role: "reference" }],
      materials: [{ ...assets[0], role: "reference" }] } });
    assert.deepEqual(normalizedReferenceProjection.objects, [], "Ordinary TaskScope sourceAssets can project reference materials; their role never infers a product");
    assert.ok(!normalizedReferenceProjection.entries.some(value => value.knowledgeId === productEntry.knowledgeId));
    assert.ok(!owner.freezeForTask(at).entries.some(value => value.knowledgeId === productEntry.knowledgeId));
    assert.deepEqual(owner.freezeForTask({ ...at, sourceAssets: [{ ...assets[0], occurrenceId: assets[1].occurrenceId }] }).objects, []);
    assert.throws(() => owner.freezeForTask({ ...other, objects: [skuScope] }), { code: "KNOWLEDGE_OBJECT_NOT_FOUND" });
    assert.throws(() => owner.save({ ...at, expectedRevision: owner.list(at).revision, entry: entry("不存在的商品", { scope: { type: "product", productId: "product-missing" } }) }), { code: "KNOWLEDGE_OBJECT_NOT_FOUND" });
    const scopeOptions = owner.list(at).scopeOptions;
    assert.ok(scopeOptions.some(option => option.scope.skuId === skuScope.skuId && option.label.includes("RED-01")));
    assert.ok(scopeOptions.some(option => option.scope.variantId === variantScope.variantId && option.label.includes("红色")));
    assert.ok(scopeOptions.some(option => option.scope.productId === cup.productId && option.label.includes("旅行杯")));
    catalogFrozen = fromScope;
  });
  check("Commerce is the only mutable authority for product facts and brandStyle", () => {
    const projection = catalogFrozen.entries.filter(value => value.authority === "commerce_catalog");
    assert.ok(projection.some(value => value.type === "brand_rule" && value.content.includes("#d09050") && value.assetRefs.some(ref => ref.assetId === assets[2].assetId)));
    assert.ok(projection.some(value => value.catalogRef.field === "sku" && value.content.includes("RED-01")));
    assert.ok(projection.every(value => value.readOnly && value.catalogRef.catalogRevision && value.catalogRef.productRevision));
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /#d09050|"brandStyle"|"catalogRef"/, "Catalog fields are not copied into the knowledge authority");
    const commerceEntry = projection[0];
    assert.throws(() => owner.save({ ...at, expectedRevision: owner.list(at).revision, knowledgeId: commerceEntry.knowledgeId, entry: { content: "修改只读投影" } }), { code: "KNOWLEDGE_NOT_FOUND" });
    const current = currentProduct(speaker.productId);
    catalog.saveProduct({ ...at, expectedCatalogRevision: catalog.list(at).catalogRevision, expectedProductRevision: current.revision, ...current,
      brandStyle: { ...current.brandStyle, colors: ["#eecc99"] } });
    const newer = owner.freezeForTask({ ...at, sourceAssets: [assets[0]] });
    assert.notEqual(newer.fingerprint, catalogFrozen.fingerprint);
    assert.ok(newer.entries.some(value => value.content.includes("#eecc99")));
    assert.ok(!newer.entries.some(value => value.content.includes("#d09050")));
    evidence.commerceProjection = { frozenCatalogRevision: projection[0].catalogRef.catalogRevision,
      newerCatalogRevision: newer.entries.find(value => value.authority === "commerce_catalog").catalogRef.catalogRevision };
  });
  check("old frozen tasks survive edits and catalog changes only with their durable receipt", () => {
    const receipt = projectKnowledgeReceipt(catalogFrozen);
    owner.setTaskResolver((projectId, taskId, conversationId) => taskId === "original-task" && conversationId === "first" ? { projectKnowledge: receipt } : null);
    assert.deepEqual(owner.resolveFrozen({ ...at, taskId: "original-task", conversationId: "first", snapshot: catalogFrozen }), catalogFrozen);
    assert.throws(() => owner.resolveFrozen({ ...at, snapshot: catalogFrozen }), { code: "KNOWLEDGE_SNAPSHOT_STALE" });
    assert.throws(() => owner.resolveFrozen({ ...other, snapshot: catalogFrozen }), { code: "KNOWLEDGE_SNAPSHOT_INVALID" });
    const fake = clone(catalogFrozen); fake.entries[0].content = "未被用户保存的捏造商品事实";
    fake.entries[0].fingerprint = projectKnowledgeEntryFingerprint(fake.entries[0]);
    fake.budget.usedCharacters = fake.entries.reduce((total, value) => total + value.title.length + value.content.length, 0);
    fake.fingerprint = projectKnowledgeSnapshotFingerprint(fake);
    assert.ok(normalizeProjectKnowledgeSnapshot(fake), "Even a correctly checksummed fabricated payload is not owner authority");
    assert.throws(() => owner.resolveFrozen({ ...at, taskId: "original-task", conversationId: "first", snapshot: fake }), { code: "KNOWLEDGE_SNAPSHOT_STALE" });
    const deletedReceipt = projectKnowledgeReceipt(initialSnapshot);
    owner.setTaskResolver(() => ({ projectKnowledge: deletedReceipt }));
    assert.deepEqual(owner.resolveFrozen({ ...at, taskId: "old-deleted-task", snapshot: initialSnapshot }), initialSnapshot);
  });
  let styleEntry;
  check("baseline references require adopted exact occurrences and expire on revoke, bytes or deletion", () => {
    assert.throws(() => save(entry("风格基准", { type: "style_reference", assetRefs: [assets[3]] })), { code: "KNOWLEDGE_ASSET_STALE" });
    let assigned = assign(speaker.productId, 3, { kind: "result", role: "scene" });
    const link = assigned.product.assets.find(value => value.assetId === assets[3].assetId && value.kind === "result");
    catalog.updateResultState({ ...at, expectedCatalogRevision: assigned.catalogRevision, expectedProductRevision: assigned.product.revision,
      productId: speaker.productId, linkId: link.linkId, state: "approved" });
    styleEntry = save(entry("已采用暖色基准", { type: "style_reference", content: "沿用这个已采用场景的柔和暖光", assetRefs: [assets[3]] })).entry;
    assert.ok(owner.freezeForTask(at).entries.some(value => value.knowledgeId === styleEntry.knowledgeId));
    fs.writeFileSync(assets[3].path, Buffer.from("replaced image bytes"));
    assert.ok(!owner.freezeForTask(at).entries.some(value => value.knowledgeId === styleEntry.knowledgeId));
    fs.writeFileSync(assets[3].path, png);
    const current = currentProduct(speaker.productId);
    catalog.updateResultState({ ...at, expectedCatalogRevision: catalog.list(at).catalogRevision, expectedProductRevision: current.revision,
      productId: speaker.productId, linkId: link.linkId, state: "candidate" });
    assert.ok(!owner.freezeForTask(at).entries.some(value => value.knowledgeId === styleEntry.knowledgeId));
    assert.ok(owner.list(at).entries.find(value => value.knowledgeId === styleEntry.knowledgeId).invalidReasons.includes("reference_not_adopted"));
    assert.throws(() => save(entry("伪造出现身份", { assetRefs: [{ ...assets[2], occurrenceId: "wrong-occurrence" }] })), { code: "KNOWLEDGE_ASSET_STALE" });
  });
  check("bounded selection is deterministic and prompt separates explicit requests, facts and experience", () => {
    for (let index = 0; index < 28; index++) save(entry(`长期偏好${index}`, { content: `Preference ${index}: ` + "A".repeat(750) }));
    const frozen = owner.freezeForTask(at), repeated = owner.freezeForTask({ ...at, conversationId: "next" });
    assert.deepEqual(repeated, frozen); assert.ok(frozen.entries.length <= 24);
    assert.ok(frozen.budget.usedCharacters <= 12_000); assert.ok(frozen.budget.omittedEntries > 0);
    const text = projectKnowledgePromptText(frozen);
    assert.match(text, /本次明确要求 > 项目长期偏好 > 当前会话经验/);
    assert.match(text, /ask_user/); assert.doesNotMatch(text, /knowledge-[a-f0-9-]+|commerce:|project-a|[a-z]:\\/i);
    const receipt = projectKnowledgeReceipt(frozen);
    assert.deepEqual(normalizeProjectKnowledgeReceipt(clone(receipt)), receipt);
    assert.ok(!Object.hasOwn(receipt.entries[0], "content"));
    assert.ok(!Object.hasOwn(receipt.entries[0], "title"));
    evidence.budget = frozen.budget;
  });
  check("full immutable contexts persist, merge stale sessions and never restore another conversation", () => {
    const current = owner.freezeForTask(at), first = { version: 1, projectId: a.id, conversationId: "first", taskId: "task-first", createdAt: "2026-10-20T00:00:00.000Z", fingerprint: initialSnapshot.fingerprint, projectKnowledge: initialSnapshot },
      next = { version: 1, projectId: a.id, conversationId: "next", taskId: "task-next", createdAt: "2026-10-20T01:00:00.000Z", fingerprint: current.fingerprint, projectKnowledge: current };
    const one = appendProjectTaskContext(undefined, first), both = mergeProjectTaskContexts(one, appendProjectTaskContext([], next));
    const reopened = normalizeProjectTaskContexts(JSON.parse(JSON.stringify(both)), { expectedProjectId: a.id });
    assert.equal(reopened.length, 2);
    assert.deepEqual(findProjectTaskContext(reopened, { projectId: a.id, conversationId: "first", taskId: "task-first" }).projectKnowledge, initialSnapshot);
    assert.equal(findProjectTaskContext(reopened, { projectId: a.id, conversationId: "next", taskId: "task-first" }), undefined);
    assert.deepEqual(mergeProjectTaskContexts(reopened, one), reopened, "Stale renderer cannot remove a newer task context");
    assert.throws(() => appendProjectTaskContext(reopened, { ...first, fingerprint: current.fingerprint, projectKnowledge: current }), { code: "PROJECT_TASK_CONTEXT_CONFLICT" });
    assert.equal(normalizeProjectTaskContexts([first], { expectedProjectId: projects[1].id }), undefined);
    assert.equal(normalizeProjectTaskContexts([{ ...first, conversationId: undefined }]), undefined);
    assert.deepEqual(normalizeProjectTaskContexts(undefined), []);
    session.projectTaskContexts = reopened;
    fs.writeFileSync(a.sessionPath, JSON.stringify(session));
    assert.deepEqual(JSON.parse(fs.readFileSync(a.sessionPath, "utf8")).projectTaskContexts, reopened);
  });
  check("writes fsync before atomic rename and preserve real serialization/fs errors", () => {
    const order = [];
    const observed = createProjectKnowledgeService({ ...options, fileSystem: { ...fs,
      fsyncSync(fd) { order.push("fsync"); return fs.fsyncSync(fd); }, renameSync(from, to) { order.push("rename"); return fs.renameSync(from, to); } } });
    observed.save({ ...at, expectedRevision: owner.list(at).revision, entry: entry("原子保存证明") });
    assert.deepEqual(order, ["fsync", "rename"]);
    const before = fs.readFileSync(file), revision = owner.list(at).revision;
    const blocked = createProjectKnowledgeService({ ...options, fileSystem: { ...fs, fsyncSync() { throw Object.assign(new Error("synthetic fsync denied"), { code: "EACCES" }); } } });
    assert.throws(() => blocked.save({ ...at, expectedRevision: revision, entry: entry("写入失败") }), { code: "EACCES", knowledgePersistenceFailed: true, phase: "knowledge_save" });
    assert.deepEqual(fs.readFileSync(file), before);
    const serialization = createProjectKnowledgeService({ ...options, now: () => 1n });
    assert.throws(() => serialization.save({ ...at, expectedRevision: revision, entry: entry("序列化失败") }), { name: "TypeError", knowledgePersistenceFailed: true, phase: "knowledge_save" });
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.endsWith(".tmp")), false);
    evidence.atomicWrite = { order, unchangedOnFsyncError: true, unchangedOnSerializationError: true };
  });
  check("stored knowledge reopens in a fresh process and rejects corrupt or cross-project stores", () => {
    const expected = owner.freezeForTask(at), script = `
      const fs=require('node:fs'),path=require('node:path');
      const {createProjectKnowledgeService}=require('./desktop/project-knowledge-service.cjs');
      const project=JSON.parse(process.env.KNOWLEDGE_FIXTURE_PROJECT);
      const owner=createProjectKnowledgeService({projectFor:id=>id===project.id?project:null,readSession:()=>JSON.parse(fs.readFileSync(project.sessionPath,'utf8')),
      projectRelativePath:(base,file)=>path.relative(base,file).replaceAll('\\\\','/'),resolveProjectRelativePath:path.resolve});
      console.log(JSON.stringify(owner.freezeForTask({expectedProjectId:project.id})));`;
    const child = spawnSync(process.execPath, ["-e", script], { cwd: path.resolve(__dirname, ".."), windowsHide: true, encoding: "utf8",
      env: { ...process.env, KNOWLEDGE_FIXTURE_PROJECT: JSON.stringify(a) } });
    assert.equal(child.status, 0, child.stderr);
    // The revoked style baseline is unavailable both with and without Catalog;
    // project-wide rules have no implicit dependency on a new process's session.
    assert.deepEqual(JSON.parse(child.stdout), expected);
    const before = fs.readFileSync(file); fs.writeFileSync(file, '{"schemaVersion":1,"projectId":"wrong","revision":0,"history":[]}');
    assert.throws(() => owner.list(at), { code: "KNOWLEDGE_STORE_INVALID" });
    assert.throws(() => owner.save({ ...at, expectedRevision: 0, entry: entry("不能覆盖损坏记录") }), { code: "KNOWLEDGE_STORE_INVALID" });
    fs.writeFileSync(file, before);
    assert.deepEqual(owner.freezeForTask(at), expected);
    evidence.freshProcess = { exitCode: child.status, fingerprint: expected.fingerprint };
  });
  check("public knowledge text and DTOs exclude credentials and private locators", () => {
    const saved = save(entry("已脱敏说明", { content: "apiKey=sk-synthetic1234567890abc https://fixture.invalid/private C:\\private\\brand.png" }));
    const publicJson = JSON.stringify(saved.entry);
    assert.doesNotMatch(publicJson, /sk-synthetic|fixture\.invalid|private\\\\brand/);
    assert.ok(!Object.hasOwn(saved.entry.assetRefs[0] || {}, "path"));
    assert.ok(!Object.hasOwn(saved.entry, "runId"));
  });
  const report = { ok: true, at: new Date().toISOString(), checks, count: checks.length, realModelRequests: 0, evidence,
    source: ["desktop/project-knowledge-service.cjs", "runtime/project-knowledge-contract.mjs", "runtime/project-task-contexts.mjs"].map(file =>
      ({ file, sha256: hash(fs.readFileSync(path.resolve(__dirname, "..", file))) })) };
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, realModelRequests: 0, report: path.join(root, "report.json") }));
}
main().catch(error => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, "failure.txt"), error.stack || String(error)); console.error(error); process.exitCode = 1; });
