"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
sharp.cache(false);

const {
  CommerceExportError,
  createProjectCommerceExportService
} = require("../desktop/project-commerce-export.cjs");
const { convertImageForExport } = require("../desktop/image-export-service.cjs");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function managedPath(projectPath, relativePath) {
  const resolved = path.resolve(projectPath, relativePath);
  const relative = path.relative(projectPath, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : "";
}

async function createFixtureImage(filePath, { width, height, color, alpha = 1 }) {
  await sharp({ create: { width, height, channels: alpha < 1 ? 4 : 3, background: { ...color, alpha } } })
    .png()
    .toFile(filePath);
  return sha256(readFileSync(filePath));
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-commerce-export-"));
  try {
    const project = {
      id: "project-commerce-export",
      name: "Commerce export fixture",
      path: path.join(root, "project"),
      sessionPath: path.join(root, "project", "session.json")
    };
    const imageRoot = path.join(project.path, "output", "imagegen");
    const exportRoot = path.join(root, "exports");
    mkdirSync(imageRoot, { recursive: true });
    mkdirSync(exportRoot, { recursive: true });

    const files = {
      productMain: "output/imagegen/product-main.png",
      productCandidate: "output/imagegen/product-candidate.png",
      productRejected: "output/imagegen/product-rejected.png",
      variantMain: "output/imagegen/variant-main.png",
      skuScene: "output/imagegen/sku-scene.png"
    };
    const hashes = {
      productMain: await createFixtureImage(path.join(project.path, files.productMain), { width: 1600, height: 1600, color: { r: 255, g: 255, b: 255 } }),
      productCandidate: await createFixtureImage(path.join(project.path, files.productCandidate), { width: 800, height: 800, color: { r: 50, g: 120, b: 210 } }),
      productRejected: await createFixtureImage(path.join(project.path, files.productRejected), { width: 900, height: 900, color: { r: 210, g: 80, b: 50 } }),
      variantMain: await createFixtureImage(path.join(project.path, files.variantMain), { width: 600, height: 500, color: { r: 35, g: 45, b: 55 } }),
      skuScene: await createFixtureImage(path.join(project.path, files.skuScene), { width: 720, height: 720, color: { r: 30, g: 190, b: 120 }, alpha: 0.6 })
    };
    const sourceBefore = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, readFileSync(path.join(project.path, value))]));

    const variantA = { variantId: "variant-a", title: "Black", optionValues: [], revision: 1 };
    const variantB = { variantId: "variant-b", title: "White", optionValues: [], revision: 1 };
    const skuA = { skuId: "sku-a", skuCode: "MUG/BLACK", title: "Black mug", variantId: variantA.variantId, platforms: ["amazon", "aliexpress"], revision: 1 };
    const skuB = { skuId: "sku-b", skuCode: "MUG-WHITE", title: "White mug", variantId: variantB.variantId, platforms: ["amazon"], revision: 1 };
    const asset = (linkId, ownerType, ownerId, role, state, fileKey, slotIndex) => ({
      linkId,
      kind: "result",
      ownerType,
      ownerId,
      role,
      state,
      assetId: `asset-${linkId}`,
      contentHash: hashes[fileKey],
      relativePath: files[fileKey],
      fileName: path.basename(files[fileKey]),
      commerceSlotIndex: slotIndex,
      createdAt: "2026-07-31T00:00:00.000Z"
    });
    const product = {
      productId: "product-a",
      title: "Travel Mug",
      productCode: "SPU:001",
      brand: "North",
      platforms: ["amazon", "aliexpress"],
      status: "active",
      revision: 7,
      variants: [variantA, variantB],
      skus: [skuA, skuB],
      assets: [
        asset("result-product-main", "product", "product-a", "main", "approved", "productMain", 0),
        asset("result-product-candidate", "product", "product-a", "selling-point", "candidate", "productCandidate", 1),
        asset("result-product-rejected", "product", "product-a", "listing", "rejected", "productRejected", 2),
        asset("result-variant-main", "variant", variantA.variantId, "main", "approved", "variantMain", 3),
        asset("result-sku-scene", "sku", skuB.skuId, "scene", "approved", "skuScene", 4)
      ]
    };
    const catalog = {
      schemaVersion: 1,
      catalogId: "catalog-export",
      revision: 12,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
      products: [product]
    };
    const createService = (overrides = {}) => createProjectCommerceExportService({
      getProjectById: (id) => id === project.id ? project : null,
      readProjectList: () => ({ activeProjectId: project.id, projects: [project] }),
      readCommerceCatalog: () => catalog,
      resolveProjectRelativePath: managedPath,
      now: () => "2026-07-31T08:00:00.000Z",
      ...overrides
    });
    const service = createService();

    const approvedPreview = await service.preview({
      expectedProjectId: project.id,
      expectedCatalogRevision: 12,
      platform: "amazon",
      format: "jpeg"
    });
    assert.equal(approvedPreview.ok, true);
    assert.equal(approvedPreview.summary.packages, 2);
    assert.equal(approvedPreview.summary.images, 4, "Product results inherit to both SKUs, variant results to matching SKUs, and SKU results only to their SKU");
    const packageA = approvedPreview.packages.find((item) => item.skuId === skuA.skuId);
    const packageB = approvedPreview.packages.find((item) => item.skuId === skuB.skuId);
    assert.deepEqual(packageA.images.map((item) => item.linkId), ["result-product-main", "result-variant-main"]);
    assert.deepEqual(packageB.images.map((item) => item.linkId), ["result-product-main", "result-sku-scene"]);
    assert.equal(approvedPreview.packages.some((item) => item.images.some((image) => image.linkId === "result-product-rejected")), false);
    assert.equal(approvedPreview.packages.every((item) => item.images.every((image) => !Object.hasOwn(image, "sourcePath"))), true, "Preview must not expose managed source paths");
    assert.equal(approvedPreview.issues.some((issue) => issue.code === "MAIN_BACKGROUND_NOT_WHITE" && issue.linkId === "result-variant-main"), true);
    assert.equal(approvedPreview.issues.some((issue) => issue.code === "IMAGE_ASPECT_RATIO_MISMATCH" && issue.linkId === "result-variant-main"), true);

    const candidatePreview = await service.preview({
      expectedProjectId: project.id,
      expectedCatalogRevision: 12,
      platform: "amazon",
      format: "png",
      includeCandidates: true
    });
    assert.equal(candidatePreview.summary.images, 6, "The Product-level candidate must inherit to both SKUs");
    assert.equal(candidatePreview.packages.every((item) => item.images.some((image) => image.linkId === "result-product-candidate")), true);
    assert.equal(candidatePreview.packages.every((item) => item.images.every((image) => image.linkId !== "result-product-rejected")), true, "Rejected results are always excluded");

    const aliexpressPreview = await service.preview({
      expectedProjectId: project.id,
      expectedCatalogRevision: 12,
      platform: "aliexpress",
      format: "jpeg"
    });
    assert.deepEqual(aliexpressPreview.packages.map((item) => item.skuId), [skuA.skuId], "Platform filtering must honor SKU platform ownership");
    assert.equal(aliexpressPreview.issues.some((issue) => issue.code === "MAIN_BACKGROUND_NOT_WHITE"), false, "AliExpress does not enforce the Amazon white-edge rule");

    const selectedPreview = await service.preview({
      expectedProjectId: project.id,
      expectedCatalogRevision: 12,
      platform: "amazon",
      format: "png",
      skuIds: [skuB.skuId]
    });
    assert.deepEqual(selectedPreview.packages.map((item) => item.skuId), [skuB.skuId]);

    await assert.rejects(
      service.preview({ expectedProjectId: project.id, expectedCatalogRevision: 11, platform: "amazon", format: "jpeg" }),
      (error) => error instanceof CommerceExportError && error.code === "CATALOG_REVISION_CONFLICT"
    );
    await assert.rejects(
      service.exportPackage({ expectedProjectId: project.id, expectedCatalogRevision: 12, platform: "amazon", format: "jpeg", destinationParent: exportRoot }),
      (error) => error instanceof CommerceExportError && error.code === "EXPORT_CONFIRMATION_REQUIRED"
    );

    const jpegExport = await service.exportPackage({
      expectedProjectId: project.id,
      expectedCatalogRevision: 12,
      platform: "amazon",
      format: "jpeg",
      skuIds: [skuB.skuId],
      destinationParent: exportRoot,
      confirmed: true
    });
    assert.equal(existsSync(jpegExport.path), true);
    const jpegManifestPath = path.join(jpegExport.path, "manifest.json");
    const jpegManifestText = readFileSync(jpegManifestPath, "utf8");
    const jpegManifest = JSON.parse(jpegManifestText);
    assert.equal(jpegManifestText.includes(project.path), false, "Manifest must not leak an absolute project path");
    assert.equal(jpegManifest.packages[0].files.length, 2);
    assert.equal(jpegManifest.packages[0].directory, "products/SPU-001/MUG-WHITE");
    for (const file of jpegManifest.packages[0].files) {
      assert.equal(path.isAbsolute(file.file), false);
      const outputPath = path.join(jpegExport.path, ...file.file.split("/"));
      assert.equal((await sharp(outputPath).metadata()).format, "jpeg");
      assert.equal(path.extname(outputPath), ".jpg");
    }

    const pngExport = await service.exportPackage({
      expectedProjectId: project.id,
      expectedCatalogRevision: 12,
      platform: "aliexpress",
      format: "png",
      skuIds: [skuA.skuId],
      destinationParent: exportRoot,
      confirmed: true
    });
    const pngManifest = JSON.parse(readFileSync(path.join(pngExport.path, "manifest.json"), "utf8"));
    for (const file of pngManifest.packages[0].files) {
      const outputPath = path.join(pngExport.path, ...file.file.split("/"));
      assert.equal((await sharp(outputPath).metadata()).format, "png");
      assert.equal(path.extname(outputPath), ".png");
    }
    for (const [key, relativePath] of Object.entries(files)) {
      assert.deepEqual(readFileSync(path.join(project.path, relativePath)), sourceBefore[key], `Export must not mutate ${key}`);
    }

    writeFileSync(path.join(project.path, files.skuScene), Buffer.from("replaced-after-catalog"));
    const corruptedPreview = await service.preview({
      expectedProjectId: project.id,
      expectedCatalogRevision: 12,
      platform: "amazon",
      format: "jpeg",
      skuIds: [skuB.skuId]
    });
    assert.equal(corruptedPreview.summary.blockingIssues, 1);
    assert.equal(corruptedPreview.issues.some((issue) => issue.code === "EXPORT_ASSET_HASH_MISMATCH"), true);
    await assert.rejects(
      service.exportPackage({
        expectedProjectId: project.id,
        expectedCatalogRevision: 12,
        platform: "amazon",
        format: "jpeg",
        skuIds: [skuB.skuId],
        destinationParent: exportRoot,
        confirmed: true
      }),
      (error) => error instanceof CommerceExportError && error.code === "COMMERCE_EXPORT_BLOCKED"
    );
    writeFileSync(path.join(project.path, files.skuScene), sourceBefore.skuScene);

    let conversionCount = 0;
    const failingService = createService({
      convertImage: async (...args) => {
        conversionCount += 1;
        if (conversionCount === 2) throw new Error("simulated conversion failure");
        return convertImageForExport(...args);
      }
    });
    const entriesBeforeFailure = new Set(readdirSync(exportRoot));
    await assert.rejects(
      failingService.exportPackage({
        expectedProjectId: project.id,
        expectedCatalogRevision: 12,
        platform: "amazon",
        format: "png",
        skuIds: [skuA.skuId],
        destinationParent: exportRoot,
        confirmed: true
      }),
      /simulated conversion failure/
    );
    assert.deepEqual(new Set(readdirSync(exportRoot)), entriesBeforeFailure, "Failed exports must not publish or leave staging directories");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cases: 18,
      inheritance: true,
      stateFiltering: true,
      platformRules: true,
      revisionGuard: true,
      hashGuard: true,
      formats: ["jpeg", "png"],
      manifestPathSafe: true,
      sourcePreserved: true,
      atomicPublish: true
    })}\n`);
  } finally {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
