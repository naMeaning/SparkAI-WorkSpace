"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  COMMERCE_TEMPLATE_PORTABLE_TYPE,
  CommerceTemplateLibraryError,
  createCommerceTemplateLibraryService,
  portableTemplateDocument
} = require("../desktop/commerce-template-library.cjs");

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-commerce-template-"));
const libraryPath = path.join(tempRoot, "commerce-template-library.json");
const importPath = path.join(tempRoot, "import.json");
const exportPath = path.join(tempRoot, "export.json");
let document = { schemaVersion: 1, revision: 0, items: [] };
let clock = 0;
let nextId = 0;

const service = createCommerceTemplateLibraryService({
  libraryPath,
  readJson: () => structuredClone(document),
  writeJson: (_target, value) => { document = structuredClone(value); },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [importPath] }),
    showSaveDialog: async () => ({ canceled: false, filePath: exportPath })
  },
  readFileSync,
  writeFileSync,
  statSync,
  now: () => new Date(Date.UTC(2026, 6, 31, 0, 0, clock++)).toISOString(),
  createId: () => `commerce-template-${String(++nextId).padStart(32, "0")}`
});

async function main() {
  const initial = service.list();
  assert.equal(initial.ok, true);
  assert.equal(initial.libraryRevision, 0);
  assert.deepEqual(initial.items.map((entry) => [entry.id, entry.source, entry.slotCount]), [
    ["commerce-builtin-amazon", "built-in", 7],
    ["commerce-builtin-aliexpress", "built-in", 8]
  ]);
  assert.equal(Object.hasOwn(initial.items[0], "plan"), false, "List results must stay compact");

  const amazon = service.get({ id: "commerce-builtin-amazon" }).entry;
  assert.equal(amazon.plan.platformTemplateId, "amazon");
  assert.equal(amazon.plan.saveTarget, "none");
  assert.deepEqual(amazon.plan.translationItems, []);
  assert.throws(
    () => service.remove({ id: amazon.id, expectedRevision: 1, confirmed: true }),
    (error) => error instanceof CommerceTemplateLibraryError && error.code === "BUILTIN_TEMPLATE_READ_ONLY"
  );

  const created = service.save({
    title: "夏季杯具套图",
    description: "商品主图与场景图",
    plan: {
      mode: "generate",
      platformTemplateId: "amazon",
      title: "夏季杯具套图",
      setSize: 2,
      slots: [
        { id: "hero", title: "主图", prompt: "白底且商品占画面主体。" },
        { id: "scene", title: "场景图", prompt: "真实夏季户外使用场景。" }
      ],
      targetLocales: ["en-US"],
      translationItems: [{ sourceIndex: 0, localeCode: "en-US", prompt: "不得进入模板" }],
      saveTarget: "skill",
      reusableName: "旧名称"
    }
  });
  assert.equal(created.changed, true);
  assert.equal(created.entry.source, "personal");
  assert.equal(created.entry.plan.saveTarget, "none");
  assert.equal(created.entry.plan.reusableName, "夏季杯具套图");
  assert.deepEqual(created.entry.plan.translationItems, [], "Source-specific translation cells must not enter reusable templates");
  assert.equal(document.items[0].plan.saveTarget, undefined, "Stored plans use the portable minimal shape");
  assert.equal(service.list().items.length, 3);

  assert.throws(
    () => service.save({ title: created.entry.title, plan: created.entry.plan }),
    (error) => error instanceof CommerceTemplateLibraryError &&
      error.code === "TEMPLATE_NAME_CONFLICT" &&
      error.details?.id === created.entry.id &&
      error.details?.suggestedCopyTitle === "夏季杯具套图 (2)"
  );
  const copied = service.save({
    conflictPolicy: "copy",
    title: created.entry.title,
    description: created.entry.description,
    plan: created.entry.plan
  });
  assert.equal(copied.entry.title, "夏季杯具套图 (2)");
  assert.notEqual(copied.entry.id, created.entry.id);
  assert.throws(
    () => service.save({ conflictPolicy: "overwrite", title: "不存在的同名模板", plan: created.entry.plan }),
    (error) => error instanceof CommerceTemplateLibraryError && error.code === "TEMPLATE_NAME_CONFLICT_MISSING"
  );

  assert.throws(
    () => service.save({
      id: created.entry.id,
      expectedRevision: 0,
      title: created.entry.title,
      plan: created.entry.plan
    }),
    (error) => error instanceof CommerceTemplateLibraryError && error.code === "TEMPLATE_REVISION_CONFLICT"
  );
  const updated = service.save({
    id: created.entry.id,
    expectedRevision: created.entry.revision,
    conflictPolicy: "overwrite",
    title: "夏季杯具套图 v2",
    description: created.entry.description,
    plan: { ...created.entry.plan, title: "夏季杯具套图 v2" }
  });
  assert.equal(updated.entry.revision, 2);

  const portable = portableTemplateDocument(updated.entry);
  assert.equal(portable.type, COMMERCE_TEMPLATE_PORTABLE_TYPE);
  writeFileSync(importPath, `${JSON.stringify(portable, null, 2)}\n`, "utf8");
  const imported = await service.importTemplate();
  assert.equal(imported.imported, true);
  assert.notEqual(imported.entry.id, updated.entry.id, "Import must create a new personal entry instead of overwriting silently");
  assert.equal(imported.entry.title, "夏季杯具套图 v2 (2)");

  await assert.rejects(
    () => service.exportTemplate({ id: updated.entry.id, expectedRevision: 1 }),
    (error) => error instanceof CommerceTemplateLibraryError && error.code === "TEMPLATE_REVISION_CONFLICT"
  );
  const exported = await service.exportTemplate({ id: updated.entry.id, expectedRevision: updated.entry.revision });
  assert.equal(exported.ok, true);
  const exportedDocument = JSON.parse(readFileSync(exportPath, "utf8"));
  assert.deepEqual(exportedDocument, portable);
  assert.equal(Object.hasOwn(exportedDocument.plan, "saveTarget"), false);
  assert.equal(Object.hasOwn(exportedDocument.plan, "translationItems"), false);

  writeFileSync(importPath, JSON.stringify({ ...portable, unexpected: true }), "utf8");
  await assert.rejects(
    () => service.importTemplate(),
    (error) => error instanceof CommerceTemplateLibraryError && error.code === "IMPORT_SCHEMA_INVALID"
  );

  assert.throws(
    () => service.remove({ id: updated.entry.id, expectedRevision: updated.entry.revision }),
    (error) => error instanceof CommerceTemplateLibraryError && error.code === "CONFIRMATION_REQUIRED"
  );
  const removed = service.remove({ id: updated.entry.id, expectedRevision: updated.entry.revision, confirmed: true });
  assert.equal(removed.deletedRevision, 2);
  assert.equal(service.list().items.filter((entry) => entry.source === "personal").length, 2);

  process.stdout.write(`${JSON.stringify({ ok: true, cases: 30 })}\n`);
}

main().finally(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});
