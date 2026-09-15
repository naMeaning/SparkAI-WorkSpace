"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const {
  CommerceCatalogError,
  createProjectCommerceCatalogService
} = require("../desktop/project-commerce-catalog.cjs");
const commerceCatalogSchema = require("../plugins/commerce-catalog-schema.json");

const root = mkdtempSync(path.join(os.tmpdir(), "naimage-commerce-catalog-"));
const project = {
  id: "project-a",
  name: "Catalog test",
  path: path.join(root, "project"),
  sessionPath: path.join(root, "project", "session.json")
};
mkdirSync(path.join(project.path, ".naimage"), { recursive: true });
mkdirSync(path.join(project.path, "assets", "imports"), { recursive: true });
writeFileSync(path.join(project.path, "assets", "imports", "a.png"), "managed-master-image");
writeFileSync(path.join(project.path, "assets", "imports", "hash-mismatch.png"), "managed-but-changed");

let idSequence = 0;
const allocateId = (prefix) => {
  idSequence += 1;
  return `${prefix}-${idSequence.toString(16).padStart(32, "0")}`;
};
const session = {
  nodes: [{
    id: "IMAGE_A",
    type: "image",
    assets: [{
      type: "file",
      status: "done",
      assetId: "asset-a",
      contentHash: sha256("managed-master-image"),
      relativePath: "assets/imports/a.png",
      fileName: "a.png",
      width: 1200,
      height: 1200
    }]
  }, {
    id: "IMAGE_UNMANAGED",
    type: "image",
    assets: [{
      type: "file",
      status: "done",
      assetId: "asset-b",
      contentHash: "b".repeat(64),
      relativePath: "../outside.png",
      fileName: "outside.png"
    }]
  }, {
    id: "IMAGE_MISSING",
    type: "image",
    assets: [{
      type: "file",
      status: "done",
      assetId: "asset-c",
      contentHash: "c".repeat(64),
      relativePath: "assets/imports/missing.png",
      fileName: "missing.png"
    }]
  }, {
    id: "IMAGE_HASH_MISMATCH",
    type: "image",
    assets: [{
      type: "file",
      status: "done",
      assetId: "asset-d",
      contentHash: sha256("different-content"),
      relativePath: "assets/imports/hash-mismatch.png",
      fileName: "hash-mismatch.png"
    }]
  }]
};

const service = createProjectCommerceCatalogService({
  getProjectById: (id) => id === project.id ? project : null,
  projectCommerceCatalogPath: (record) => path.join(record.path, ".naimage", "commerce-catalog.json"),
  projectRelativePath: (projectPath, filePath) => {
    const relative = path.relative(projectPath, String(filePath || ""));
    return relative.startsWith("..") || path.isAbsolute(relative) ? "" : relative.replace(/\\/g, "/");
  },
  resolveProjectRelativePath: (projectPath, relativePath) => {
    const resolved = path.resolve(projectPath, relativePath);
    const relative = path.relative(projectPath, resolved);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : "";
  },
  projectSessionFromDisk: () => session,
  readProjectList: () => ({ activeProjectId: project.id, projects: [project] }),
  now: (() => {
    let tick = 0;
    return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  })(),
  allocateId
});

try {
  const initial = service.list({ expectedProjectId: project.id });
  assert.equal(initial.ok, true);
  assert.equal(initial.catalogRevision, 0);
  assert.match(initial.catalog.catalogId, /^catalog-[a-f0-9]{32}$/);

  const created = service.saveProduct({
    expectedProjectId: project.id,
    expectedCatalogRevision: 0,
    title: "Travel mug",
    productCode: "SPU-001",
    brand: "North",
    brandStyle: {
      enabled: true,
      fontFamily: "Inter, Arial, sans-serif",
      colors: ["#0B1F33", "#F4C430"],
      logoUsage: "",
      modelAppearance: "Use the same adult model identity across the complete listing set.",
      productAppearance: "Keep the mug body, lid geometry, finish, and printed markings unchanged.",
      visualStyle: "Clean premium product photography with restrained typography."
    },
    platforms: ["amazon", "aliexpress", "unknown"],
    variants: [{ title: "Black / 500ml", optionValues: [{ name: "Color", value: "Black" }, { name: "Size", value: "500ml" }] }],
    skus: [{ skuCode: "MUG-BLK-500", title: "Black 500ml", platforms: ["amazon"], variantIndex: 0 }]
  });
  assert.equal(created.catalogRevision, 1);
  assert.equal(created.product.variants.length, 1);
  assert.equal(created.product.skus.length, 1);
  assert.deepEqual(created.product.platforms, ["amazon", "aliexpress"]);
  assert.deepEqual(created.product.brandStyle, {
    version: 1,
    enabled: true,
    fontFamily: "Inter, Arial, sans-serif",
    colors: ["#0b1f33", "#f4c430"],
    logoUsage: commerceCatalogSchema.brandStyle.defaultLogoUsage,
    modelAppearance: "Use the same adult model identity across the complete listing set.",
    productAppearance: "Keep the mug body, lid geometry, finish, and printed markings unchanged.",
    visualStyle: "Clean premium product photography with restrained typography."
  }, "Brand style must be canonicalized and persisted with the product aggregate");

  assert.throws(() => service.saveProduct({
    expectedProjectId: project.id,
    expectedCatalogRevision: 1,
    productId: created.product.productId,
    expectedProductRevision: created.product.revision,
    title: created.product.title,
    brandStyle: { enabled: true, colors: ["#0b1f33", "#0B1F33"] },
    variants: created.product.variants,
    skus: created.product.skus
  }), (error) => error instanceof CommerceCatalogError && error.code === "INVALID_BRAND_STYLE",
  "Duplicate normalized brand colors must fail without changing Catalog revisions");

  assert.throws(() => service.saveProduct({
    expectedProjectId: project.id,
    expectedCatalogRevision: 0,
    productId: created.product.productId,
    expectedProductRevision: created.product.revision,
    title: "Stale"
  }), (error) => error instanceof CommerceCatalogError && error.code === "CATALOG_REVISION_CONFLICT");

  const assigned = service.assignAssets({
    expectedProjectId: project.id,
    expectedCatalogRevision: 1,
    productId: created.product.productId,
    expectedProductRevision: created.product.revision,
    kind: "master",
    ownerType: "sku",
    ownerId: created.product.skus[0].skuId,
    role: "primary",
    assets: [{ nodeId: "IMAGE_A", assetIndex: 0 }]
  });
  assert.equal(assigned.catalogRevision, 2);
  assert.equal(assigned.product.assets.length, 1);
  assert.equal(assigned.product.assets[0].relativePath, "assets/imports/a.png");
  assert.equal(Object.hasOwn(assigned.product.assets[0], "path"), false);

  const duplicate = service.assignAssets({
    expectedProjectId: project.id,
    expectedCatalogRevision: 2,
    productId: created.product.productId,
    expectedProductRevision: assigned.product.revision,
    kind: "master",
    ownerType: "sku",
    ownerId: created.product.skus[0].skuId,
    role: "primary",
    assets: [{ nodeId: "IMAGE_A", assetIndex: 0 }]
  });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.catalogRevision, 2);

  mkdirSync(path.join(project.path, "output", "imagegen"), { recursive: true });
  writeFileSync(path.join(project.path, "output", "imagegen", "result-1.png"), "managed-commerce-result");
  const taskScopeSnapshotHash = `scope-${"c".repeat(32)}`;
  const commercePlanHash = `commerce-${"d".repeat(32)}`;
  const commerceResultKey = `commerce-result-${"e".repeat(32)}`;
  const frozenTarget = {
    bindingId: "binding-image-a",
    catalogId: initial.catalog.catalogId,
    catalogRevision: 2,
    productId: created.product.productId,
    productRevision: assigned.product.revision,
    ownerType: "sku",
    ownerId: created.product.skus[0].skuId,
    sourceLinkId: assigned.product.assets[0].linkId
  };
  session.nodes.push({
    id: "RESULT_1",
    type: "image",
    imageState: "done",
    parentId: "IMAGE_A",
    taskProvenance: {
      version: 1,
      taskScopeSnapshotHash,
      resultPolicy: "grouped-by-container",
      sourceBindingId: frozenTarget.bindingId,
      sourceAssetId: "asset-a",
      sourceNodeId: "IMAGE_A",
      commercePlanHash,
      commerceSlotId: "amazon-main",
      commerceSlotIndex: 0,
      commerceLocaleCode: "en-US",
      commerceCatalogTarget: frozenTarget,
      commerceResultKey
    },
    assets: [{
      type: "file",
      status: "done",
      assetId: "asset-result-1",
      contentHash: sha256("managed-commerce-result"),
      relativePath: "output/imagegen/result-1.png",
      fileName: "result-1.png",
      width: 1200,
      height: 1200
    }]
  });
  const reconciled = service.reconcileGoalResults({
    expectedProjectId: project.id,
    taskScopeSnapshotHash
  });
  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.catalogRevision, 3);
  assert.deepEqual(reconciled.details, { scanned: 1, added: 1, existing: 0 });
  const reconciledProduct = reconciled.catalog.products.find((product) => product.productId === created.product.productId);
  const resultLink = reconciledProduct.assets.find((link) => link.commerceResultKey === commerceResultKey);
  assert.equal(resultLink.ownerId, created.product.skus[0].skuId);
  assert.equal(resultLink.role, "main");
  assert.equal(resultLink.sourceLinkId, assigned.product.assets[0].linkId);
  assert.equal(resultLink.taskScopeSnapshotHash, taskScopeSnapshotHash);
  assert.equal(resultLink.commerceLocaleCode, "en-US");

  const replayed = service.reconcileGoalResults({ expectedProjectId: project.id, taskScopeSnapshotHash });
  assert.equal(replayed.changed, false);
  assert.deepEqual(replayed.details, { scanned: 1, added: 0, existing: 1 });

  writeFileSync(path.join(project.path, "output", "imagegen", "result-2.png"), "managed-commerce-result-2");
  session.nodes.push({
    ...session.nodes.at(-1),
    id: "RESULT_2",
    taskProvenance: {
      ...session.nodes.at(-1).taskProvenance,
      commerceSlotId: "amazon-detail",
      commerceSlotIndex: 1,
      commerceResultKey: `commerce-result-${"1".repeat(32)}`
    },
    assets: [{
      ...session.nodes.at(-1).assets[0],
      assetId: "asset-result-2",
      contentHash: sha256("managed-commerce-result-2"),
      relativePath: "output/imagegen/result-2.png",
      fileName: "result-2.png"
    }]
  });
  const catalogBeforeConflict = readFileSync(path.join(project.path, ".naimage", "commerce-catalog.json"), "utf8");
  assert.throws(() => service.reconcileGoalResults({ expectedProjectId: project.id, taskScopeSnapshotHash }), (error) => (
    error instanceof CommerceCatalogError && error.code === "CATALOG_REVISION_CONFLICT"
  ));
  assert.equal(readFileSync(path.join(project.path, ".naimage", "commerce-catalog.json"), "utf8"), catalogBeforeConflict);
  session.nodes.pop();

  assert.throws(() => service.assignAssets({
    expectedProjectId: project.id,
    expectedCatalogRevision: 3,
    productId: created.product.productId,
    expectedProductRevision: reconciledProduct.revision,
    kind: "brand",
    ownerType: "product",
    assets: [{ nodeId: "IMAGE_UNMANAGED", assetIndex: 0 }]
  }), (error) => error instanceof CommerceCatalogError && error.code === "ASSET_NOT_MANAGED");

  assert.throws(() => service.assignAssets({
    expectedProjectId: project.id,
    expectedCatalogRevision: 3,
    productId: created.product.productId,
    expectedProductRevision: reconciledProduct.revision,
    kind: "brand",
    ownerType: "product",
    assets: [{ nodeId: "IMAGE_MISSING", assetIndex: 0 }]
  }), (error) => error instanceof CommerceCatalogError && error.code === "ASSET_NOT_MANAGED");

  assert.throws(() => service.assignAssets({
    expectedProjectId: project.id,
    expectedCatalogRevision: 3,
    productId: created.product.productId,
    expectedProductRevision: reconciledProduct.revision,
    kind: "brand",
    ownerType: "product",
    assets: [{ nodeId: "IMAGE_HASH_MISMATCH", assetIndex: 0 }]
  }), (error) => error instanceof CommerceCatalogError && error.code === "ASSET_HASH_MISMATCH");

  assert.throws(() => service.saveProduct({
    expectedProjectId: project.id,
    expectedCatalogRevision: 3,
    productId: created.product.productId,
    expectedProductRevision: reconciledProduct.revision,
    title: "Travel mug",
    variants: created.product.variants,
    skus: []
  }), (error) => error instanceof CommerceCatalogError && error.code === "ASSET_OWNER_IN_USE");

  const removed = service.removeAsset({
    expectedProjectId: project.id,
    expectedCatalogRevision: 3,
    productId: created.product.productId,
    expectedProductRevision: reconciledProduct.revision,
    linkId: assigned.product.assets[0].linkId
  });
  assert.equal(removed.catalogRevision, 4);
  assert.equal(removed.product.assets.length, 1);

  const removedResult = service.removeAsset({
    expectedProjectId: project.id,
    expectedCatalogRevision: 4,
    productId: created.product.productId,
    expectedProductRevision: removed.product.revision,
    linkId: resultLink.linkId
  });
  assert.equal(removedResult.catalogRevision, 5);
  assert.equal(removedResult.product.assets.length, 0);

  const archived = service.archiveProduct({
    expectedProjectId: project.id,
    expectedCatalogRevision: 5,
    productId: created.product.productId,
    expectedProductRevision: removedResult.product.revision,
    archived: true
  });
  assert.equal(archived.product.status, "archived");
  assert.equal(archived.catalogRevision, 6);

  // A Goal may target multiple Products. The service must validate the whole
  // batch before replacing one catalog document, and replaying the same
  // session must be a no-op keyed by commerceResultKey.
  const multiProject = {
    id: "project-multi",
    name: "Multi product catalog test",
    path: path.join(root, "multi-project"),
    sessionPath: path.join(root, "multi-project", "session.json")
  };
  mkdirSync(path.join(multiProject.path, ".naimage"), { recursive: true });
  mkdirSync(path.join(multiProject.path, "assets", "imports"), { recursive: true });
  mkdirSync(path.join(multiProject.path, "output", "imagegen"), { recursive: true });
  writeFileSync(path.join(multiProject.path, "assets", "imports", "source-a.png"), "multi-source-a");
  writeFileSync(path.join(multiProject.path, "assets", "imports", "source-b.png"), "multi-source-b");
  const multiSession = {
    nodes: [{
      id: "SOURCE_A",
      type: "image",
      assets: [{
        type: "file",
        status: "done",
        assetId: "multi-source-a",
        contentHash: sha256("multi-source-a"),
        relativePath: "assets/imports/source-a.png",
        fileName: "source-a.png"
      }]
    }, {
      id: "SOURCE_B",
      type: "image",
      assets: [{
        type: "file",
        status: "done",
        assetId: "multi-source-b",
        contentHash: sha256("multi-source-b"),
        relativePath: "assets/imports/source-b.png",
        fileName: "source-b.png"
      }]
    }]
  };
  const multiService = createProjectCommerceCatalogService({
    getProjectById: (id) => id === multiProject.id ? multiProject : null,
    projectCommerceCatalogPath: (record) => path.join(record.path, ".naimage", "commerce-catalog.json"),
    projectRelativePath: (projectPath, filePath) => {
      const relative = path.relative(projectPath, String(filePath || ""));
      return relative.startsWith("..") || path.isAbsolute(relative) ? "" : relative.replace(/\\/g, "/");
    },
    resolveProjectRelativePath: (projectPath, relativePath) => {
      const resolved = path.resolve(projectPath, relativePath);
      const relative = path.relative(projectPath, resolved);
      return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : "";
    },
    projectSessionFromDisk: () => multiSession,
    readProjectList: () => ({ activeProjectId: multiProject.id, projects: [multiProject] }),
    now: (() => {
      let tick = 100;
      return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
    })(),
    allocateId
  });
  const multiInitial = multiService.list({ expectedProjectId: multiProject.id });
  const multiProductA = multiService.saveProduct({
    expectedProjectId: multiProject.id,
    expectedCatalogRevision: multiInitial.catalogRevision,
    title: "Multi A"
  });
  const multiMasterA = multiService.assignAssets({
    expectedProjectId: multiProject.id,
    expectedCatalogRevision: multiProductA.catalogRevision,
    productId: multiProductA.product.productId,
    expectedProductRevision: multiProductA.product.revision,
    kind: "master",
    ownerType: "product",
    role: "primary",
    assets: [{ nodeId: "SOURCE_A", assetIndex: 0 }]
  });
  const multiProductB = multiService.saveProduct({
    expectedProjectId: multiProject.id,
    expectedCatalogRevision: multiMasterA.catalogRevision,
    title: "Multi B"
  });
  const multiMasterB = multiService.assignAssets({
    expectedProjectId: multiProject.id,
    expectedCatalogRevision: multiProductB.catalogRevision,
    productId: multiProductB.product.productId,
    expectedProductRevision: multiProductB.product.revision,
    kind: "master",
    ownerType: "product",
    role: "primary",
    assets: [{ nodeId: "SOURCE_B", assetIndex: 0 }]
  });
  assert.equal(multiMasterB.catalogRevision, 4);
  const multiScope = `scope-${"7".repeat(32)}`;
  const multiPlan = `commerce-${"8".repeat(32)}`;
  const targetFor = (product, master, bindingId) => ({
    bindingId,
    catalogId: multiInitial.catalog.catalogId,
    catalogRevision: multiMasterB.catalogRevision,
    productId: product.productId,
    productRevision: product.revision,
    ownerType: "product",
    ownerId: product.productId,
    sourceLinkId: master.product.assets[0].linkId
  });
  const targetA = targetFor(multiMasterA.product, multiMasterA, "multi-binding-a");
  const targetB = targetFor(multiMasterB.product, multiMasterB, "multi-binding-b");
  const appendMultiResult = ({ id, sourceNodeId, target, slotId, slotIndex, key, fileName, scope = multiScope, persist = true }) => {
    const relativePath = `output/imagegen/${fileName}`;
    if (persist) writeFileSync(path.join(multiProject.path, relativePath), `result-${key}`);
    multiSession.nodes.push({
      id,
      type: "image",
      imageState: "done",
      status: "done",
      parentId: sourceNodeId,
      taskProvenance: {
        version: 1,
        taskScopeSnapshotHash: scope,
        resultPolicy: "grouped-by-container",
        sourceBindingId: target.bindingId,
        sourceAssetId: sourceNodeId === "SOURCE_A" ? "multi-source-a" : "multi-source-b",
        sourceNodeId,
        commercePlanHash: multiPlan,
        commerceSlotId: slotId,
        commerceSlotIndex: slotIndex,
        commerceLocaleCode: "en-US",
        commerceCatalogTarget: target,
        commerceResultKey: key
      },
      assets: [{
        type: "file",
        status: "done",
        assetId: `multi-${id.toLowerCase()}`,
        contentHash: sha256(`result-${key}`),
        relativePath,
        fileName
      }]
    });
  };
  const multiSlots = [
    ["MULTI_MAIN", "SOURCE_A", targetA, "amazon-main"],
    ["MULTI_FEATURE", "SOURCE_A", targetA, "amazon-feature-overview"],
    ["MULTI_SCENE", "SOURCE_A", targetA, "amazon-use-case"],
    ["MULTI_SIZE", "SOURCE_B", targetB, "amazon-dimensions"],
    ["MULTI_DETAIL", "SOURCE_B", targetB, "amazon-detail"],
    ["MULTI_LISTING", "SOURCE_B", targetB, "custom-listing"]
  ];
  multiSlots.forEach(([id, sourceNodeId, target, slotId], index) => appendMultiResult({
    id,
    sourceNodeId,
    target,
    slotId,
    slotIndex: index,
    key: `commerce-result-${("a".charCodeAt(0) + index).toString(16).padStart(2, "0")}${String(index).repeat(30)}`,
    fileName: `multi-result-${index + 1}.png`
  }));
  const multiReconciled = multiService.reconcileGoalResults({
    expectedProjectId: multiProject.id,
    taskScopeSnapshotHash: multiScope
  });
  assert.equal(multiReconciled.catalogRevision, 5, "all products must share one catalog commit");
  assert.deepEqual(multiReconciled.details, { scanned: 6, added: 6, existing: 0 });
  const multiAfter = multiService.list({ expectedProjectId: multiProject.id }).catalog;
  const storedA = multiAfter.products.find((product) => product.productId === targetA.productId);
  const storedB = multiAfter.products.find((product) => product.productId === targetB.productId);
  assert.equal(storedA.revision, targetA.productRevision + 1, "Product A increments once for three results");
  assert.equal(storedB.revision, targetB.productRevision + 1, "Product B increments once for three results");
  assert.deepEqual(
    [...new Set([...storedA.assets, ...storedB.assets].filter((asset) => asset.commerceResultKey).map((asset) => asset.role))].sort(),
    ["listing", "main", "scene", "size", "selling-point"].sort()
  );
  const multiReplay = multiService.reconcileGoalResults({ expectedProjectId: multiProject.id, taskScopeSnapshotHash: multiScope });
  assert.deepEqual(multiReplay.details, { scanned: 6, added: 0, existing: 6 });

  const multiCatalogPath = path.join(multiProject.path, ".naimage", "commerce-catalog.json");
  const multiBeforeAtomicConflict = readFileSync(multiCatalogPath, "utf8");
  const conflictScope = `scope-${"9".repeat(32)}`;
  appendMultiResult({
    id: "MULTI_CONFLICT_A",
    sourceNodeId: "SOURCE_A",
    target: { ...targetA, catalogRevision: 5, productRevision: storedA.revision },
    slotId: "amazon-main",
    slotIndex: 0,
    key: `commerce-result-${"b".repeat(32)}`,
    fileName: "multi-conflict-a.png",
    scope: conflictScope
  });
  appendMultiResult({
    id: "MULTI_CONFLICT_B",
    sourceNodeId: "SOURCE_B",
    target: { ...targetB, catalogRevision: 5, productRevision: targetB.productRevision },
    slotId: "amazon-main",
    slotIndex: 1,
    key: `commerce-result-${"c".repeat(32)}`,
    fileName: "multi-conflict-b.png",
    scope: conflictScope
  });
  assert.throws(() => multiService.reconcileGoalResults({ expectedProjectId: multiProject.id, taskScopeSnapshotHash: conflictScope }), (error) => (
    error instanceof CommerceCatalogError && error.code === "PRODUCT_REVISION_CONFLICT"
  ));
  assert.equal(readFileSync(multiCatalogPath, "utf8"), multiBeforeAtomicConflict, "one stale Product must block the whole batch");
  multiSession.nodes.splice(-2);

  const collisionScope = `scope-${"a".repeat(32)}`;
  const collisionKey = `commerce-result-${"f".repeat(32)}`;
  const multiBeforeKeyCollision = readFileSync(multiCatalogPath, "utf8");
  appendMultiResult({ id: "MULTI_COLLISION_A", sourceNodeId: "SOURCE_A", target: { ...targetA, catalogRevision: 5, productRevision: storedA.revision }, slotId: "amazon-main", slotIndex: 0, key: collisionKey, fileName: "multi-collision-a.png", scope: collisionScope });
  appendMultiResult({ id: "MULTI_COLLISION_B", sourceNodeId: "SOURCE_A", target: { ...targetA, catalogRevision: 5, productRevision: storedA.revision }, slotId: "amazon-detail", slotIndex: 1, key: collisionKey, fileName: "multi-collision-b.png", scope: collisionScope });
  assert.throws(() => multiService.reconcileGoalResults({ expectedProjectId: multiProject.id, taskScopeSnapshotHash: collisionScope }), (error) => (
    error instanceof CommerceCatalogError && error.code === "RESULT_OPERATION_CONFLICT"
  ));
  assert.equal(readFileSync(multiCatalogPath, "utf8"), multiBeforeKeyCollision, "a result-key collision must not partially write");
  multiSession.nodes.splice(-2);

  const missingScope = `scope-${"e".repeat(32)}`;
  const multiBeforeMissingFile = readFileSync(multiCatalogPath, "utf8");
  appendMultiResult({ id: "MULTI_FILE_OK", sourceNodeId: "SOURCE_A", target: { ...targetA, catalogRevision: 5, productRevision: storedA.revision }, slotId: "amazon-main", slotIndex: 0, key: `commerce-result-${"1".repeat(32)}`, fileName: "multi-file-ok.png", scope: missingScope });
  appendMultiResult({ id: "MULTI_FILE_MISSING", sourceNodeId: "SOURCE_B", target: { ...targetB, catalogRevision: 5, productRevision: storedB.revision }, slotId: "amazon-main", slotIndex: 1, key: `commerce-result-${"2".repeat(32)}`, fileName: "multi-file-missing.png", scope: missingScope, persist: false });
  assert.throws(() => multiService.reconcileGoalResults({ expectedProjectId: multiProject.id, taskScopeSnapshotHash: missingScope }), (error) => (
    error instanceof CommerceCatalogError && error.code === "ASSET_NOT_MANAGED"
  ));
  assert.equal(readFileSync(multiCatalogPath, "utf8"), multiBeforeMissingFile, "a missing result file must block the whole batch");
  multiSession.nodes.splice(-2);

  const abCatalog = structuredClone(multiService.list({ expectedProjectId: multiProject.id }).catalog);
  const abProductIndex = abCatalog.products.findIndex((item) => item.productId === storedA.productId);
  const abProduct = abCatalog.products[abProductIndex];
  const firstMain = abProduct.assets.find((asset) => asset.kind === "result" && asset.commerceSlotId === "amazon-main");
  const alternateMain = {
    ...firstMain,
    linkId: allocateId("result"),
    assetId: "multi-ab-alternate",
    contentHash: sha256("multi-ab-alternate"),
    relativePath: "output/imagegen/multi-ab-alternate.png",
    fileName: "multi-ab-alternate.png",
    state: "candidate",
    taskScopeSnapshotHash: `scope-${"6".repeat(32)}`,
    commercePlanHash: `commerce-${"5".repeat(32)}`,
    commerceResultKey: `commerce-result-${"4".repeat(32)}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 10, 0)).toISOString()
  };
  writeFileSync(path.join(multiProject.path, alternateMain.relativePath), "multi-ab-alternate");
  abProduct.assets.push(alternateMain);
  abProduct.revision += 1;
  abProduct.updatedAt = alternateMain.createdAt;
  abCatalog.products[abProductIndex] = abProduct;
  abCatalog.revision += 1;
  abCatalog.updatedAt = alternateMain.createdAt;
  multiService.replaceCatalogForProject(multiProject, abCatalog);

  const comparisons = multiService.listComparisons({ expectedProjectId: multiProject.id });
  assert.equal(comparisons.groups.length, 1, "Only a slot with two distinct retained results may enter A/B comparison");
  const comparison = comparisons.groups[0];
  assert.equal(comparison.slotId, "amazon-main");
  assert.equal(comparison.localeCode, "en-US");
  assert.equal(comparison.candidates.length, 2);
  assert.equal(new Set(comparison.candidates.map((candidate) => candidate.commercePlanHash)).size, 2, "The same slot must compare versions across separate plan runs");

  const beforeWinner = readFileSync(multiCatalogPath, "utf8");
  assert.throws(() => multiService.selectComparisonWinner({
    expectedProjectId: multiProject.id,
    expectedCatalogRevision: comparisons.catalogRevision - 1,
    productId: comparison.productId,
    expectedProductRevision: comparison.productRevision,
    groupKey: comparison.groupKey,
    winnerLinkId: alternateMain.linkId
  }), (error) => error instanceof CommerceCatalogError && error.code === "CATALOG_REVISION_CONFLICT");
  assert.equal(readFileSync(multiCatalogPath, "utf8"), beforeWinner, "A stale A/B choice must not partially update result states");

  const selected = multiService.selectComparisonWinner({
    expectedProjectId: multiProject.id,
    expectedCatalogRevision: comparisons.catalogRevision,
    productId: comparison.productId,
    expectedProductRevision: comparison.productRevision,
    groupKey: comparison.groupKey,
    winnerLinkId: alternateMain.linkId
  });
  assert.equal(selected.changed, true);
  assert.equal(selected.catalogRevision, comparisons.catalogRevision + 1, "Winner selection must use one Catalog commit");
  assert.equal(selected.product.revision, comparison.productRevision + 1, "Winner selection must increment the Product once");
  assert.equal(selected.comparison.candidates.length, 2, "A/B selection must retain every source relation");
  assert.deepEqual(selected.comparison.approvedLinkIds, [alternateMain.linkId]);
  assert.equal(selected.comparison.candidates.find((candidate) => candidate.linkId === alternateMain.linkId).state, "approved");
  assert.equal(selected.comparison.candidates.find((candidate) => candidate.linkId === firstMain.linkId).state, "rejected");
  assert.ok(selected.comparison.candidates.every((candidate) => candidate.commerceResultKey && candidate.commercePlanHash));

  const selectedAgain = multiService.selectComparisonWinner({
    expectedProjectId: multiProject.id,
    expectedCatalogRevision: selected.catalogRevision,
    productId: comparison.productId,
    expectedProductRevision: selected.product.revision,
    groupKey: comparison.groupKey,
    winnerLinkId: alternateMain.linkId
  });
  assert.equal(selectedAgain.changed, false, "Selecting the existing winner must be idempotent");
  assert.equal(selectedAgain.catalogRevision, selected.catalogRevision);

  assert.throws(() => service.list({ expectedProjectId: "missing-project" }), (error) => (
    error instanceof CommerceCatalogError && error.code === "PROJECT_NOT_FOUND"
  ));

  const catalogPath = path.join(project.path, ".naimage", "commerce-catalog.json");
  writeFileSync(catalogPath, "{broken-json", "utf8");
  const corruptBefore = readFileSync(catalogPath, "utf8");
  assert.throws(() => service.list({ expectedProjectId: project.id }), (error) => (
    error instanceof CommerceCatalogError && error.code === "CATALOG_CORRUPT"
  ));
  assert.equal(readFileSync(catalogPath, "utf8"), corruptBefore, "corrupt catalog must never be overwritten by a fallback");

  process.stdout.write("commerce catalog selftest passed\n");
} finally {
  const resolved = path.resolve(root);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) rmSync(resolved, { recursive: true, force: true });
}
