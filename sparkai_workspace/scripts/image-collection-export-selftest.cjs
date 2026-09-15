"use strict";

const assert = require("node:assert/strict");
const { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync } = require("node:fs");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
sharp.cache(false);
const {
  ImageCollectionExportError,
  createImageCollectionExportService
} = require("../desktop/image-collection-export-service.cjs");

function collectionNode(id, name, assets, items, options = {}) {
  const collection = {
    id,
    name,
    kind: "batch",
    collectionRole: options.role || "results",
    generationMode: "parallel",
    sourceCollectionId: options.sourceCollectionId,
    defectOfNodeId: options.defectOfNodeId,
    createdAt: "2026-08-11T00:00:00.000Z",
    items
  };
  return { id: `node-${id}`, title: name, type: "image", assets, imageCollection: collection, imageContainerSpec: { collection } };
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "naimage-image-group-export-"));
  try {
    const outputRoot = path.join(root, "output", "imagegen");
    mkdirSync(outputRoot, { recursive: true });
    const firstPath = path.join(outputRoot, "first.png");
    const secondPath = path.join(outputRoot, "second.webp");
    const defectPath = path.join(outputRoot, "defect.jpg");
    await sharp({ create: { width: 31, height: 19, channels: 4, background: { r: 40, g: 120, b: 210, alpha: 0.65 } } }).png().toFile(firstPath);
    await sharp({ create: { width: 23, height: 29, channels: 4, background: { r: 210, g: 70, b: 35, alpha: 0.8 } } }).webp().toFile(secondPath);
    await sharp({ create: { width: 17, height: 13, channels: 3, background: { r: 90, g: 170, b: 80 } } }).jpeg().toFile(defectPath);
    const asset = (assetId, sourcePath) => ({ assetId, path: sourcePath, relativePath: path.relative(root, sourcePath).replace(/\\/g, "/"), status: "done" });
    let session = {
      nodes: [
        collectionNode("results-a", " 商品图<> ", [asset("asset-1", firstPath), asset("asset-2", secondPath)], [
          { id: "item-2", assetId: "asset-2", assetIndex: 2, requestIndex: 8, prompt: "second prompt", status: "done" },
          { id: "item-1", assetId: "asset-1", assetIndex: 1, requestIndex: 2, prompt: "first prompt", replacedByAssetId: "replacement-1", status: "done", taskProvenance: { version: 1, sourceBindingId: "binding-1" } },
          { id: "item-failed", requestIndex: 10, prompt: "failed prompt", status: "error", error: "fixture failure" }
        ]),
        collectionNode("defects-a", "商品图", [asset("asset-defect", defectPath)], [
          { id: "defect-item", assetId: "asset-defect", assetIndex: 1, requestIndex: 2, prompt: "first prompt", replacesItemId: "item-1", defectReason: "手指瑕疵", status: "done" }
        ], { role: "defects", sourceCollectionId: "results-a", defectOfNodeId: "node-results-a" })
      ]
    };
    const project = { id: "project-fixture", path: root };
    const service = createImageCollectionExportService({
      controlledProjectAssetFile(candidate, projectPath) {
        if (!candidate || !existsSync(candidate)) return "";
        const resolved = path.resolve(candidate);
        const controlledRoot = path.resolve(projectPath, "output", "imagegen");
        const relative = path.relative(controlledRoot, resolved);
        return !relative.startsWith("..") && !path.isAbsolute(relative) && lstatSync(resolved).isFile() ? resolved : "";
      },
      getProjectById: (id) => id === project.id ? project : null,
      projectSessionFromDisk: () => session,
      readProjectList: () => ({ activeProjectId: project.id, projects: [project] }),
      resolveProjectRelativePath(projectPath, relativePath) {
        const resolved = path.resolve(projectPath, String(relativePath || ""));
        const relative = path.relative(path.resolve(projectPath), resolved);
        return !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : "";
      },
      now: () => "2026-08-11T02:00:00.000Z"
    });

    await assert.rejects(
      service.previewCollections({ expectedProjectId: project.id, collectionIds: ["results-a"] }),
      (error) => error instanceof ImageCollectionExportError && error.code === "IMAGE_COLLECTION_EXPORT_FORMAT_REQUIRED"
    );
    const preview = await service.previewCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a", "defects-a"],
      format: "webp"
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.collectionCount, 2);
    assert.equal(preview.imageCount, 3);
    assert.equal(preview.slotCount, 4);
    assert.equal(preview.failedSlotCount, 1);
    assert.equal(preview.pendingSlotCount, 0);
    assert.equal(preview.estimatedBytes > 0, true);
    assert.equal(preview.relativeRoot, "image-groups");
    assert.equal(preview.groups[0].directoryName, "商品图");
    const result = await service.exportCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a", "defects-a"],
      format: "webp",
      previewToken: preview.previewToken,
      confirmed: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.format, "webp");
    assert.equal(result.imageCount, 3);
    assert.equal(result.failedSlotCount, 1);
    assert.equal(result.relativeRoot, "image-groups");
    assert.equal(result.totalBytes, result.imageBytes + result.manifestBytes);
    assert.equal(result.convertedCount, 2);
    assert.deepEqual(result.exported.map((item) => item.directoryName), ["商品图", "商品图 (2)"]);
    const resultsFolder = path.join(root, ...result.exported[0].relativePath.split("/"));
    const files = readdirSync(resultsFolder).sort();
    assert.deepEqual(files, ["001-request-002.webp", "002-request-008.webp", "image-group.json"]);
    const manifest = JSON.parse(readFileSync(path.join(resultsFolder, "image-group.json"), "utf8"));
    assert.equal(manifest.group.id, "results-a");
    assert.equal(manifest.version, 2);
    assert.equal(manifest.group.name, "商品图");
    assert.equal(manifest.export.format, "webp");
    assert.equal(manifest.export.filenameTemplate, "{index}-request-{request}");
    assert.match(manifest.export.contentFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(manifest.export.failedSlotCount, 1);
    assert.equal(manifest.export.convertedCount, 1);
    assert.deepEqual(manifest.images.map((item) => item.requestIndex), [2, 8, 10]);
    assert.equal(manifest.images[0].replacedByAssetId, "replacement-1");
    assert.equal(manifest.images[0].taskProvenance.sourceBindingId, "binding-1");
    assert.equal(manifest.images[2].fileName, undefined);
    assert.equal(manifest.images[2].status, "error");
    assert.equal((await sharp(path.join(resultsFolder, manifest.images[0].fileName)).metadata()).format, "webp");
    const defectManifest = JSON.parse(readFileSync(path.join(root, ...result.exported[1].relativePath.split("/"), "image-group.json"), "utf8"));
    assert.equal(defectManifest.group.role, "defects");
    assert.equal(defectManifest.group.sourceCollectionId, "results-a");
    assert.equal(defectManifest.images[0].replacesItemId, "item-1");
    assert.equal(defectManifest.images[0].defectReason, "手指瑕疵");
    assert.ok(manifest.images[0].sha256 && manifest.images[0].sourceSha256 && !JSON.stringify(manifest).includes(firstPath), "Manifest must have output/source hashes but no absolute source path");

    const opened = await service.resolveExportedCollectionFolder({ expectedProjectId: project.id, collectionId: "results-a" });
    assert.equal(opened.folderPath, resultsFolder);

    const incrementalPreview = await service.previewCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a", "defects-a"],
      format: "webp",
      incremental: true
    });
    assert.equal(incrementalPreview.skippedCount, 2);
    assert.deepEqual(incrementalPreview.groups.map((group) => group.action), ["skip-unchanged", "skip-unchanged"]);
    const incremental = await service.exportCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a", "defects-a"],
      format: "webp",
      incremental: true,
      previewToken: incrementalPreview.previewToken,
      confirmed: true
    });
    assert.equal(incremental.imageCount, 0);
    assert.equal(incremental.requestedImageCount, 3);
    assert.equal(incremental.skippedCount, 2);
    assert.equal(incremental.skippedImageCount, 3);
    assert.equal(incremental.totalBytes, 0);
    assert.equal(readdirSync(path.join(root, "image-groups")).some((name) => name.startsWith(".staging-")), false,
      "An all-unchanged incremental export must not create staging directories");

    const keepBothPreview = await service.previewCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a"],
      format: "webp",
      filenameTemplate: "{group}-{title}-{request}",
      conflictPolicy: "keep-both"
    });
    assert.equal(keepBothPreview.groups[0].directoryName, "商品图 (3)");
    const keepBoth = await service.exportCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a"],
      format: "webp",
      filenameTemplate: "{group}-{title}-{request}",
      conflictPolicy: "keep-both",
      previewToken: keepBothPreview.previewToken,
      confirmed: true
    });
    const keepBothFolder = path.join(root, ...keepBoth.exported[0].relativePath.split("/"));
    assert.deepEqual(readdirSync(keepBothFolder).sort(), ["image-group.json", "商品图-商品图-002.webp", "商品图-商品图-008.webp"]);
    assert.equal(existsSync(resultsFolder), true, "Keep-both must preserve the previous app-owned group folder");

    const skipPreview = await service.previewCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a"],
      format: "png",
      conflictPolicy: "skip"
    });
    assert.equal(skipPreview.groups[0].action, "skip-conflict");
    const skipped = await service.exportCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a"],
      format: "png",
      conflictPolicy: "skip",
      previewToken: skipPreview.previewToken,
      confirmed: true
    });
    assert.equal(skipped.skippedCount, 1);
    assert.equal(skipped.imageCount, 0);
    assert.equal(skipped.exported[0].skippedReason, "conflict");

    await assert.rejects(
      service.previewCollections({
        expectedProjectId: project.id,
        collectionIds: ["results-a"],
        format: "png",
        filenameTemplate: "{unknown}-{index}"
      }),
      (error) => error instanceof ImageCollectionExportError && error.code === "IMAGE_COLLECTION_EXPORT_TEMPLATE_INVALID"
    );

    session = {
      ...session,
      nodes: session.nodes.map((node) => node.imageCollection?.id === "results-a"
        ? { ...node, title: "已重命名", imageCollection: { ...node.imageCollection, name: "已重命名" }, imageContainerSpec: { ...node.imageContainerSpec, collection: { ...node.imageCollection, name: "已重命名" } } }
        : node)
    };
    const renamedPreview = await service.previewCollections({ expectedProjectId: project.id, collectionIds: ["results-a"], format: "png" });
    const renamed = await service.exportCollections({
      expectedProjectId: project.id,
      collectionIds: ["results-a"],
      format: "png",
      previewToken: renamedPreview.previewToken,
      confirmed: true
    });
    assert.equal(renamed.exported[0].directoryName, "已重命名");
    assert.equal(existsSync(resultsFolder), false, "Re-export after rename must retire the old directory for the same collection ID");

    const renamedFolder = path.join(root, ...renamed.exported[0].relativePath.split("/"));
    const legacyFolder = path.join(root, "exports", "image-groups", renamed.exported[0].directoryName);
    mkdirSync(path.dirname(legacyFolder), { recursive: true });
    renameSync(renamedFolder, legacyFolder);
    const legacyOpened = await service.resolveExportedCollectionFolder({ expectedProjectId: project.id, collectionId: "results-a" });
    assert.equal(legacyOpened.folderPath, legacyFolder, "Previously exported folders below exports/image-groups must remain openable");

    const stalePreview = await service.previewCollections({ expectedProjectId: project.id, collectionIds: ["results-a"], format: "png" });
    session = {
      ...session,
      nodes: session.nodes.map((node) => node.imageCollection?.id === "results-a"
        ? { ...node, title: "预检后改名", imageCollection: { ...node.imageCollection, name: "预检后改名" }, imageContainerSpec: { ...node.imageContainerSpec, collection: { ...node.imageCollection, name: "预检后改名" } } }
        : node)
    };
    await assert.rejects(
      service.exportCollections({
        expectedProjectId: project.id,
        collectionIds: ["results-a"],
        format: "png",
        previewToken: stalePreview.previewToken,
        confirmed: true
      }),
      (error) => error instanceof ImageCollectionExportError && error.code === "IMAGE_COLLECTION_EXPORT_PREVIEW_STALE"
    );

    const outside = path.join(root, "outside.png");
    await sharp({ create: { width: 9, height: 9, channels: 3, background: { r: 20, g: 20, b: 20 } } }).png().toFile(outside);
    session = {
      nodes: [
        ...session.nodes,
        collectionNode("valid-batch", "valid batch", [asset("asset-valid", firstPath)], [
          { id: "valid-item", assetId: "asset-valid", assetIndex: 1, requestIndex: 1, prompt: "valid", status: "done" }
        ]),
        collectionNode("unmanaged", "unmanaged", [asset("asset-outside", outside)], [
          { id: "outside-item", assetId: "asset-outside", assetIndex: 1, requestIndex: 1, prompt: "outside", status: "done" }
        ])
      ]
    };
    await assert.rejects(
      service.previewCollections({ expectedProjectId: project.id, collectionIds: ["valid-batch", "unmanaged"], format: "jpeg" }),
      (error) => error instanceof ImageCollectionExportError && error.code === "IMAGE_COLLECTION_ASSET_UNMANAGED"
    );
    assert.equal(existsSync(path.join(root, "image-groups", "valid batch")), false, "Batch validation failure must publish no selected group");
    assert.equal(readdirSync(path.join(root, "image-groups")).some((name) => name.startsWith(".staging-")), false);

    await assert.rejects(
      service.resolveExportedCollectionFolder({ expectedProjectId: project.id, collectionId: "valid-batch" }),
      (error) => error instanceof ImageCollectionExportError && error.code === "IMAGE_COLLECTION_NOT_EXPORTED"
    );
    process.stdout.write("image collection export selftest passed (project folders, templates, conflict policies, incremental hashes, legacy lookup, conversion, manifest, ordering, rename, rollback)\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
