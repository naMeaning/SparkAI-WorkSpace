"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { createReadStream } = require("node:fs");
const {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} = require("node:fs/promises");
const path = require("node:path");
const {
  IMAGE_EXPORT_FORMATS,
  convertImageForExport: convertImageForExportDefault,
  imageExportFormatFromExtension
} = require("./image-export-service.cjs");

const IMAGE_GROUP_MANIFEST = "image-group.json";
const IMAGE_GROUP_EXPORT_RELATIVE_ROOT = "image-groups";
const LEGACY_IMAGE_GROUP_EXPORT_RELATIVE_ROOT = path.join("exports", "image-groups");
const MAX_COLLECTIONS_PER_EXPORT = 200;
const MAX_IMAGE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_IMAGE_GROUP_FILENAME_TEMPLATE = "{index}-request-{request}";
const IMAGE_GROUP_CONFLICT_POLICIES = new Set(["overwrite", "keep-both", "skip"]);
const IMAGE_GROUP_FILENAME_TOKENS = new Set(["group", "title", "index", "request", "asset"]);

class ImageCollectionExportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ImageCollectionExportError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function cleanText(value, maximum = 240) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

function safeImageCollectionDirectoryName(value, fallback = "图片组") {
  const source = typeof value === "string" ? value.normalize("NFKC") : "";
  let name = source
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!name) name = cleanText(fallback, 80).normalize("NFKC") || "图片组";
  name = name.slice(0, 80).replace(/[. ]+$/g, "").trim() || "图片组";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
  return name.slice(0, 80);
}

function nameKey(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US");
}

function uniqueName(baseValue, occupied) {
  const base = safeImageCollectionDirectoryName(baseValue);
  let candidate = base;
  for (let suffix = 2; occupied.has(nameKey(candidate)); suffix += 1) {
    const marker = ` (${suffix})`;
    candidate = `${base.slice(0, Math.max(1, 80 - marker.length)).replace(/[. ]+$/g, "")}${marker}`;
  }
  occupied.add(nameKey(candidate));
  return candidate;
}

function safeImageCollectionFileStem(value, fallback = "图片") {
  const source = typeof value === "string" ? value.normalize("NFKC") : "";
  let name = source
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!name) name = cleanText(fallback, 120).normalize("NFKC") || "图片";
  name = name.slice(0, 120).replace(/[. ]+$/g, "").trim() || "图片";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
  return name.slice(0, 120);
}

function requestedFilenameTemplate(value) {
  const template = cleanText(value, 160) || DEFAULT_IMAGE_GROUP_FILENAME_TEMPLATE;
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    if (!IMAGE_GROUP_FILENAME_TOKENS.has(String(match[1] || "").toLowerCase())) {
      throw new ImageCollectionExportError(
        "IMAGE_COLLECTION_EXPORT_TEMPLATE_INVALID",
        "命名模板只支持 {group}、{title}、{index}、{request} 和 {asset}。",
        { field: "filenameTemplate", token: cleanText(match[1], 40) }
      );
    }
  }
  return template;
}

function requestedConflictPolicy(value) {
  return IMAGE_GROUP_CONFLICT_POLICIES.has(value) ? value : "overwrite";
}

function uniqueFileStem(baseValue, occupied) {
  const base = safeImageCollectionFileStem(baseValue);
  let candidate = base;
  for (let suffix = 2; occupied.has(nameKey(candidate)); suffix += 1) {
    const marker = ` (${suffix})`;
    candidate = `${base.slice(0, Math.max(1, 120 - marker.length)).replace(/[. ]+$/g, "")}${marker}`;
  }
  occupied.add(nameKey(candidate));
  return candidate;
}

function imageGroupFileName(template, entry, verified, format, occupied) {
  const replacements = {
    group: entry.name,
    title: cleanText(verified.item?.title, 160) || cleanText(verified.asset?.title, 160) || entry.name,
    index: String(verified.order).padStart(3, "0"),
    request: String(verified.requestIndex).padStart(3, "0"),
    asset: cleanText(verified.asset?.assetId || verified.item?.assetId, 160) || `asset-${verified.order}`
  };
  const rendered = template.replace(/\{([^{}]+)\}/g, (_match, token) => replacements[String(token || "").toLowerCase()] || "");
  const stem = uniqueFileStem(rendered, occupied);
  return `${stem}${IMAGE_EXPORT_FORMATS[format].extension}`;
}

function collectionForNode(node) {
  const collection = node?.imageCollection || node?.imageContainerSpec?.collection;
  return collection && typeof collection === "object" && Array.isArray(collection.items) ? collection : null;
}

function collectionEntries(session) {
  const occupied = new Set();
  return (Array.isArray(session?.nodes) ? session.nodes : []).flatMap((node, nodeOrder) => {
    const collection = collectionForNode(node);
    if (!collection) return [];
    const collectionId = cleanText(collection.id, 120);
    if (!collectionId) return [];
    const name = safeImageCollectionDirectoryName(collection.name || node.title);
    return [{ node, nodeOrder, collection, collectionId, name, plannedDirectoryName: uniqueName(name, occupied) }];
  });
}

function requestedCollectionIds(value) {
  const ids = Array.isArray(value) ? value.map((item) => cleanText(item, 120)) : [];
  if (!ids.length || ids.length > MAX_COLLECTIONS_PER_EXPORT || ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new ImageCollectionExportError(
      "IMAGE_COLLECTION_EXPORT_INVALID_ARGUMENT",
      `请选择 1-${MAX_COLLECTIONS_PER_EXPORT} 个不重复的图片组。`,
      { field: "collectionIds" }
    );
  }
  return ids;
}

function requestedImageExportFormat(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/^\./, "");
  const alias = normalized === "jpg" ? "jpeg" : normalized === "tif" ? "tiff" : normalized;
  if (!Object.prototype.hasOwnProperty.call(IMAGE_EXPORT_FORMATS, alias)) {
    throw new ImageCollectionExportError(
      "IMAGE_COLLECTION_EXPORT_FORMAT_REQUIRED",
      "请先选择 PNG、JPEG、WebP、AVIF 或 TIFF 导出格式。",
      { field: "format" }
    );
  }
  return alias;
}

function imageExtension(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (/^\.(?:png|jpe?g|webp|avif|tiff?)$/.test(extension)) return extension === ".jpeg" ? ".jpg" : extension;
  throw new ImageCollectionExportError("IMAGE_COLLECTION_ASSET_FORMAT_UNSUPPORTED", "图片组中存在不支持导出的图片格式。", {
    extension: extension || undefined
  });
}

function fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function publicTaskProvenance(value) {
  if (!value || typeof value !== "object") return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPathInside(candidate, root) {
  const candidatePath = path.resolve(candidate);
  const rootPath = path.resolve(root);
  const candidateKey = process.platform === "win32" ? candidatePath.toLowerCase() : candidatePath;
  const rootKey = process.platform === "win32" ? rootPath.toLowerCase() : rootPath;
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function estimatedConvertedBytes(sourceBytes, sourcePath, format) {
  const bytes = Math.max(1, Number(sourceBytes) || 1);
  const sourceFormat = imageExportFormatFromExtension(sourcePath);
  if (sourceFormat === format) return bytes;
  const ratio = {
    png: 1.1,
    jpeg: 0.75,
    webp: 0.65,
    avif: 0.5,
    tiff: 1.8
  }[format] || 1;
  return Math.max(1, Math.ceil(bytes * ratio));
}

async function secureImageGroupExportRoot(project, { create = false, relativeRoot = IMAGE_GROUP_EXPORT_RELATIVE_ROOT } = {}) {
  const declaredProjectRoot = path.resolve(project?.path || "");
  const projectStats = await lstat(declaredProjectRoot).catch(() => null);
  if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) {
    throw new ImageCollectionExportError("PROJECT_PATH_INVALID", "当前项目目录不可用，已取消导出。");
  }
  const realProjectRoot = await realpath(declaredProjectRoot);
  const requestedRoot = path.join(realProjectRoot, relativeRoot);
  if (!isPathInside(requestedRoot, realProjectRoot)) {
    throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_PATH_INVALID", "图片组导出目录越过了当前项目边界。");
  }

  if (create) await mkdir(requestedRoot, { recursive: true });
  const rootStats = await lstat(requestedRoot).catch(() => null);
  if (rootStats) {
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_PATH_INVALID", "图片组导出目录不是安全的普通目录。");
    }
    const realExportRoot = await realpath(requestedRoot);
    if (!isPathInside(realExportRoot, realProjectRoot)) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_PATH_INVALID", "图片组导出目录包含越界链接。");
    }
    return realExportRoot;
  }

  const declaredParent = path.dirname(requestedRoot);
  const parentStats = await lstat(declaredParent).catch(() => null);
  if (parentStats) {
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_PATH_INVALID", "图片组目录的父目录不是安全的普通目录。");
    }
    const realParent = await realpath(declaredParent);
    if (!isPathInside(realParent, realProjectRoot)) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_PATH_INVALID", "图片组目录的父目录包含越界链接。");
    }
  }
  return requestedRoot;
}

async function readExportEntries(exportRoot) {
  const entries = await readdir(exportRoot, { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const folderPath = path.join(exportRoot, entry.name);
    let manifest = null;
    try {
      const stats = await lstat(path.join(folderPath, IMAGE_GROUP_MANIFEST));
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > 1024 * 1024) continue;
      manifest = JSON.parse(await readFile(path.join(folderPath, IMAGE_GROUP_MANIFEST), "utf8"));
    } catch {
      // Unknown directories are still reserved, but are never treated as app-owned exports.
    }
    result.push({
      directoryName: entry.name,
      folderPath,
      collectionId: cleanText(manifest?.group?.id, 120),
      manifest
    });
  }
  return result;
}

function planManifestMaterial(plan, format, filenameTemplate) {
  return {
    format,
    filenameTemplate,
    group: {
      id: plan.entry.collectionId,
      name: plan.entry.name,
      role: plan.entry.collection.collectionRole === "defects" ? "defects" : "results",
      kind: plan.entry.collection.kind === "series" ? "series" : "batch",
      generationMode: plan.entry.collection.generationMode === "sequential" ? "sequential" : "parallel",
      sourceNodeId: cleanText(plan.entry.collection.sourceNodeId, 160),
      sourceCollectionId: cleanText(plan.entry.collection.sourceCollectionId, 120),
      defectOfNodeId: cleanText(plan.entry.collection.defectOfNodeId, 160)
    },
    images: plan.items.map((verified) => ({
      order: verified.order,
      requestIndex: verified.requestIndex,
      itemId: cleanText(verified.item?.id, 120),
      status: verified.status,
      prompt: cleanText(verified.item?.prompt, 12_000),
      title: cleanText(verified.item?.title, 160),
      assetId: cleanText(verified.asset?.assetId || verified.item?.assetId, 160),
      occurrenceId: cleanText(verified.item?.occurrenceId || verified.asset?.occurrenceId, 80),
      fileName: verified.fileName || "",
      sourceBytes: verified.sourcePath ? verified.bytes : 0,
      sourceSha256: verified.sourcePath ? verified.sha256 : "",
      replacedByAssetId: cleanText(verified.item?.replacedByAssetId, 160),
      replacesItemId: cleanText(verified.item?.replacesItemId, 120),
      defectReason: cleanText(verified.item?.defectReason, 320),
      error: cleanText(verified.item?.error, 320),
      taskProvenance: publicTaskProvenance(verified.item?.taskProvenance)
    }))
  };
}

function planContentFingerprint(plan, format, filenameTemplate) {
  return createHash("sha256")
    .update("sparkai-image-group-export:v2\0")
    .update(JSON.stringify(planManifestMaterial(plan, format, filenameTemplate)))
    .digest("hex");
}

async function existingExportIsUnchanged(entry, plan) {
  if (!entry?.manifest || entry.manifest?.export?.contentFingerprint !== plan.contentFingerprint) return false;
  const manifestImages = Array.isArray(entry.manifest.images) ? entry.manifest.images : [];
  if (manifestImages.length !== plan.items.length) return false;
  for (const verified of plan.items) {
    const persisted = manifestImages.find((item) => Number(item?.order) === verified.order);
    if (!persisted || cleanText(persisted.fileName, 240) !== (verified.fileName || "")) return false;
    if (!verified.sourcePath) continue;
    const fileName = path.basename(verified.fileName);
    if (!fileName || fileName !== verified.fileName || !cleanText(persisted.sha256, 64)) return false;
    const filePath = path.join(entry.folderPath, fileName);
    if (!isPathInside(filePath, entry.folderPath)) return false;
    const stats = await lstat(filePath).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size <= 0) return false;
    if (await fileHash(filePath) !== cleanText(persisted.sha256, 64)) return false;
  }
  return true;
}

function createImageCollectionExportService({
  convertImageForExport = convertImageForExportDefault,
  controlledProjectAssetFile,
  getProjectById,
  projectSessionFromDisk,
  readProjectList,
  resolveProjectRelativePath,
  now = () => new Date().toISOString()
} = {}) {
  if (![controlledProjectAssetFile, getProjectById, projectSessionFromDisk, readProjectList, resolveProjectRelativePath].every((item) => typeof item === "function")) {
    throw new TypeError("image collection export project services are required");
  }

  let operationQueue = Promise.resolve();
  const serialized = (operation) => {
    const run = operationQueue.then(operation, operation);
    operationQueue = run.catch(() => undefined);
    return run;
  };

  function projectForId(value) {
    const projectId = cleanText(value, 160);
    const list = readProjectList();
    if (!projectId || projectId !== cleanText(list?.activeProjectId, 160)) {
      throw new ImageCollectionExportError("PROJECT_CHANGED", "当前项目已切换，请重新发起图片组导出。", { projectId });
    }
    const project = getProjectById(projectId, list);
    if (!project?.path) {
      throw new ImageCollectionExportError("PROJECT_NOT_FOUND", "目标项目不存在或已被移除。", { projectId });
    }
    return project;
  }

  function selectedEntries(project, collectionIds) {
    const session = projectSessionFromDisk(project);
    const allEntries = collectionEntries(session);
    const matchesById = new Map();
    for (const entry of allEntries) {
      if (!matchesById.has(entry.collectionId)) matchesById.set(entry.collectionId, []);
      matchesById.get(entry.collectionId).push(entry);
    }
    return collectionIds.map((collectionId) => {
      const matches = matchesById.get(collectionId) || [];
      if (matches.length !== 1) {
        throw new ImageCollectionExportError(
          matches.length ? "IMAGE_COLLECTION_ID_CONFLICT" : "IMAGE_COLLECTION_NOT_FOUND",
          matches.length ? "图片组 ID 在当前项目中不唯一，未执行导出。" : "图片组不在当前项目中，未执行导出。",
          { collectionId, matchCount: matches.length }
        );
      }
      return matches[0];
    });
  }

  async function verifiedItems(project, entry) {
    const collectionItems = entry.collection.items.map((item, originalOrder) => ({ item, originalOrder }));
    collectionItems.sort((left, right) => {
      const leftRequest = Number.isInteger(Number(left.item?.requestIndex)) ? Number(left.item.requestIndex) : Number.MAX_SAFE_INTEGER;
      const rightRequest = Number.isInteger(Number(right.item?.requestIndex)) ? Number(right.item.requestIndex) : Number.MAX_SAFE_INTEGER;
      return leftRequest - rightRequest
        || (Number(left.item?.assetIndex) || Number.MAX_SAFE_INTEGER) - (Number(right.item?.assetIndex) || Number.MAX_SAFE_INTEGER)
        || left.originalOrder - right.originalOrder
        || String(left.item?.id || "").localeCompare(String(right.item?.id || ""));
    });

    const items = [];
    for (const [orderIndex, { item, originalOrder }] of collectionItems.entries()) {
      const status = item?.status === "pending" || item?.status === "error" ? item.status : "done";
      const requestIndex = Math.max(1, Math.floor(Number(item?.requestIndex ?? originalOrder + 1) || originalOrder + 1));
      const assetIndex = Number(item?.assetIndex);
      const asset = status === "done" && Number.isInteger(assetIndex) && assetIndex >= 1
        ? entry.node.assets?.[assetIndex - 1]
        : undefined;
      if (status !== "done") {
        items.push({ order: orderIndex + 1, requestIndex, item, status, asset: undefined });
        continue;
      }
      if (!asset || asset.status === "pending" || asset.status === "error") {
        throw new ImageCollectionExportError("IMAGE_COLLECTION_ASSET_MISSING", "图片组槽位缺少对应的完成图片，未执行导出。", {
          collectionId: entry.collectionId,
          itemId: cleanText(item?.id, 120),
          requestIndex
        });
      }
      const candidate = cleanText(asset.path, 8_192)
        || resolveProjectRelativePath(project.path, cleanText(asset.relativePath, 8_192));
      const sourcePath = controlledProjectAssetFile(candidate, project.path);
      if (!sourcePath) {
        throw new ImageCollectionExportError("IMAGE_COLLECTION_ASSET_UNMANAGED", "图片组包含不属于当前项目的受管资产，未执行导出。", {
          collectionId: entry.collectionId,
          itemId: cleanText(item?.id, 120),
          requestIndex
        });
      }
      const stats = await lstat(sourcePath).catch(() => null);
      if (!stats?.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) {
        throw new ImageCollectionExportError("IMAGE_COLLECTION_ASSET_INVALID", "图片组包含不可读取的受管图片，未执行导出。", {
          collectionId: entry.collectionId,
          itemId: cleanText(item?.id, 120),
          requestIndex
        });
      }
      const extension = imageExtension(sourcePath);
      items.push({
        order: orderIndex + 1,
        requestIndex,
        item,
        status,
        asset,
        sourcePath,
        extension,
        bytes: stats.size,
        sha256: await fileHash(sourcePath)
      });
    }
    if (!items.some((item) => item.sourcePath)) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EMPTY", "图片组中没有可导出的完成图片。", {
        collectionId: entry.collectionId
      });
    }
    return items;
  }

  async function buildPreview(payload = {}) {
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    const collectionIds = requestedCollectionIds(payload.collectionIds);
    const format = requestedImageExportFormat(payload.format);
    const filenameTemplate = requestedFilenameTemplate(payload.filenameTemplate);
    const conflictPolicy = requestedConflictPolicy(payload.conflictPolicy);
    const incremental = payload.incremental === true;
    const selected = selectedEntries(project, collectionIds);
    const plans = [];
    for (const entry of selected) plans.push({ entry, items: await verifiedItems(project, entry) });

    const exportRoot = await secureImageGroupExportRoot(project);
    const existing = await readExportEntries(exportRoot);
    const selectedIds = new Set(collectionIds);
    const occupiedNames = new Set(
      existing
        .filter((item) => conflictPolicy !== "overwrite" || !selectedIds.has(item.collectionId))
        .map((item) => nameKey(item.directoryName))
    );
    for (const plan of [...plans].sort((left, right) => left.entry.nodeOrder - right.entry.nodeOrder)) {
      const occupiedFiles = new Set();
      for (const verified of plan.items) {
        verified.fileName = verified.sourcePath
          ? imageGroupFileName(filenameTemplate, plan.entry, verified, format, occupiedFiles)
          : undefined;
      }
      plan.contentFingerprint = planContentFingerprint(plan, format, filenameTemplate);
      const existingForCollection = existing.filter((item) => item.collectionId === plan.entry.collectionId);
      let unchanged = null;
      if (incremental) {
        for (const candidate of existingForCollection) {
          if (await existingExportIsUnchanged(candidate, plan)) {
            unchanged = candidate;
            break;
          }
        }
      }
      if (unchanged) {
        plan.action = "skip-unchanged";
        plan.skippedReason = "unchanged";
        plan.directoryName = unchanged.directoryName;
        plan.existingEntry = unchanged;
      } else if (conflictPolicy === "skip" && existingForCollection.length) {
        plan.action = "skip-conflict";
        plan.skippedReason = "conflict";
        plan.directoryName = existingForCollection[0].directoryName;
        plan.existingEntry = existingForCollection[0];
      } else {
        plan.action = "export";
        plan.directoryName = uniqueName(plan.entry.plannedDirectoryName, occupiedNames);
      }
    }

    const groups = plans.map((plan) => {
      const imageItems = plan.items.filter((item) => item.sourcePath);
      const failedItems = plan.items.filter((item) => item.status === "error");
      const pendingItems = plan.items.filter((item) => item.status === "pending");
      const sourceBytes = imageItems.reduce((sum, item) => sum + item.bytes, 0);
      const estimatedBytes = imageItems.reduce(
        (sum, item) => sum + estimatedConvertedBytes(item.bytes, item.sourcePath, format),
        0
      );
      return {
        collectionId: plan.entry.collectionId,
        name: plan.entry.name,
        role: plan.entry.collection.collectionRole === "defects" ? "defects" : "results",
        directoryName: plan.directoryName,
        imageCount: imageItems.length,
        slotCount: plan.items.length,
        failedSlotCount: failedItems.length,
        pendingSlotCount: pendingItems.length,
        sourceBytes,
        estimatedBytes,
        action: plan.action,
        skippedReason: plan.skippedReason,
        contentFingerprint: plan.contentFingerprint
      };
    });
    const previewMaterial = {
      projectId: project.id,
      format,
      filenameTemplate,
      conflictPolicy,
      incremental,
      relativeRoot: IMAGE_GROUP_EXPORT_RELATIVE_ROOT.replace(/\\/g, "/"),
      groups: plans.map((plan) => ({
        collectionId: plan.entry.collectionId,
        name: plan.entry.name,
        role: plan.entry.collection.collectionRole === "defects" ? "defects" : "results",
        directoryName: plan.directoryName,
        action: plan.action,
        contentFingerprint: plan.contentFingerprint,
        items: plan.items.map((item) => ({
          itemId: cleanText(item.item?.id, 120),
          requestIndex: item.requestIndex,
          status: item.status,
          assetId: cleanText(item.asset?.assetId || item.item?.assetId, 160),
          sourceBytes: item.sourcePath ? item.bytes : 0,
          sourceSha256: item.sourcePath ? item.sha256 : "",
          fileName: item.fileName || ""
        }))
      }))
    };
    const previewToken = createHash("sha256").update(JSON.stringify(previewMaterial)).digest("hex");
    const totals = groups.reduce((summary, group) => ({
      imageCount: summary.imageCount + group.imageCount,
      slotCount: summary.slotCount + group.slotCount,
      failedSlotCount: summary.failedSlotCount + group.failedSlotCount,
      pendingSlotCount: summary.pendingSlotCount + group.pendingSlotCount,
      sourceBytes: summary.sourceBytes + group.sourceBytes,
      estimatedBytes: summary.estimatedBytes + group.estimatedBytes,
      skippedCount: summary.skippedCount + (group.action === "export" ? 0 : 1),
      skippedImageCount: summary.skippedImageCount + (group.action === "export" ? 0 : group.imageCount)
    }), { imageCount: 0, slotCount: 0, failedSlotCount: 0, pendingSlotCount: 0, sourceBytes: 0, estimatedBytes: 0, skippedCount: 0, skippedImageCount: 0 });
    return {
      project,
      collectionIds,
      format,
      filenameTemplate,
      conflictPolicy,
      incremental,
      plans,
      exportRoot,
      preview: {
        ok: true,
        projectId: project.id,
        format,
        filenameTemplate,
        conflictPolicy,
        incremental,
        relativeRoot: IMAGE_GROUP_EXPORT_RELATIVE_ROOT.replace(/\\/g, "/"),
        previewToken,
        collectionCount: groups.length,
        ...totals,
        groups
      }
    };
  }

  async function previewCollectionsUnsafe(payload = {}) {
    return (await buildPreview(payload)).preview;
  }

  async function exportCollectionsUnsafe(payload = {}) {
    if (payload.confirmed !== true) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_CONFIRMATION_REQUIRED", "批量导出需要由用户或 Agent 明确触发。", {
        confirmed: false
      });
    }
    const prepared = await buildPreview(payload);
    const expectedPreviewToken = cleanText(payload.previewToken, 128);
    if (!expectedPreviewToken || expectedPreviewToken !== prepared.preview.previewToken) {
      throw new ImageCollectionExportError(
        expectedPreviewToken ? "IMAGE_COLLECTION_EXPORT_PREVIEW_STALE" : "IMAGE_COLLECTION_EXPORT_PREVIEW_REQUIRED",
        expectedPreviewToken
          ? "图片组或导出目录已变化，请重新预检后再导出。"
          : "请先完成图片组导出预检。",
        { previewTokenMatched: false }
      );
    }
    const { project, collectionIds, format, filenameTemplate, conflictPolicy, incremental, plans } = prepared;
    const activePlans = plans.filter((plan) => plan.action === "export");
    const exportRoot = await secureImageGroupExportRoot(project, { create: true });
    const existing = await readExportEntries(exportRoot);
    const selectedIds = new Set(activePlans.map((plan) => plan.entry.collectionId));

    const nonce = randomBytes(8).toString("hex");
    const stagingRoot = activePlans.length ? await mkdtemp(path.join(exportRoot, `.staging-${nonce}-`)) : "";
    const backupRoot = path.join(exportRoot, `.backup-${nonce}`);
    const exportedAt = now();
    const published = [];
    const backups = [];
    try {
      for (const plan of activePlans) {
        const groupStage = path.join(stagingRoot, plan.directoryName);
        await mkdir(groupStage, { recursive: true });
        const manifestItems = [];
        let groupImageBytes = 0;
        let groupConvertedCount = 0;
        for (const verified of plan.items) {
          const fileName = verified.fileName;
          let exportedImage = null;
          let outputSha256 = "";
          if (fileName) {
            exportedImage = await convertImageForExport(verified.sourcePath, path.join(groupStage, fileName), format);
            outputSha256 = await fileHash(exportedImage.path);
            groupImageBytes += exportedImage.bytes;
            if (exportedImage.converted) groupConvertedCount += 1;
          }
          manifestItems.push({
            order: verified.order,
            requestIndex: verified.requestIndex,
            itemId: cleanText(verified.item?.id, 120),
            status: verified.status,
            prompt: cleanText(verified.item?.prompt, 12_000),
            title: cleanText(verified.item?.title, 160) || undefined,
            assetId: cleanText(verified.asset?.assetId || verified.item?.assetId, 160) || undefined,
            occurrenceId: cleanText(verified.item?.occurrenceId || verified.asset?.occurrenceId, 80) || undefined,
            fileName,
            mimeType: fileName ? IMAGE_EXPORT_FORMATS[format].mimeType : undefined,
            bytes: exportedImage?.bytes,
            sha256: outputSha256 || undefined,
            sourceBytes: fileName ? verified.bytes : undefined,
            sourceSha256: fileName ? verified.sha256 : undefined,
            converted: exportedImage?.converted,
            replacedByAssetId: cleanText(verified.item?.replacedByAssetId, 160) || undefined,
            replacesItemId: cleanText(verified.item?.replacesItemId, 120) || undefined,
            defectReason: cleanText(verified.item?.defectReason, 320) || undefined,
            error: cleanText(verified.item?.error, 320) || undefined,
            taskProvenance: publicTaskProvenance(verified.item?.taskProvenance)
          });
        }
        const manifest = {
          format: "naimage-image-group",
          version: 2,
          exportedAt,
          projectId: project.id,
          export: {
            format,
            filenameTemplate,
            conflictPolicy,
            incremental,
            contentFingerprint: plan.contentFingerprint,
            extension: IMAGE_EXPORT_FORMATS[format].extension,
            mimeType: IMAGE_EXPORT_FORMATS[format].mimeType,
            imageCount: plan.items.filter((item) => item.sourcePath).length,
            slotCount: plan.items.length,
            failedSlotCount: plan.items.filter((item) => item.status === "error").length,
            pendingSlotCount: plan.items.filter((item) => item.status === "pending").length,
            imageBytes: groupImageBytes,
            convertedCount: groupConvertedCount
          },
          group: {
            id: plan.entry.collectionId,
            name: plan.entry.name,
            directoryName: plan.directoryName,
            role: plan.entry.collection.collectionRole === "defects" ? "defects" : "results",
            kind: plan.entry.collection.kind === "series" ? "series" : "batch",
            generationMode: plan.entry.collection.generationMode === "sequential" ? "sequential" : "parallel",
            nodeId: plan.entry.node.id,
            sourceNodeId: cleanText(plan.entry.collection.sourceNodeId, 160) || undefined,
            sourceCollectionId: cleanText(plan.entry.collection.sourceCollectionId, 120) || undefined,
            defectOfNodeId: cleanText(plan.entry.collection.defectOfNodeId, 160) || undefined,
            createdAt: cleanText(plan.entry.collection.createdAt, 80) || undefined
          },
          images: manifestItems
        };
        const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(path.join(groupStage, IMAGE_GROUP_MANIFEST), manifestText, "utf8");
        plan.manifest = manifest;
        plan.imageBytes = groupImageBytes;
        plan.manifestBytes = Buffer.byteLength(manifestText);
        plan.convertedCount = groupConvertedCount;
      }

      if (activePlans.length) await mkdir(backupRoot, { recursive: true });
      const targets = new Map();
      if (conflictPolicy === "overwrite") {
        for (const item of existing) {
          if (selectedIds.has(item.collectionId)) targets.set(item.folderPath, item.directoryName);
        }
      }
      for (const plan of activePlans) {
        const finalPath = path.join(exportRoot, plan.directoryName);
        const matching = existing.find((item) => path.resolve(item.folderPath) === path.resolve(finalPath));
        if (matching && conflictPolicy === "overwrite") targets.set(matching.folderPath, matching.directoryName);
        if (matching && conflictPolicy !== "overwrite") {
          throw new ImageCollectionExportError(
            "IMAGE_COLLECTION_EXPORT_PREVIEW_STALE",
            "图片组导出目录已被占用，请重新预检后再导出。",
            { directoryName: plan.directoryName, conflictPolicy }
          );
        }
      }
      let backupIndex = 0;
      for (const [sourcePath, directoryName] of targets) {
        const backupPath = path.join(backupRoot, `${String(++backupIndex).padStart(3, "0")}-${directoryName}`);
        await rename(sourcePath, backupPath);
        backups.push({ originalPath: sourcePath, backupPath });
      }
      for (const plan of activePlans) {
        const finalPath = path.join(exportRoot, plan.directoryName);
        await rename(path.join(stagingRoot, plan.directoryName), finalPath);
        published.push(finalPath);
      }
      if (activePlans.length) await rm(backupRoot, { recursive: true, force: true });
      if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
      return {
        ok: true,
        projectId: project.id,
        format,
        filenameTemplate,
        conflictPolicy,
        incremental,
        relativeRoot: IMAGE_GROUP_EXPORT_RELATIVE_ROOT.replace(/\\/g, "/"),
        exportedAt,
        previewToken: prepared.preview.previewToken,
        imageCount: activePlans.reduce((sum, plan) => sum + plan.items.filter((item) => item.sourcePath).length, 0),
        requestedImageCount: plans.reduce((sum, plan) => sum + plan.items.filter((item) => item.sourcePath).length, 0),
        skippedCount: plans.length - activePlans.length,
        skippedImageCount: plans.filter((plan) => plan.action !== "export").reduce((sum, plan) => sum + plan.items.filter((item) => item.sourcePath).length, 0),
        slotCount: plans.reduce((sum, plan) => sum + plan.items.length, 0),
        failedSlotCount: plans.reduce((sum, plan) => sum + plan.items.filter((item) => item.status === "error").length, 0),
        pendingSlotCount: plans.reduce((sum, plan) => sum + plan.items.filter((item) => item.status === "pending").length, 0),
        sourceBytes: prepared.preview.sourceBytes,
        estimatedBytes: prepared.preview.estimatedBytes,
        imageBytes: activePlans.reduce((sum, plan) => sum + plan.imageBytes, 0),
        manifestBytes: activePlans.reduce((sum, plan) => sum + plan.manifestBytes, 0),
        totalBytes: activePlans.reduce((sum, plan) => sum + plan.imageBytes + plan.manifestBytes, 0),
        convertedCount: activePlans.reduce((sum, plan) => sum + plan.convertedCount, 0),
        exported: plans.map((plan) => ({
          collectionId: plan.entry.collectionId,
          name: plan.entry.name,
          role: plan.entry.collection.collectionRole === "defects" ? "defects" : "results",
          directoryName: plan.directoryName,
          relativePath: path.posix.join(IMAGE_GROUP_EXPORT_RELATIVE_ROOT.replace(/\\/g, "/"), plan.directoryName),
          imageCount: plan.action === "export" ? plan.items.filter((item) => item.sourcePath).length : 0,
          requestedImageCount: plan.items.filter((item) => item.sourcePath).length,
          skipped: plan.action !== "export",
          skippedReason: plan.skippedReason,
          contentFingerprint: plan.contentFingerprint,
          itemCount: plan.items.length,
          failedSlotCount: plan.items.filter((item) => item.status === "error").length,
          pendingSlotCount: plan.items.filter((item) => item.status === "pending").length,
          imageBytes: plan.imageBytes || 0,
          manifestBytes: plan.manifestBytes || 0,
          totalBytes: (plan.imageBytes || 0) + (plan.manifestBytes || 0),
          convertedCount: plan.convertedCount || 0,
          manifest: IMAGE_GROUP_MANIFEST
        }))
      };
    } catch (error) {
      for (const finalPath of published.reverse()) await rm(finalPath, { recursive: true, force: true }).catch(() => undefined);
      for (const backup of backups.reverse()) await rename(backup.backupPath, backup.originalPath).catch(() => undefined);
      await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
      if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function resolveExportedCollectionFolderUnsafe(payload = {}) {
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    const collectionId = cleanText(payload.collectionId, 120);
    if (!collectionId) throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_INVALID_ARGUMENT", "图片组 ID 不能为空。", { field: "collectionId" });
    selectedEntries(project, [collectionId]);
    const roots = [];
    for (const relativeRoot of [IMAGE_GROUP_EXPORT_RELATIVE_ROOT, LEGACY_IMAGE_GROUP_EXPORT_RELATIVE_ROOT]) {
      const exportRoot = await secureImageGroupExportRoot(project, { relativeRoot });
      const matches = (await readExportEntries(exportRoot)).filter((entry) => entry.collectionId === collectionId);
      if (matches.length > 1) {
        throw new ImageCollectionExportError(
          "IMAGE_COLLECTION_EXPORT_CONFLICT",
          "该图片组存在多个导出目录，请重新导出后再打开。",
          { collectionId, matchCount: matches.length }
        );
      }
      if (matches.length === 1) roots.push({ exportRoot, match: matches[0], legacy: relativeRoot === LEGACY_IMAGE_GROUP_EXPORT_RELATIVE_ROOT });
    }
    const resolved = roots.find((entry) => !entry.legacy) || roots[0];
    if (!resolved) {
      throw new ImageCollectionExportError(
        "IMAGE_COLLECTION_NOT_EXPORTED",
        "该图片组尚未导出，请先执行图片组导出。",
        { collectionId, matchCount: 0 }
      );
    }
    const stats = await lstat(resolved.match.folderPath).catch(() => null);
    const resolvedRoot = await realpath(resolved.exportRoot).catch(() => "");
    const resolvedFolder = await realpath(resolved.match.folderPath).catch(() => "");
    if (!stats?.isDirectory() || stats.isSymbolicLink() || !resolvedRoot || !resolvedFolder || !isPathInside(resolvedFolder, resolvedRoot)) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_INVALID", "图片组导出目录不可用，请重新导出。", { collectionId });
    }
    return { projectId: project.id, collectionId, directoryName: resolved.match.directoryName, folderPath: resolvedFolder };
  }

  return {
    previewCollections: (payload) => serialized(() => previewCollectionsUnsafe(payload)),
    exportCollections: (payload) => serialized(() => exportCollectionsUnsafe(payload)),
    resolveExportedCollectionFolder: (payload) => serialized(() => resolveExportedCollectionFolderUnsafe(payload))
  };
}

module.exports = {
  DEFAULT_IMAGE_GROUP_FILENAME_TEMPLATE,
  IMAGE_GROUP_EXPORT_RELATIVE_ROOT,
  LEGACY_IMAGE_GROUP_EXPORT_RELATIVE_ROOT,
  IMAGE_GROUP_MANIFEST,
  ImageCollectionExportError,
  createImageCollectionExportService,
  requestedFilenameTemplate,
  safeImageCollectionDirectoryName,
  safeImageCollectionFileStem
};
