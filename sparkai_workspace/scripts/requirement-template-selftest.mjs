import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandRequirementTemplate, normalizeRequirementTemplate, normalizeRequirementTemplateSnapshot, normalizeRequirementTemplateDraft, reusableRequirementTemplateFromTask } from "../runtime/requirement-template-contract.mjs";

const { createRequirementLibraryService, portableRequirementTemplate, strictPortableRequirementTemplate } = createRequire(import.meta.url)("../desktop/requirement-library.cjs");
const { sanitizeSession } = createRequire(import.meta.url)("../desktop/project-session-normalizer.cjs");
const root = resolve(import.meta.dirname, ".."), diagnostic = join(root, ".diagnostics");
mkdirSync(diagnostic, { recursive: true });
const directory = mkdtempSync(join(diagnostic, "requirement-template-"));
const libraryPath = join(directory, "library.json"), exported = join(directory, "exported.json");
const report = { ok: false, checks: [], modelRequests: 0 };
let counter = 0, reads = 0, writes = 0, writeFailure = false, chosenImport = exported, canceled = false;
const io = {
  libraryPath,
  readJson: (_path, fallback) => { reads++; try { return JSON.parse(readFileSync(libraryPath, "utf8")); } catch { return fallback; } },
  writeJson: (_path, document) => { if (writeFailure) throw Object.assign(new Error("fixture denied"), { code: "EACCES" }); writes++; writeFileSync(libraryPath, JSON.stringify(document)); },
  createId: () => `reqtpl-${(++counter).toString(16).padStart(32, "0")}`,
  now: () => "2026-10-20T00:00:00.000Z",
  dialog: { showOpenDialog: async () => ({ canceled, filePaths: [chosenImport] }), showSaveDialog: async () => ({ canceled, filePath: exported }) },
  readFileSync, writeFileSync, statSync
};
const service = createRequirementLibraryService(io);
const check = async (name, action) => { await action(); report.checks.push(name); };
const reject = action => assert.throws(action, error => ["INVALID_TEMPLATE", "TEMPLATE_VARIABLE_REQUIRED"].includes(error.code));
const spec = { version: 2, scenario: "商品场景图", variables: [
  { key: "product", label: "商品", type: "text", maxLength: 80 },
  { key: "tone", label: "色调", type: "enum", options: ["暖色", "冷色"], default: "暖色" },
  { key: "count", label: "数量", type: "number", min: 1, max: 5, step: 1, default: 1 },
  { key: "source", label: "当前商品照片", type: "image", role: "source" }
], acceptance: { goal: { text: "{{product}} {{tone}}场景", source: "user" }, usage: "商品展示", slots: [{ slotId: "private-slot", label: "场景图", source: "user" }],
  preserve: [{ criterionId: "private-criterion", text: "保留商品外观", source: "user", kind: "source_consistency", slotIds: ["private-slot"], sourceVariables: ["source"] }],
  conditions: [{ text: "{{tone}}", source: "user" }], fileRules: { formats: ["png"], alpha: "forbidden" } } };
let saved, applied;
try {
  await check("v1 lazy read compatibility migrates on a successful write", () => {
    assert.equal(reads, 0);
    writeFileSync(libraryPath, JSON.stringify({ schemaVersion: 1, revision: 5, items: [{ version: 1, id: `reqtpl-${"a".repeat(32)}`, title: "旧模板", text: "保留 {{原始文字}}", revision: 2, createdAt: io.now(), updatedAt: io.now() }] }));
    assert.equal(service.list().items[0].version, 1);
    assert.equal(service.apply({ id: `reqtpl-${"a".repeat(32)}`, expectedTemplateRevision: 2 }).application.text, "保留 {{原始文字}}");
    saved = service.save({ title: "可复用场景", text: "为{{product}}生成{{count}}张{{tone}}场景，使用{{source}}。", template: spec, taskId: "private-task", path: "E:\\private\\project", inputBindings: [{ nodeId: "old-project-A", role: "source" }] });
    assert.equal(saved.entry.version, 2); assert.equal(service.list().schemaVersion, 2);
    const persisted = JSON.parse(readFileSync(libraryPath, "utf8")); assert.equal(persisted.schemaVersion, 2); assert.equal(persisted.revision, 6);
    assert.equal(persisted.items[1].taskId, undefined); assert.equal(persisted.items[1].inputBindings, undefined);
  });
  await check("declarative variables expand once with finite bounds and current-project bindings", () => {
    applied = service.apply({ id: saved.entry.id, expectedTemplateRevision: 1, variableValues: { product: "音箱" }, imageBindings: [{ key: "source", nodeId: "project-B-source", role: "source" }] });
    assert.equal(applied.application.text, "为音箱生成1张暖色场景，使用当前素材：当前商品照片。");
    assert.equal(applied.application.unboundImages.length, 0);
    assert.equal(applied.application.creationRequirements.slots[0].slotId, "template-slot-1");
    assert.equal(applied.application.creationRequirements.preserve[0].sourceTargets, undefined);
    assert.deepEqual(applied.application.creationRequirements.preserve[0].sourceVariables, ["source"]);
    reject(() => service.apply({ id: saved.entry.id, variableValues: { product: "x", count: 0 } }));
    reject(() => service.apply({ id: saved.entry.id, variableValues: { product: "x", count: 1.5 } }));
    reject(() => service.apply({ id: saved.entry.id, variableValues: { product: "x", count: "2" } }));
    reject(() => service.apply({ id: saved.entry.id, variableValues: { product: "x", tone: "随意" } }));
    reject(() => service.apply({ id: saved.entry.id, variableValues: { product: "x", unknown: "x" } }));
    reject(() => service.apply({ id: saved.entry.id, variableValues: { product: "x", source: "asset-A" } }));
    reject(() => service.apply({ id: saved.entry.id, variableValues: { product: "x" }, imageBindings: [{ key: "source", nodeId: "A", role: "reference" }] }));
    reject(() => service.apply({ id: saved.entry.id, variableValues: {} }));
    assert.equal(service.apply({ id: saved.entry.id, variableValues: { product: "{{tone}} $(literal)" } }).application.text.includes("{{tone}} $(literal)"), true);
  });
  await check("unknown variable behavior, expression syntax, oversized declarations and invalid values fail before writes", () => {
    const prior = writes;
    for (const variable of [ { key: "x", type: "script", script: "bad" }, { key: "constructor", type: "text" }, { key: "x", type: "text", shell: "bad" }, { key: "x", type: "image", default: "asset-A" }, { key: "x", type: "number", min: 4, max: 1 }, { key: "x", type: "number", step: 0 }, { key: "x", type: "text", maxLength: 2001 }, { key: "x", type: "enum", options: ["a", "a"] } ]) reject(() => normalizeRequirementTemplate({ version: 2, variables: [variable] }, "普通要求"));
    reject(() => normalizeRequirementTemplate({ version: 2, variables: [] }, "{{unknown}}"));
    reject(() => normalizeRequirementTemplate({ version: 2, variables: [] }, "{{process.exit()}}"));
    reject(() => normalizeRequirementTemplate({ version: 2, variables: Array.from({ length: 25 }, (_, index) => ({ key: `v${index}`, type: "text" })) }, "普通要求"));
    reject(() => normalizeRequirementTemplate({ version: 2, variables: [{ key: "x", type: "text" }, { key: "x", type: "text" }] }, "普通要求"));
    assert.equal(writes, prior);
  });
  await check("template drafts preserve portable acceptance and validated current-node bindings through real session normalization", () => {
    const draft = { creationRequirements: applied.application.creationRequirements, imageBindings: applied.application.imageBindings, unboundImages: applied.application.unboundImages };
    assert.deepEqual(normalizeRequirementTemplateDraft(draft), draft);
    assert.equal(normalizeRequirementTemplateDraft({ ...draft, imageBindings: [{ key: "source", nodeId: "E:\\private\\image.png", role: "source" }] }), undefined);
    assert.equal(normalizeRequirementTemplateDraft({ ...draft, imageBindings: [...draft.imageBindings, ...draft.imageBindings] }), undefined);
    assert.equal(normalizeRequirementTemplateDraft({ ...draft, sourceAssets: [{ path: "private" }] }), undefined);
    assert.equal(normalizeRequirementTemplateDraft({ ...draft, creationRequirements: { ...draft.creationRequirements, preserve: [{ ...draft.creationRequirements.preserve[0], sourceVariables: ["missing"] }] } }), undefined);
    const requirement = { version: 2, revision: 1, createdFrom: "canvas", text: applied.application.text, template: applied.application.templateSnapshot, templateDraft: draft };
    const session = { schemaVersion: 5, nodes: [{ id: "REQ", type: "requirement", title: "Applied template", prompt: requirement.text, requirement, x: 10, y: 10 }], conversations: [], messages: [] };
    const first = sanitizeSession(session), reopened = sanitizeSession(JSON.parse(JSON.stringify(first)));
    assert.deepEqual(reopened.nodes[0].requirement.template, applied.application.templateSnapshot);
    assert.deepEqual(reopened.nodes[0].requirement.templateDraft, draft);
    const forged = structuredClone(session); forged.nodes[0].requirement.templateDraft.imageBindings[0].nodeId = "https://private.invalid/image";
    assert.equal(sanitizeSession(forged).nodes[0].requirement.templateDraft, undefined);
  });
  await check("explicit task projection strips instances, paths, secrets and source-specific evidence", () => {
    const identity = { assetId: `image-${"b".repeat(32)}`, occurrenceId: `occ-${"c".repeat(32)}`, contentHash: "d".repeat(64) };
    const reusable = reusableRequirementTemplateFromTask({ title: "成功方法", text: `保留外观\napiKey=fixture-super-secret\nBearer fixture-token-secret\nE:\\private\\project\\photo.png\n${identity.assetId}\nhttps://private.invalid/signed?token=secret`, taskId: "task-private", runId: "run-private", sourcePath: "E:\\private", requirements: { goal: { text: "保留主体", source: "user" }, slots: [{ slotId: "old", label: "商品", source: "user" }], preserve: [{ criterionId: "old-test", text: "外观一致", source: "user", kind: "source_consistency", sourceTargets: [identity] }] } });
    const encoded = JSON.stringify(reusable);
    for (const forbidden of [identity.assetId, identity.occurrenceId, identity.contentHash, "fixture-super-secret", "fixture-token-secret", "E:\\\\private", "https://private", "task-private", "run-private", "sourceTargets", "sourcePath"]) assert.equal(encoded.includes(forbidden), false, forbidden);
    assert.equal(reusable.template.variables[0].type, "image");
    assert.deepEqual(reusable.template.acceptance.preserve[0].sourceVariables, ["source_1"]);
    const entry = service.saveFromTask({ ...reusable, requirements: reusable.template.acceptance });
    assert.equal(service.apply({ id: entry.entry.id }).application.unboundImages[0].key, "source_1");
  });
  await check("exact revision CAS, application snapshots and persistence survive template updates independently", () => {
    const before = structuredClone(applied.application), fingerprint = before.templateSnapshot.fingerprint;
    assert.equal(normalizeRequirementTemplateSnapshot(before.templateSnapshot).fingerprint, fingerprint);
    assert.equal(normalizeRequirementTemplateSnapshot({ ...before.templateSnapshot, variableValues: { bad: Infinity } }), undefined);
    const changed = service.save({ id: saved.entry.id, expectedRevision: 1, title: "新方法", text: "新方法：{{product}}", template: spec });
    assert.equal(changed.entry.revision, 2); assert.deepEqual(applied.application, before);
    assert.throws(() => service.apply({ id: saved.entry.id, expectedTemplateRevision: 1 }), error => error.code === "TEMPLATE_REVISION_CONFLICT");
    assert.throws(() => service.save({ id: saved.entry.id, expectedRevision: 1, text: "旧保存" }), error => error.code === "TEMPLATE_REVISION_CONFLICT");
    assert.throws(() => service.remove({ id: saved.entry.id, expectedRevision: 1, confirmed: true }), error => error.code === "TEMPLATE_REVISION_CONFLICT");
    const reopened = createRequirementLibraryService(io);
    assert.equal(reopened.get({ id: saved.entry.id }).entry.revision, 2);
    assert.notEqual(reopened.apply({ id: saved.entry.id, variableValues: { product: "音箱" } }).application.templateSnapshot.fingerprint, fingerprint);
    const original = readFileSync(libraryPath, "utf8"); writeFailure = true;
    assert.throws(() => service.save({ title: "失败写入", text: "不要改变旧库" }), error => error.code === "EACCES");
    writeFailure = false; assert.equal(readFileSync(libraryPath, "utf8"), original); assert.equal(service.list().items.some(entry => entry.title === "失败写入"), false);
  });
  await check("v1/v2 portable formats are strict and native import/export never use caller paths", async () => {
    const current = service.get({ id: saved.entry.id }).entry, portable = portableRequirementTemplate(current);
    assert.ok(strictPortableRequirementTemplate(portable));
    assert.equal(strictPortableRequirementTemplate({ ...portable, taskId: "forged" }), null);
    assert.equal(strictPortableRequirementTemplate({ ...portable, schemaVersion: 3 }), null);
    assert.equal(strictPortableRequirementTemplate({ ...portable, template: { ...portable.template, execute: "bad" } }), null);
    assert.equal(strictPortableRequirementTemplate({ ...portable, template: { ...portable.template, acceptance: { ...portable.template.acceptance, sourceTargets: [] } } }), null);
    assert.equal(strictPortableRequirementTemplate({ ...portable, text: "apiKey=private-secret" }), null);
    const output = await service.exportTemplate({ id: current.id, expectedRevision: current.revision }); assert.equal(output.fileName, "exported.json"); assert.equal(output.path, undefined);
    assert.deepEqual(JSON.parse(readFileSync(exported, "utf8")), portable);
    const imported = await service.importTemplate(); assert.notEqual(imported.entry.id, current.id); assert.equal(imported.entry.revision, 1);
    assert.deepEqual(imported.entry.template, current.template);
    const v1 = { type: "naimage-requirement-template", schemaVersion: 1, title: "简单方法", text: "保留当前主体" }; assert.ok(strictPortableRequirementTemplate(v1));
    writeFileSync(exported, JSON.stringify({ ...portable, filePath: "E:\\private" })); const prior = writes;
    await assert.rejects(service.importTemplate(), error => error.code === "IMPORT_SCHEMA_INVALID"); assert.equal(writes, prior);
    canceled = true; assert.deepEqual(await service.importTemplate(), { ok: true, canceled: true }); assert.deepEqual(await service.exportTemplate({ id: current.id, expectedRevision: current.revision }), { ok: true, canceled: true }); canceled = false;
  });
  await check("legacy social/scientific projections retain reusable structure without previous runs or data", () => {
    const social = service.save({ text: "社媒方法", socialPlan: { platform: "douyin", brief: "介绍产品", workflowId: `social-workflow-${"a".repeat(32)}`, videoTaskId: "private-task", videoNodeId: "private-node", status: "generated" } }).entry;
    assert.equal(social.socialPlan.workflowId, undefined); assert.equal(social.socialPlan.videoTaskId, undefined); assert.equal(social.socialPlan.status, "draft");
    const scientific = service.save({ text: "科研方法", scientificPlan: { schemaVersion: 1, researchClaim: "以新数据复核", backend: "python", taskId: `scientific-task-${"b".repeat(32)}`, workflowId: `scientific-workflow-${"c".repeat(32)}`, dataSources: [{ id: `scientific-data-${"d".repeat(32)}`, contentHash: "e".repeat(64), sourceName: "private-data.csv" }] } }).entry;
    assert.equal(scientific.scientificPlan.workflowId, undefined); assert.equal(scientific.scientificPlan.taskId, undefined); assert.deepEqual(scientific.scientificPlan.dataSources, []);
    assert.equal(JSON.stringify(portableRequirementTemplate(scientific)).includes("private-data"), false);
    assert.ok(strictPortableRequirementTemplate(portableRequirementTemplate(scientific)));
  });
  report.ok = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, report: join(directory, "report.json") }));
