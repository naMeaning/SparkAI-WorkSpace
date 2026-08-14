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
const IMAGE_GROUP_EXPORT_RELATIVE_ROOT = path.join("exports", "image-groups");
const MAX_COLLECTIONS_PER_EXPORT = 200;
const MAX_IMAGE_BYTES = 1024 * 1024 * 1024;

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

async function secureImageGroupExportRoot(project, { create = false } = {}) {
  const declaredProjectRoot = path.resolve(project?.path || "");
  const projectStats = await lstat(declaredProjectRoot).catch(() => null);
  if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) {
    throw new ImageCollectionExportError("PROJECT_PATH_INVALID", "当前项目目录不可用，已取消导出。");
  }
  const realProjectRoot = await realpath(declaredProjectRoot);
  const requestedRoot = path.join(realProjectRoot, IMAGE_GROUP_EXPORT_RELATIVE_ROOT);
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
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_PATH_INVALID", "项目 exports 目录不是安全的普通目录。");
    }
    const realParent = await realpath(declaredParent);
    if (!isPathInside(realParent, realProjectRoot)) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_PATH_INVALID", "项目 exports 目录包含越界链接。");
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
    const selected = selectedEntries(project, collectionIds);
    const plans = [];
    for (const entry of selected) plans.push({ entry, items: await verifiedItems(project, entry) });

    const exportRoot = await secureImageGroupExportRoot(project);
    const existing = await readExportEntries(exportRoot);
    const selectedIds = new Set(collectionIds);
    const occupiedNames = new Set(
      existing.filter((item) => !selectedIds.has(item.collectionId)).map((item) => nameKey(item.directoryName))
    );
    for (const plan of [...plans].sort((left, right) => left.entry.nodeOrder - right.entry.nodeOrder)) {
      plan.directoryName = uniqueName(plan.entry.plannedDirectoryName, occupiedNames);
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
        estimatedBytes
      };
    });
    const previewMaterial = {
      projectId: project.id,
      format,
      groups: plans.map((plan) => ({
        collectionId: plan.entry.collectionId,
        name: plan.entry.name,
        role: plan.entry.collection.collectionRole === "defects" ? "defects" : "results",
        directoryName: plan.directoryName,
        items: plan.items.map((item) => ({
          itemId: cleanText(item.item?.id, 120),
          requestIndex: item.requestIndex,
          status: item.status,
          assetId: cleanText(item.asset?.assetId || item.item?.assetId, 160),
          sourceBytes: item.sourcePath ? item.bytes : 0,
          sourceSha256: item.sourcePath ? item.sha256 : ""
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
      estimatedBytes: summary.estimatedBytes + group.estimatedBytes
    }), { imageCount: 0, slotCount: 0, failedSlotCount: 0, pendingSlotCount: 0, sourceBytes: 0, estimatedBytes: 0 });
    return {
      project,
      collectionIds,
      format,
      plans,
      exportRoot,
      preview: {
        ok: true,
        projectId: project.id,
        format,
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
    const { project, collectionIds, format, plans } = prepared;
    const exportRoot = await secureImageGroupExportRoot(project, { create: true });
    const existing = await readExportEntries(exportRoot);
    const selectedIds = new Set(collectionIds);

    const nonce = randomBytes(8).toString("hex");
    const stagingRoot = await mkdtemp(path.join(exportRoot, `.staging-${nonce}-`));
    const backupRoot = path.join(exportRoot, `.backup-${nonce}`);
    const exportedAt = now();
    const published = [];
    const backups = [];
    try {
      for (const plan of plans) {
        const groupStage = path.join(stagingRoot, plan.directoryName);
        await mkdir(groupStage, { recursive: true });
        const manifestItems = [];
        let groupImageBytes = 0;
        let groupConvertedCount = 0;
        for (const verified of plan.items) {
          const fileName = verified.sourcePath
            ? `${String(verified.order).padStart(3, "0")}-request-${String(verified.requestIndex).padStart(3, "0")}${IMAGE_EXPORT_FORMATS[format].extension}`
            : undefined;
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
          version: 1,
          exportedAt,
          projectId: project.id,
          export: {
            format,
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

      await mkdir(backupRoot, { recursive: true });
      const targets = new Map();
      for (const item of existing) {
        if (selectedIds.has(item.collectionId)) targets.set(item.folderPath, item.directoryName);
      }
      for (const plan of plans) {
        const finalPath = path.join(exportRoot, plan.directoryName);
        const matching = existing.find((item) => path.resolve(item.folderPath) === path.resolve(finalPath));
        if (matching) targets.set(matching.folderPath, matching.directoryName);
      }
      let backupIndex = 0;
      for (const [sourcePath, directoryName] of targets) {
        const backupPath = path.join(backupRoot, `${String(++backupIndex).padStart(3, "0")}-${directoryName}`);
        await rename(sourcePath, backupPath);
        backups.push({ originalPath: sourcePath, backupPath });
      }
      for (const plan of plans) {
        const finalPath = path.join(exportRoot, plan.directoryName);
        await rename(path.join(stagingRoot, plan.directoryName), finalPath);
        published.push(finalPath);
      }
      await rm(backupRoot, { recursive: true, force: true });
      await rm(stagingRoot, { recursive: true, force: true });
      return {
        ok: true,
        projectId: project.id,
        format,
        exportedAt,
        previewToken: prepared.preview.previewToken,
        imageCount: plans.reduce((sum, plan) => sum + plan.items.filter((item) => item.sourcePath).length, 0),
        slotCount: plans.reduce((sum, plan) => sum + plan.items.length, 0),
        failedSlotCount: plans.reduce((sum, plan) => sum + plan.items.filter((item) => item.status === "error").length, 0),
        pendingSlotCount: plans.reduce((sum, plan) => sum + plan.items.filter((item) => item.status === "pending").length, 0),
        sourceBytes: prepared.preview.sourceBytes,
        estimatedBytes: prepared.preview.estimatedBytes,
        imageBytes: plans.reduce((sum, plan) => sum + plan.imageBytes, 0),
        manifestBytes: plans.reduce((sum, plan) => sum + plan.manifestBytes, 0),
        totalBytes: plans.reduce((sum, plan) => sum + plan.imageBytes + plan.manifestBytes, 0),
        convertedCount: plans.reduce((sum, plan) => sum + plan.convertedCount, 0),
        exported: plans.map((plan) => ({
          collectionId: plan.entry.collectionId,
          name: plan.entry.name,
          role: plan.entry.collection.collectionRole === "defects" ? "defects" : "results",
          directoryName: plan.directoryName,
          relativePath: path.posix.join("exports", "image-groups", plan.directoryName),
          imageCount: plan.items.filter((item) => item.sourcePath).length,
          itemCount: plan.items.length,
          failedSlotCount: plan.items.filter((item) => item.status === "error").length,
          pendingSlotCount: plan.items.filter((item) => item.status === "pending").length,
          imageBytes: plan.imageBytes,
          manifestBytes: plan.manifestBytes,
          totalBytes: plan.imageBytes + plan.manifestBytes,
          convertedCount: plan.convertedCount,
          manifest: IMAGE_GROUP_MANIFEST
        }))
      };
    } catch (error) {
      for (const finalPath of published.reverse()) await rm(finalPath, { recursive: true, force: true }).catch(() => undefined);
      for (const backup of backups.reverse()) await rename(backup.backupPath, backup.originalPath).catch(() => undefined);
      await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function resolveExportedCollectionFolderUnsafe(payload = {}) {
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    const collectionId = cleanText(payload.collectionId, 120);
    if (!collectionId) throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_INVALID_ARGUMENT", "图片组 ID 不能为空。", { field: "collectionId" });
    selectedEntries(project, [collectionId]);
    const exportRoot = await secureImageGroupExportRoot(project);
    const matches = (await readExportEntries(exportRoot)).filter((entry) => entry.collectionId === collectionId);
    if (matches.length !== 1) {
      throw new ImageCollectionExportError(
        matches.length ? "IMAGE_COLLECTION_EXPORT_CONFLICT" : "IMAGE_COLLECTION_NOT_EXPORTED",
        matches.length ? "该图片组存在多个导出目录，请重新导出后再打开。" : "该图片组尚未导出，请先执行图片组导出。",
        { collectionId, matchCount: matches.length }
      );
    }
    const stats = await lstat(matches[0].folderPath).catch(() => null);
    const resolvedRoot = await realpath(exportRoot).catch(() => "");
    const resolvedFolder = await realpath(matches[0].folderPath).catch(() => "");
    if (!stats?.isDirectory() || stats.isSymbolicLink() || !resolvedRoot || !resolvedFolder || !isPathInside(resolvedFolder, resolvedRoot)) {
      throw new ImageCollectionExportError("IMAGE_COLLECTION_EXPORT_INVALID", "图片组导出目录不可用，请重新导出。", { collectionId });
    }
    return { projectId: project.id, collectionId, directoryName: matches[0].directoryName, folderPath: resolvedFolder };
  }

  return {
    previewCollections: (payload) => serialized(() => previewCollectionsUnsafe(payload)),
    exportCollections: (payload) => serialized(() => exportCollectionsUnsafe(payload)),
    resolveExportedCollectionFolder: (payload) => serialized(() => resolveExportedCollectionFolderUnsafe(payload))
  };
}

module.exports = {
  IMAGE_GROUP_EXPORT_RELATIVE_ROOT,
  IMAGE_GROUP_MANIFEST,
  ImageCollectionExportError,
  createImageCollectionExportService,
  safeImageCollectionDirectoryName
};
