"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { createReadStream } = require("node:fs");
const {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} = require("node:fs/promises");
const path = require("node:path");
const commerceCatalogSchema = require("../plugins/commerce-catalog-schema.json");
const { convertImageForExport, normalizeImageExportFormat } = require("./image-export-service.cjs");

const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const EXPORT_PROFILES = new Map((commerceCatalogSchema.exportProfiles || []).map((profile) => [profile.id, profile]));
const MAX_EXPORT_PACKAGES = commerceCatalogSchema.limits.maxExportPackages;
const MAX_EXPORT_IMAGES = commerceCatalogSchema.limits.maxExportImages;
const RESULT_STATE_ORDER = Object.freeze({ approved: 0, candidate: 1, rejected: 2 });
const ROLE_ORDER = Object.freeze({ main: 0, listing: 1, "selling-point": 2, scene: 3, size: 4 });

class CommerceExportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CommerceExportError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function cleanText(value, maximum = 240) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

function cleanIdList(value, maximum) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 160).toLowerCase())
    .filter(Boolean))].slice(0, maximum + 1);
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(candidate, root) {
  const candidateKey = comparablePath(candidate);
  const rootKey = comparablePath(root);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function safeExportSegment(value, fallback) {
  let segment = cleanText(value, 120)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 80);
  if (!segment) segment = fallback;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) segment = `_${segment}`;
  return segment;
}

function outputExtension(format) {
  return format === "jpeg" ? ".jpg" : ".png";
}

function exportProfile(value) {
  const id = cleanText(value, 24).toLowerCase();
  const profile = EXPORT_PROFILES.get(id);
  if (!profile) throw new CommerceExportError("INVALID_EXPORT_PLATFORM", "请选择 Amazon 或速卖通导出规则。", { platform: id });
  return profile;
}

function exportFormat(profile, value) {
  const format = normalizeImageExportFormat(value, profile.defaultFormat);
  if (!profile.allowedFormats.includes(format)) {
    throw new CommerceExportError("INVALID_EXPORT_FORMAT", `${profile.label} 暂不支持 ${format.toUpperCase()} 导出。`, {
      format,
      allowedFormats: profile.allowedFormats
    });
  }
  return format;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizedDimensions(metadata) {
  const width = Math.max(0, Math.floor(Number(metadata?.width) || 0));
  const height = Math.max(0, Math.floor(Number(metadata?.height) || 0));
  return new Set([5, 6, 7, 8]).has(Number(metadata?.orientation))
    ? { width: height, height: width }
    : { width, height };
}

async function inspectImageFile(filePath, calculateWhiteEdge) {
  const sharp = require("sharp");
  const inputOptions = { failOn: "error", limitInputPixels: 268_402_689 };
  const metadata = await sharp(filePath, inputOptions).metadata();
  const dimensions = normalizedDimensions(metadata);
  if (!dimensions.width || !dimensions.height) throw new Error("图片尺寸无效。");
  const decoded = await sharp(filePath, inputOptions)
    .rotate()
    .resize({ width: 64, height: 64, fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!decoded.data.length || decoded.info.channels !== 4) throw new Error("图片无法完整解码。");

  let whiteEdgeRatio = null;
  if (calculateWhiteEdge) {
    let edgePixels = 0;
    let whitePixels = 0;
    const { width, height, channels } = decoded.info;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
        const offset = (y * width + x) * channels;
        const red = decoded.data[offset];
        const green = decoded.data[offset + 1];
        const blue = decoded.data[offset + 2];
        const alpha = decoded.data[offset + 3];
        edgePixels += 1;
        if (alpha >= 250 && red >= 245 && green >= 245 && blue >= 245) whitePixels += 1;
      }
    }
    whiteEdgeRatio = edgePixels ? whitePixels / edgePixels : 0;
  }
  return {
    ...dimensions,
    format: cleanText(metadata.format, 24).toLowerCase(),
    hasAlpha: Boolean(metadata.hasAlpha),
    whiteEdgeRatio
  };
}

function assetAppliesToSku(asset, product, sku) {
  if (asset.ownerType === "product") return asset.ownerId === product.productId;
  if (asset.ownerType === "variant") return Boolean(sku.variantId) && asset.ownerId === sku.variantId;
  return asset.ownerType === "sku" && asset.ownerId === sku.skuId;
}

function skuSupportsPlatform(product, sku, platformId) {
  if (sku.platforms?.length) return sku.platforms.includes(platformId);
  if (product.platforms?.length) return product.platforms.includes(platformId);
  return true;
}

function compareAssets(left, right) {
  const leftIndex = Number.isInteger(left.commerceSlotIndex) ? left.commerceSlotIndex : Number.MAX_SAFE_INTEGER;
  const rightIndex = Number.isInteger(right.commerceSlotIndex) ? right.commerceSlotIndex : Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex ||
    (ROLE_ORDER[left.role] ?? 99) - (ROLE_ORDER[right.role] ?? 99) ||
    (RESULT_STATE_ORDER[left.state] ?? 99) - (RESULT_STATE_ORDER[right.state] ?? 99) ||
    String(left.createdAt || "").localeCompare(String(right.createdAt || "")) ||
    left.linkId.localeCompare(right.linkId);
}

function issueRecord(code, message, context = {}, blocking = false) {
  const scope = [context.productId, context.skuId, context.linkId].filter(Boolean).join(":");
  return {
    issueId: `${code}:${scope || "catalog"}`,
    code,
    severity: blocking ? "blocking" : "warning",
    message,
    ...context
  };
}

function publicPlan(plan) {
  return {
    ok: true,
    projectId: plan.projectId,
    catalogRevision: plan.catalogRevision,
    platform: plan.platform,
    platformLabel: plan.platformLabel,
    format: plan.format,
    includeCandidates: plan.includeCandidates,
    selection: plan.selection,
    summary: plan.summary,
    packages: plan.packages.map((item) => ({
      productId: item.productId,
      productTitle: item.productTitle,
      productCode: item.productCode,
      skuId: item.skuId,
      skuCode: item.skuCode,
      skuTitle: item.skuTitle,
      directory: item.directory,
      images: item.images.map(({ sourcePath: _sourcePath, ...image }) => image),
      issueIds: item.issueIds
    })),
    issues: plan.issues
  };
}

function createProjectCommerceExportService({
  getProjectById,
  readProjectList,
  readCommerceCatalog,
  resolveProjectRelativePath,
  convertImage = convertImageForExport,
  now = () => new Date().toISOString()
} = {}) {
  if (![getProjectById, readProjectList, readCommerceCatalog, resolveProjectRelativePath, convertImage].every((item) => typeof item === "function")) {
    throw new TypeError("commerce export project services are required");
  }

  function projectForId(projectIdValue) {
    const projectId = cleanText(projectIdValue, 160);
    const project = projectId ? getProjectById(projectId, readProjectList()) : null;
    if (!project) throw new CommerceExportError("PROJECT_NOT_FOUND", "目标项目不存在或已被移除。", { projectId });
    return project;
  }

  async function inspectManagedAsset(project, asset, requireWhiteEdge) {
    const sourcePath = resolveProjectRelativePath(project.path, asset.relativePath);
    if (!sourcePath) throw new CommerceExportError("EXPORT_ASSET_NOT_MANAGED", "导出图片不在当前项目的受管目录中。", { linkId: asset.linkId });
    let sourceStats;
    try {
      sourceStats = await lstat(sourcePath);
    } catch (error) {
      if (error?.code === "ENOENT") throw new CommerceExportError("EXPORT_ASSET_MISSING", "导出图片文件不存在。", { linkId: asset.linkId });
      throw error;
    }
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink() || sourceStats.size <= 0 || sourceStats.size > MAX_SOURCE_BYTES) {
      throw new CommerceExportError("EXPORT_ASSET_INVALID", "导出图片不是有效的受管文件。", { linkId: asset.linkId });
    }
    const [realProjectRoot, realSourcePath] = await Promise.all([realpath(project.path), realpath(sourcePath)]);
    if (!isPathInside(realSourcePath, realProjectRoot)) {
      throw new CommerceExportError("EXPORT_ASSET_NOT_MANAGED", "导出图片解析到了项目目录之外。", { linkId: asset.linkId });
    }
    const actualHash = await hashFile(realSourcePath);
    if (actualHash !== asset.contentHash) {
      throw new CommerceExportError("EXPORT_ASSET_HASH_MISMATCH", "导出图片内容已变化，请重新加入素材库。", { linkId: asset.linkId });
    }
    let inspection;
    try {
      inspection = await inspectImageFile(realSourcePath, requireWhiteEdge);
    } catch (error) {
      throw new CommerceExportError("EXPORT_ASSET_DECODE_FAILED", `导出图片无法完整解码：${error instanceof Error ? error.message : String(error)}`, { linkId: asset.linkId });
    }
    return { sourcePath: realSourcePath, bytes: Number(sourceStats.size), contentHash: actualHash, ...inspection };
  }

  async function buildPlan(payload = {}) {
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    const catalog = readCommerceCatalog(project);
    const expectedRevision = Math.floor(Number(payload.expectedCatalogRevision));
    if (!Number.isInteger(expectedRevision) || expectedRevision !== catalog.revision) {
      throw new CommerceExportError("CATALOG_REVISION_CONFLICT", "SKU 商品素材库已发生变化，请刷新导出预检。", {
        expectedRevision: Number.isFinite(expectedRevision) ? expectedRevision : null,
        currentRevision: catalog.revision
      });
    }
    const profile = exportProfile(payload.platform);
    const format = exportFormat(profile, payload.format);
    const includeCandidates = payload.includeCandidates === true;
    const productIds = cleanIdList(payload.productIds, MAX_EXPORT_PACKAGES);
    const skuIds = cleanIdList(payload.skuIds, MAX_EXPORT_PACKAGES);
    if (productIds.length > MAX_EXPORT_PACKAGES || skuIds.length > MAX_EXPORT_PACKAGES) {
      throw new CommerceExportError("EXPORT_SELECTION_TOO_LARGE", `单次最多选择 ${MAX_EXPORT_PACKAGES} 个商品或 SKU。`);
    }

    const productById = new Map(catalog.products.map((product) => [product.productId, product]));
    const skuOwnerById = new Map(catalog.products.flatMap((product) => product.skus.map((sku) => [sku.skuId, { product, sku }])));
    const missingProductIds = productIds.filter((id) => !productById.has(id));
    const missingSkuIds = skuIds.filter((id) => !skuOwnerById.has(id));
    if (missingProductIds.length || missingSkuIds.length) {
      throw new CommerceExportError("EXPORT_SELECTION_STALE", "选择的商品或 SKU 已不存在，请刷新后重试。", { missingProductIds, missingSkuIds });
    }

    const selectedProducts = productIds.length ? new Set(productIds) : null;
    const selectedSkus = skuIds.length ? new Set(skuIds) : null;
    const packages = [];
    const issues = [];
    const inspectionCache = new Map();
    let imageCount = 0;

    for (const product of catalog.products) {
      if (product.status !== "active") continue;
      if (selectedProducts && !selectedProducts.has(product.productId)) continue;
      for (const sku of product.skus) {
        if (selectedSkus && !selectedSkus.has(sku.skuId)) continue;
        if (!selectedSkus && !skuSupportsPlatform(product, sku, profile.id)) continue;
        if (selectedProducts && selectedSkus && !selectedProducts.has(product.productId)) continue;

        const productSegment = safeExportSegment(product.productCode || product.title, product.productId);
        const skuSegment = safeExportSegment(sku.skuCode, sku.skuId);
        const directory = path.posix.join("products", productSegment, skuSegment);
        const eligibleAssets = product.assets
          .filter((asset) => asset.kind === "result" && asset.state !== "rejected")
          .filter((asset) => asset.state === "approved" || includeCandidates)
          .filter((asset) => assetAppliesToSku(asset, product, sku))
          .sort(compareAssets);
        const packageIssues = [];
        const images = [];
        const indexWidth = Math.max(2, String(eligibleAssets.length).length);

        for (let index = 0; index < eligibleAssets.length; index += 1) {
          const asset = eligibleAssets[index];
          const role = cleanText(asset.role, 60).toLowerCase() || "listing";
          const fileName = `${skuSegment}_${String(index + 1).padStart(indexWidth, "0")}_${safeExportSegment(role, "listing")}${outputExtension(format)}`;
          const outputPath = path.posix.join(directory, fileName);
          const imageIssues = [];
          let inspected;
          const cacheKey = `${asset.contentHash}:${profile.requireWhiteMainBackground && profile.mainRoles.includes(role) ? "white-edge" : "decode"}`;
          try {
            inspected = inspectionCache.get(cacheKey);
            if (!inspected) {
              inspected = await inspectManagedAsset(project, asset, profile.requireWhiteMainBackground && profile.mainRoles.includes(role));
              inspectionCache.set(cacheKey, inspected);
            }
          } catch (error) {
            const code = typeof error?.code === "string" ? error.code : "EXPORT_ASSET_INVALID";
            const issue = issueRecord(code, error instanceof Error ? error.message : String(error), {
              productId: product.productId,
              skuId: sku.skuId,
              linkId: asset.linkId
            }, true);
            issues.push(issue);
            packageIssues.push(issue.issueId);
            imageIssues.push(issue.issueId);
          }

          if (inspected) {
            const longEdge = Math.max(inspected.width, inspected.height);
            const aspectRatio = inspected.width / inspected.height;
            if (longEdge < profile.minimumLongEdge) {
              const issue = issueRecord("IMAGE_TOO_SMALL", `${profile.label} 图片长边至少应为 ${profile.minimumLongEdge}px，当前为 ${longEdge}px。`, {
                productId: product.productId, skuId: sku.skuId, linkId: asset.linkId
              });
              issues.push(issue); packageIssues.push(issue.issueId); imageIssues.push(issue.issueId);
            } else if (longEdge < profile.recommendedLongEdge) {
              const issue = issueRecord("IMAGE_BELOW_RECOMMENDED_SIZE", `${profile.label} 建议图片长边达到 ${profile.recommendedLongEdge}px，当前为 ${longEdge}px。`, {
                productId: product.productId, skuId: sku.skuId, linkId: asset.linkId
              });
              issues.push(issue); packageIssues.push(issue.issueId); imageIssues.push(issue.issueId);
            }
            if (Math.abs(aspectRatio - profile.recommendedAspectRatio) > profile.aspectRatioTolerance) {
              const issue = issueRecord("IMAGE_ASPECT_RATIO_MISMATCH", `${profile.label} 建议使用 1:1 图片，当前为 ${inspected.width}:${inspected.height}。`, {
                productId: product.productId, skuId: sku.skuId, linkId: asset.linkId
              });
              issues.push(issue); packageIssues.push(issue.issueId); imageIssues.push(issue.issueId);
            }
            if (profile.requireWhiteMainBackground && profile.mainRoles.includes(role) && inspected.whiteEdgeRatio < profile.whiteBackgroundThreshold) {
              const issue = issueRecord("MAIN_BACKGROUND_NOT_WHITE", `Amazon 主图边缘白底比例为 ${Math.round(inspected.whiteEdgeRatio * 100)}%，低于 ${Math.round(profile.whiteBackgroundThreshold * 100)}%。`, {
                productId: product.productId, skuId: sku.skuId, linkId: asset.linkId
              });
              issues.push(issue); packageIssues.push(issue.issueId); imageIssues.push(issue.issueId);
            }
          }

          images.push({
            linkId: asset.linkId,
            role,
            state: asset.state,
            sourceFileName: asset.fileName,
            outputPath,
            fileName,
            format,
            contentHash: asset.contentHash,
            width: inspected?.width ?? null,
            height: inspected?.height ?? null,
            bytes: inspected?.bytes ?? null,
            valid: Boolean(inspected),
            issueIds: imageIssues,
            ...(inspected?.sourcePath ? { sourcePath: inspected.sourcePath } : {})
          });
          imageCount += 1;
          if (imageCount > MAX_EXPORT_IMAGES) {
            throw new CommerceExportError("EXPORT_IMAGE_LIMIT_REACHED", `单次最多导出 ${MAX_EXPORT_IMAGES} 张图片。`, { maximum: MAX_EXPORT_IMAGES });
          }
        }

        if (!eligibleAssets.length) {
          const issue = issueRecord("SKU_HAS_NO_EXPORTABLE_IMAGES", `SKU ${sku.skuCode} 没有符合当前状态筛选的生成结果。`, {
            productId: product.productId, skuId: sku.skuId
          });
          issues.push(issue); packageIssues.push(issue.issueId);
        } else if (eligibleAssets.length < profile.recommendedImagesPerSku) {
          const issue = issueRecord("SKU_IMAGE_COUNT_BELOW_RECOMMENDED", `${profile.label} 建议每个 SKU 准备 ${profile.recommendedImagesPerSku} 张图片，当前为 ${eligibleAssets.length} 张。`, {
            productId: product.productId, skuId: sku.skuId
          });
          issues.push(issue); packageIssues.push(issue.issueId);
        }
        packages.push({
          productId: product.productId,
          productTitle: product.title,
          productCode: product.productCode || "",
          skuId: sku.skuId,
          skuCode: sku.skuCode,
          skuTitle: sku.title || "",
          directory,
          images,
          issueIds: [...new Set(packageIssues)]
        });
        if (packages.length > MAX_EXPORT_PACKAGES) {
          throw new CommerceExportError("EXPORT_PACKAGE_LIMIT_REACHED", `单次最多导出 ${MAX_EXPORT_PACKAGES} 个 SKU 包。`, { maximum: MAX_EXPORT_PACKAGES });
        }
      }
    }

    if (!packages.length) {
      issues.push(issueRecord("EXPORT_SELECTION_EMPTY", `当前选择中没有可用于 ${profile.label} 的活动 SKU。`));
    }
    const blockingIssues = issues.filter((issue) => issue.severity === "blocking").length;
    return {
      projectId: project.id,
      project,
      catalogRevision: catalog.revision,
      platform: profile.id,
      platformLabel: profile.label,
      format,
      includeCandidates,
      selection: { productIds, skuIds },
      summary: {
        products: new Set(packages.map((item) => item.productId)).size,
        packages: packages.length,
        exportablePackages: packages.filter((item) => item.images.some((image) => image.valid)).length,
        images: imageCount,
        validImages: packages.reduce((total, item) => total + item.images.filter((image) => image.valid).length, 0),
        warnings: issues.length - blockingIssues,
        blockingIssues
      },
      packages,
      issues
    };
  }

  async function preview(payload = {}) {
    return publicPlan(await buildPlan(payload));
  }

  async function exportPackage(payload = {}) {
    if (payload.confirmed !== true) {
      throw new CommerceExportError("EXPORT_CONFIRMATION_REQUIRED", "导出前必须确认当前预检范围。", { confirmed: false });
    }
    const destinationParent = cleanText(payload.destinationParent, 2_048);
    if (!destinationParent || !path.isAbsolute(destinationParent)) {
      throw new CommerceExportError("EXPORT_DESTINATION_REQUIRED", "请选择导出目录。");
    }
    const destinationStats = await stat(destinationParent).catch(() => null);
    if (!destinationStats?.isDirectory()) throw new CommerceExportError("EXPORT_DESTINATION_INVALID", "所选导出位置不是可用目录。");
    const plan = await buildPlan(payload);
    if (plan.summary.blockingIssues) {
      throw new CommerceExportError("COMMERCE_EXPORT_BLOCKED", "部分图片完整性检查失败，未开始导出。", {
        blockingIssues: plan.issues.filter((issue) => issue.severity === "blocking")
      });
    }
    if (!plan.summary.validImages) throw new CommerceExportError("COMMERCE_EXPORT_EMPTY", "当前选择没有可导出的图片。");

    const realDestinationParent = await realpath(destinationParent);
    const stagingPath = await mkdtemp(path.join(realDestinationParent, ".naimage-commerce-export-"));
    const timestamp = now();
    const compactTimestamp = timestamp.replace(/[^0-9TZ]/g, "").replace("T", "-").slice(0, 24) || "export";
    const folderName = `naimage-${plan.platform}-${compactTimestamp}-${randomBytes(3).toString("hex")}`;
    const finalPath = path.join(realDestinationParent, folderName);
    let committed = false;
    try {
      const manifestPackages = [];
      for (const packagePlan of plan.packages) {
        const manifestFiles = [];
        for (const image of packagePlan.images.filter((item) => item.valid)) {
          const destinationPath = path.join(stagingPath, ...image.outputPath.split("/"));
          await mkdir(path.dirname(destinationPath), { recursive: true });
          const exported = await convertImage(image.sourcePath, destinationPath, plan.format);
          const exportedHash = await hashFile(destinationPath);
          manifestFiles.push({
            linkId: image.linkId,
            role: image.role,
            state: image.state,
            file: image.outputPath,
            format: exported.format,
            mimeType: exported.mimeType,
            bytes: exported.bytes,
            sha256: exportedHash,
            width: exported.width,
            height: exported.height,
            sourceContentHash: image.contentHash
          });
        }
        manifestPackages.push({
          productId: packagePlan.productId,
          productTitle: packagePlan.productTitle,
          productCode: packagePlan.productCode,
          skuId: packagePlan.skuId,
          skuCode: packagePlan.skuCode,
          skuTitle: packagePlan.skuTitle,
          directory: packagePlan.directory,
          files: manifestFiles,
          issueIds: packagePlan.issueIds
        });
      }
      const manifest = {
        format: "naimage-commerce-export",
        version: 1,
        generatedAt: timestamp,
        platform: { id: plan.platform, label: plan.platformLabel },
        imageFormat: plan.format,
        catalogRevision: plan.catalogRevision,
        includeCandidates: plan.includeCandidates,
        summary: plan.summary,
        packages: manifestPackages,
        issues: plan.issues
      };
      await writeFile(path.join(stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(stagingPath, finalPath);
      committed = true;
      return {
        ok: true,
        projectId: plan.projectId,
        catalogRevision: plan.catalogRevision,
        platform: plan.platform,
        format: plan.format,
        path: finalPath,
        folderName,
        manifest: "manifest.json",
        summary: plan.summary
      };
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        throw new CommerceExportError("EXPORT_TARGET_EXISTS", "导出目录已存在，请重新选择位置后重试。", { folderName });
      }
      throw error;
    } finally {
      if (!committed) await rm(stagingPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
    }
  }

  return { exportPackage, preview };
}

module.exports = {
  CommerceExportError,
  EXPORT_PROFILES,
  MAX_EXPORT_IMAGES,
  MAX_EXPORT_PACKAGES,
  createProjectCommerceExportService,
  safeExportSegment
};
