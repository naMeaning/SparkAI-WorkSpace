"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  createReadStream,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync
} = require("node:fs");
const path = require("node:path");
const {
  IMAGE_EXPORT_FORMATS,
  convertImageForExport,
  imageExportFilters,
  matchingImageExportExtension
} = require("../image-export-service.cjs");
const { createExportQueueService } = require("../export-queue-service.cjs");
const { writeStreamingZip } = require("../project-package-service.cjs");
const { redactText } = require("../debug-command-service.cjs");
const fsAsync = require("node:fs/promises");

function registerAssetIpc(options = {}) {
  const {
    ipcMain,
    dialog,
    shell,
    BrowserWindow,
    log,
    importLocalImagesToProject,
    importLocalVideosToProject,
    mimeTypeForPath,
    resolveOutputAsset,
    isAllowedAssetPath,
    boundedImageRead,
    maxExportImageBytes,
    validateProjectPackageImageBuffer,
    refineSemanticLayers,
    imageThumbnailCache,
    imageImportStatus,
    recycleProjectImageImporter,
    sanitizeFileStem,
    writeDataUrlOutput,
    createAssetExportContext,
    materializeManagedImageAsset,
    exportFileName,
    aidebugMode,
    aidebugExportFilePath,
    comparablePath,
    releaseTransientExportSources,
    maxFolderExportAssets,
    normalizedExportItem,
    exportGroupMetadata,
    aidebugAssetExportRoot,
    safeExportStem,
    uniqueExportPath,
    isComparablePathInside,
    writeJson,
    removeExportStagingFolder,
    normalizedExportAsset,
    preparePsdRasterSource,
    secureExportSourceCacheDir,
    retainTransientExportSource,
    exportLayeredPsd,
    convertImageForExport: convertImageForExportOverride,
    readJson,
    exportCenterStateService,
    imageCollectionExportService,
    projectSessionFromDisk
  } = options;
  const convertImageForExportImpl = typeof convertImageForExportOverride === "function"
    ? convertImageForExportOverride
    : convertImageForExport;
  const comparablePathImpl = typeof comparablePath === "function"
    ? comparablePath
    : (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const isPathInside = typeof isComparablePathInside === "function"
    ? isComparablePathInside
    : (candidate, root) => {
        const candidatePath = comparablePathImpl(candidate);
        const rootPath = comparablePathImpl(root);
        return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
      };
  const exportTargetTurns = new Map();
  const exportDirectoryAuthorizations = new Map();

  function exportFailure(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  function publicExportMessage(value) {
    return redactText(value instanceof Error ? value.message : String(value || "导出失败。"))
      .replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]")
      .replace(/(?:[a-z]:[\\/]|\\\\)[^\r\n'"]+/gi, "[路径已隐藏]")
      .slice(0, 500);
  }
  function publicQueueResult(result = {}) {
    if (!result || typeof result !== "object" || Array.isArray(result)) return { ok: false, errorCode: "EXPORT_RECEIPT_INVALID", error: "导出记录不完整。" };
    const { path: _path, ...safe } = result;
    for (const key of ["error", "indexWarning", "cleanupWarning"]) if (safe[key]) safe[key] = publicExportMessage(safe[key]);
    return safe;
  }

  function projectExportDirectory(context, category) {
    const declaredProjectRoot = path.resolve(context?.project?.path || "");
    const projectStats = existsSync(declaredProjectRoot) ? lstatSync(declaredProjectRoot) : null;
    if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) {
      exportFailure("PROJECT_PATH_INVALID", "当前项目目录不可用，已取消导出。");
    }
    const realProjectRoot = realpathSync(declaredProjectRoot);
    const requestedRoot = path.join(realProjectRoot, "exports", category);
    if (!isPathInside(requestedRoot, realProjectRoot)) {
      exportFailure("IMAGE_EXPORT_PATH_INVALID", "导出目录越过了当前项目边界。");
    }
    mkdirSync(requestedRoot, { recursive: true });
    const exportStats = lstatSync(requestedRoot);
    if (!exportStats.isDirectory() || exportStats.isSymbolicLink()) {
      exportFailure("IMAGE_EXPORT_PATH_INVALID", "导出目录不是安全的普通目录。");
    }
    const realExportRoot = realpathSync(requestedRoot);
    if (!isPathInside(realExportRoot, realProjectRoot)) {
      exportFailure("IMAGE_EXPORT_PATH_INVALID", "导出目录包含越界链接。");
    }
    return realExportRoot;
  }

  function validatedProjectExportDirectory(selectedPath, exportRoot) {
    const resolved = path.resolve(selectedPath || "");
    if (!existsSync(resolved)) exportFailure("IMAGE_EXPORT_PATH_INVALID", "所选导出目录不存在。");
    const stats = lstatSync(resolved);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      exportFailure("IMAGE_EXPORT_PATH_INVALID", "所选导出位置不是安全的普通目录。");
    }
    const realSelected = realpathSync(resolved);
    if (!isPathInside(realSelected, exportRoot)) {
      exportFailure("IMAGE_EXPORT_OUTSIDE_PROJECT", "导出位置必须位于当前项目的 exports 目录内。");
    }
    return realSelected;
  }

  function validatedProjectExportFile(selectedPath, exportRoot) {
    const resolved = path.resolve(selectedPath || "");
    const realParent = validatedProjectExportDirectory(path.dirname(resolved), exportRoot);
    const target = path.join(realParent, path.basename(resolved));
    if (!isPathInside(target, exportRoot)) {
      exportFailure("IMAGE_EXPORT_OUTSIDE_PROJECT", "导出文件必须位于当前项目的 exports 目录内。");
    }
    if (existsSync(target)) {
      const stats = lstatSync(target);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        exportFailure("IMAGE_EXPORT_PATH_INVALID", "导出目标不是安全的普通文件。");
      }
    }
    return target;
  }

  function validatedAuthorizedExportDirectory(selectedPath) {
    const resolved = path.resolve(selectedPath || "");
    if (!existsSync(resolved)) exportFailure("IMAGE_EXPORT_PATH_INVALID", "所选导出目录不存在。");
    const stats = lstatSync(resolved);
    if (!stats.isDirectory() || stats.isSymbolicLink()) exportFailure("IMAGE_EXPORT_PATH_INVALID", "所选导出位置不是安全的普通目录。");
    return realpathSync(resolved);
  }

  function authorizedExportRoot(authorizationId, projectId) {
    const entry = exportDirectoryAuthorizations.get(String(authorizationId || ""));
    if (!entry) exportFailure("IMAGE_EXPORT_AUTHORIZATION_INVALID", "导出目录授权已失效，请重新选择目录。");
    if (entry.projectId !== projectId) exportFailure("IMAGE_EXPORT_AUTHORIZATION_INVALID", "导出目录授权不属于当前项目。");
    if (Date.now() - entry.createdAt > 30 * 60 * 1000) {
      exportDirectoryAuthorizations.delete(String(authorizationId));
      exportFailure("IMAGE_EXPORT_AUTHORIZATION_EXPIRED", "导出目录授权已过期，请重新选择目录。");
    }
    const root = validatedAuthorizedExportDirectory(entry.path);
    const stats = lstatSync(root);
    if (comparablePathImpl(root) !== entry.realPath || String(stats.dev) !== entry.dev || String(stats.ino) !== entry.ino) exportFailure("IMAGE_EXPORT_AUTHORIZATION_INVALID", "授权目录已经改变，请重新选择目录。");
    return root;
  }

  function strictImageExportFormat(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/^\./, "");
    const alias = normalized === "jpg" ? "jpeg" : normalized === "tif" ? "tiff" : normalized;
    return Object.prototype.hasOwnProperty.call(IMAGE_EXPORT_FORMATS, alias) ? alias : "";
  }

  async function chooseImageExportFormat(owner, payload = {}) {
    if (payload.format !== undefined && payload.format !== null && String(payload.format).trim()) {
      const format = strictImageExportFormat(payload.format);
      if (!format) exportFailure("IMAGE_EXPORT_FORMAT_INVALID", "不支持该图片导出格式。");
      return format;
    }
    if (aidebugMode && payload.aidebugName) return "png";
    return "original";

  }

  async function confirmExportOverwrite(owner, destinationPath, kind) {
    const options = {
      type: "warning",
      title: `最终确认覆盖${kind}`,
      message: `“${path.basename(destinationPath)}”已经存在。是否确认覆盖当前文件？`,
      buttons: ["覆盖", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
    const confirmation = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    return confirmation.response === 0;
  }

  function exportTargetLockKey(filePath) {
    const resolved = path.resolve(filePath);
    try {
      return comparablePathImpl(path.join(realpathSync(path.dirname(resolved)), path.basename(resolved)));
    } catch {
      return comparablePathImpl(resolved);
    }
  }

  async function withExportTargetLock(filePath, operation) {
    const key = exportTargetLockKey(filePath);
    const previous = exportTargetTurns.get(key) || Promise.resolve();
    let releaseTurn;
    const gate = new Promise((resolveGate) => { releaseTurn = resolveGate; });
    const current = previous.catch(() => undefined).then(() => gate);
    exportTargetTurns.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      releaseTurn();
      if (exportTargetTurns.get(key) === current) exportTargetTurns.delete(key);
    }
  }

  function managedImageExportIndex(exportRoot) {
    if (typeof readJson !== "function") return { format: "sparkai-managed-image-export-index", version: 1, entries: [] };
    const indexFile = path.join(exportRoot, ".sparkai-export-index.json");
    if (existsSync(indexFile) && (lstatSync(indexFile).isSymbolicLink() || !lstatSync(indexFile).isFile())) exportFailure("IMAGE_EXPORT_PATH_INVALID", "导出索引不是安全的普通文件。");
    const index = readJson(indexFile, {});
    return {
      format: "sparkai-managed-image-export-index",
      version: 1,
      entries: Array.isArray(index?.entries) ? index.entries.filter((item) => item && typeof item === "object").slice(-500) : []
    };
  }

  function managedImageSourceHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath); let ended = false;
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => { ended = true; });
      stream.on("close", () => ended ? resolve(hash.digest("hex")) : reject(new Error("图片校验读取未完成。")));
    });
  }

  function managedImageExportRelativePath(exportRoot, filePath) {
    const relative = path.relative(path.dirname(path.dirname(exportRoot)), filePath).replace(/\\/g, "/");
    return !relative || relative.startsWith("../") || path.isAbsolute(relative) ? "" : relative;
  }

  function releaseExportSourcesSafely(sources, context) {
    try {
      releaseTransientExportSources(sources, context);
    } catch (error) {
      log(`asset transient source cleanup failed ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  ipcMain.handle("naimage:asset:pick-local-images", async (_event, payload = {}) => {
    try {
      const maxFiles = Math.max(1, Math.min(Number(payload.maxFiles ?? 2000), 2000));
      const result = await dialog.showOpenDialog({
        title: "导入图片到画布",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true, assets: [] };
      const imported = await importLocalImagesToProject({ paths: result.filePaths, projectId: payload.projectId, maxFiles });
      return {
        ok: true,
        ...imported,
        selectedCount: result.filePaths.length,
        truncated: result.filePaths.length > maxFiles || imported.truncated
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset pick local images failed ${message}`);
      return { ok: false, assets: [], errorCode: error?.code || "IMAGE_PICK_FAILED", error: message };
    }
  });

  ipcMain.handle("naimage:asset:pick-local-videos", async (_event, payload = {}) => {
    try {
      const maxFiles = Math.max(1, Math.min(Number(payload.maxFiles ?? 100), 100));
      const result = await dialog.showOpenDialog({
        title: "导入视频到画布",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Videos", extensions: ["mp4", "webm", "mov", "m4v"] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true, assets: [] };
      return await importLocalVideosToProject({ paths: result.filePaths, projectId: payload.projectId, maxFiles });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset pick local videos failed ${message}`);
      return { ok: false, assets: [], errorCode: error?.code || "VIDEO_PICK_FAILED", error: message };
    }
  });

  async function pickReferenceImages(payload = {}) {
    const max = Math.max(1, Math.min(Number(payload.max ?? 9), 200));
    const result = await dialog.showOpenDialog({
      title: String(payload.title || "选择参考图").slice(0, 80),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    const imported = await importLocalImagesToProject({ paths: result.filePaths, projectId: payload.projectId, maxFiles: max });
    const images = imported.assets.map((asset) => ({
      occurrenceId: asset.occurrenceId,
      importBatchId: asset.importBatchId,
      importRootId: asset.importRootId,
      sourceRelativePath: asset.sourceRelativePath,
      sourceRootLabel: asset.sourceRootLabel,
      sourceRootKind: asset.sourceRootKind,
      contentHash: asset.contentHash || asset.sha256,
      name: asset.originalName || path.basename(asset.path || "reference.png"),
      path: asset.path,
      relativePath: asset.relativePath,
      mimeType: mimeTypeForPath(asset.path),
      assetUrl: asset.assetUrl
    }));
    return {
      ok: true,
      images,
      image: images[0],
      truncated: result.filePaths.length > max || imported.truncated,
      selectedCount: result.filePaths.length
    };
  }

  ipcMain.handle("naimage:asset:pick-reference-images", async (_event, payload) => pickReferenceImages(payload ?? {}));

  ipcMain.handle("naimage:asset:pick-reference-image", async () => {
    const result = await pickReferenceImages({ max: 1 });
    return { ...result, images: result.images?.slice(0, 1) };
  });

  ipcMain.handle("naimage:asset:open-folder", async (_event, payload) => {
    const resolved = resolveOutputAsset((payload ?? {}).path);
    if (!resolved) {
      log("asset open folder denied");
      return { ok: false, error: "文件不在 SparkAI WorkSpace 项目输出目录内。" };
    }
    if (!existsSync(resolved)) {
      log(`asset open folder missing ${resolved}`);
      return { ok: false, error: "文件不存在。" };
    }
    shell.showItemInFolder(resolved);
    log(`asset open folder ${resolved}`);
    return { ok: true };
  });

  ipcMain.handle("naimage:asset:read-data-url", async (_event, payload) => {
    try {
      const rawPath = (payload ?? {}).path;
      if (!rawPath || typeof rawPath !== "string") return { ok: false, error: "图片路径无效。" };
      const resolved = path.resolve(rawPath);
      if (!isAllowedAssetPath(resolved)) {
        log(`asset read data url denied ${resolved}`);
        return { ok: false, error: "图片不在 SparkAI WorkSpace 可读取资产目录内。" };
      }
      if (!existsSync(resolved)) {
        log(`asset read data url missing ${resolved}`);
        return { ok: false, error: "图片文件不存在。" };
      }
      const mimeType = mimeTypeForPath(resolved);
      if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) return { ok: false, error: "只支持 PNG/JPG/WEBP 图片。" };
      const imageBuffer = boundedImageRead(resolved, maxExportImageBytes, path.basename(resolved));
      const actualFormat = validateProjectPackageImageBuffer(imageBuffer, path.basename(resolved));
      const dataUrl = `data:${actualFormat.mimeType};base64,${imageBuffer.toString("base64")}`;
      log(`asset read data url ${resolved}`);
      return {
        ok: true,
        dataUrl,
        mimeType: actualFormat.mimeType,
        name: path.basename(resolved)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset read data url failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("naimage:asset:refine-semantic-layers", async (_event, payload = {}) => {
    try {
      const result = await refineSemanticLayers(payload ?? {});
      log(`asset semantic matting completed ${result.width}x${result.height} ${result.reports?.length || 0} report(s)`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = String(error?.code || "SEMANTIC_MATTING_FAILED");
      log(`asset semantic matting failed ${errorCode} ${message}`);
      return { ok: false, errorCode, error: message };
    }
  });

  ipcMain.handle("naimage:asset:isolate-background", async (_event, payload = {}) => {
    try {
      const result = await refineSemanticLayers({ ...(payload || {}), mode: "background-removal" });
      log(`asset background isolation completed ${result.width}x${result.height} ${result.checkerboardDetected ? "checkerboard" : "key"}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = String(error?.code || "BACKGROUND_REMOVAL_FAILED");
      log(`asset background isolation failed ${errorCode} ${message}`);
      return { ok: false, errorCode, error: message };
    }
  });

  ipcMain.handle("naimage:asset:thumbnail-stats", (_event, payload) => {
    try {
      const stats = payload?.reset === true ? imageThumbnailCache.resetStats() : imageThumbnailCache.stats();
      return { ok: true, stats };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:asset:image-import-status", (_event, payload) => ({
    ok: true,
    status: imageImportStatus(payload?.reset === true)
  }));

  ipcMain.handle("naimage:asset:cancel-image-imports", async () => {
    await recycleProjectImageImporter(true);
    return { ok: true, status: imageImportStatus(false) };
  });

  ipcMain.handle("naimage:asset:import-local-images", async (_event, payload) => {
    try {
      return await importLocalImagesToProject(payload ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("asset batch import failed " + message);
      return { ok: false, assets: [], canceled: error?.code === "IMAGE_IMPORT_CLOSED", errorCode: error?.code || "IMAGE_IMPORT_FAILED", error: message };
    }
  });

  ipcMain.handle("naimage:asset:import-local-videos", async (_event, payload) => {
    try {
      return await importLocalVideosToProject(payload ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset video import failed ${message}`);
      return { ok: false, assets: [], errorCode: error?.code || "VIDEO_IMPORT_FAILED", error: message };
    }
  });

  ipcMain.handle("naimage:asset:import-local-image", async (_event, payload) => {
    try {
      const rawPath = (payload ?? {}).path;
      if (!rawPath || typeof rawPath !== "string") return { ok: false, error: "图片路径无效。" };
      const imported = await importLocalImagesToProject({ paths: [rawPath], projectId: (payload ?? {}).projectId, maxFiles: 1 });
      const asset = imported.assets[0];
      if (!asset) return { ok: false, error: "没有找到可导入的 PNG/JPG/WEBP 图片。" };
      log("asset import local image " + asset.path);
      return { ok: true, asset };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset import local image failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("naimage:asset:save-output-image", async (_event, payload) => {
    try {
      const runId = String((payload ?? {}).runId || `asset-${Date.now()}`);
      const dataUrl = String((payload ?? {}).dataUrl || "");
      const identity = createHash("sha256").update(runId).update("\0").update(dataUrl).digest("hex").slice(0, 16);
      const stem = `${sanitizeFileStem((payload ?? {}).stem || "plugin").slice(0, 56)}-${identity}`;
      const asset = writeDataUrlOutput(dataUrl, stem, runId, (payload ?? {}).projectId, {
        bucket: (payload ?? {}).bucket,
        subdir: (payload ?? {}).subdir
      });
      log(`asset save output ${asset.path}`);
      return { ok: true, asset };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset save output failed ${message}`);
      return { ok: false, canceled: error?.code === "IMAGE_IMPORT_CLOSED", errorCode: error?.code || "IMAGE_IMPORT_FAILED", error: message };
    }
  });

  ipcMain.handle("naimage:asset:authorize-export-directory", async (event, payload = {}) => {
    try {
      const context = createAssetExportContext(payload.projectId);
      const owner = BrowserWindow.fromWebContents(event.sender);
      const selected = owner
        ? await dialog.showOpenDialog(owner, { title: "授权图片导出目录", properties: ["openDirectory", "createDirectory"] })
        : await dialog.showOpenDialog({ title: "授权图片导出目录", properties: ["openDirectory", "createDirectory"] });
      if (selected.canceled || !selected.filePaths[0]) return { ok: true, canceled: true };
      const directory = validatedAuthorizedExportDirectory(selected.filePaths[0]);
      const authorizationId = `export-dir-${randomUUID()}`;
      const stats = lstatSync(directory);
      exportDirectoryAuthorizations.set(authorizationId, { path: directory, realPath: comparablePathImpl(directory), projectId: context.project.id, dev: String(stats.dev), ino: String(stats.ino), createdAt: Date.now() });
      return { ok: true, authorizationId, label: path.basename(directory) || directory };
    } catch (error) {
      return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_AUTHORIZATION_FAILED", error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:asset:save-as", async (event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const owner = BrowserWindow.fromWebContents(event.sender);
      let requestedFormat = await chooseImageExportFormat(owner, payload);
      if (!requestedFormat) return { ok: true, canceled: true };
      const source = await materializeManagedImageAsset(payload?.asset, context);
      transientSources.push(source);
      if (requestedFormat === "original") requestedFormat = strictImageExportFormat(source.extension);
      const requestedDefinition = IMAGE_EXPORT_FORMATS[requestedFormat];
      const defaultName = exportFileName(source, payload?.suggestedName);
      let selectedPath = "";
      let projectImageExportRoot = "";
      if (aidebugMode && payload?.aidebugName) {
        selectedPath = aidebugExportFilePath(payload.aidebugName, requestedDefinition.extension, "aidebug-image");
      } else {
        projectImageExportRoot = projectExportDirectory(context, "images");
        const defaultStem = path.parse(defaultName).name;
        const options = {
          title: "图片另存为",
          defaultPath: path.join(projectImageExportRoot, `${defaultStem}${requestedDefinition.extension}`),
          buttonLabel: "保存",
          filters: imageExportFilters(requestedFormat).slice(0, 1)
        };
        const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return { ok: true, canceled: true };
        projectImageExportRoot = validatedAuthorizedExportDirectory(path.dirname(result.filePath));
        selectedPath = validatedProjectExportFile(result.filePath, projectImageExportRoot);
      }
      const matchedPath = matchingImageExportExtension(selectedPath, requestedFormat);
      const destinationPath = projectImageExportRoot
        ? validatedProjectExportFile(matchedPath, projectImageExportRoot)
        : matchedPath;
      return await withExportTargetLock(destinationPath, async () => {
        const existsAtCommit = existsSync(destinationPath);
        if (existsAtCommit && aidebugMode && payload?.aidebugName) {
          const conflict = new Error("AIDebug export target already exists; choose a fresh evidence name.");
          conflict.code = "NAIMAGE_EXPORT_TARGET_EXISTS";
          throw conflict;
        }
        if (existsAtCommit) {
          if (!await confirmExportOverwrite(owner, destinationPath, "图片")) return { ok: true, canceled: true };
        }
        const exported = await convertImageForExportImpl(source.path, destinationPath, requestedFormat, { overwrite: existsAtCommit });
        if (exported.cleanupWarning) log(`asset save as cleanup warning ${exported.cleanupWarning}`);
        log(`asset save as project=${context.project.id} format=${exported.format} bytes=${exported.bytes} converted=${exported.converted}`);
        return {
          ok: true,
          path: exported.path,
          format: exported.format,
          mimeType: exported.mimeType,
          width: exported.width,
          height: exported.height,
          converted: exported.converted,
          ...(exported.cleanupWarning ? { cleanupWarning: exported.cleanupWarning } : {})
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset save as failed ${message}`);
      return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_FAILED", error: message };
    } finally {
      releaseExportSourcesSafely(transientSources, context);
    }
  });

  async function exportManagedAssetOperation(payload = {}, frozenContext) {
    let context = null;
    const transientSources = [];
    try {
      context = frozenContext || createAssetExportContext(payload?.projectId);
      let format = strictImageExportFormat(payload?.format || "original");
      if (!format) exportFailure("IMAGE_EXPORT_FORMAT_INVALID", "请选择有效的图片导出格式。");
      const conflictPolicy = new Set(["overwrite", "keep-both", "skip"]).has(payload?.conflictPolicy)
        ? payload.conflictPolicy
        : "overwrite";
      const frozenSource = frozenContext && payload.frozenSource;
      const source = frozenSource || await materializeManagedImageAsset(payload?.asset, context);
      if (!frozenSource) transientSources.push(source);
      if (format === "original") format = strictImageExportFormat(source.extension);
      const externalRoot = payload?.authorizationId ? authorizedExportRoot(payload.authorizationId, context.project.id) : "";
      const exportRoot = externalRoot || projectExportDirectory(context, "images");
      const definition = IMAGE_EXPORT_FORMATS[format];
      const requestedStem = safeExportStem(path.parse(String(payload?.suggestedName || source.asset?.title || "图片")).name, "图片");
      const requestedPath = validatedProjectExportFile(path.join(exportRoot, `${requestedStem}${definition.extension}`), exportRoot);
      const sourceSha256 = await managedImageSourceHash(source.path);
      if (payload.expectedSourceHash && sourceSha256 !== payload.expectedSourceHash) exportFailure("IMAGE_EXPORT_SOURCE_CHANGED", "图片字节已改变，冻结的导出任务不会改用新来源。");
      if (payload.signal?.aborted) exportFailure("EXPORT_CANCELLED", "导出已取消。");
      const fingerprint = createHash("sha256")
        .update("sparkai-managed-image-export:v1\0")
        .update(sourceSha256)
        .update("\0")
        .update(format)
        .update("\0")
        .update(requestedStem)
        .digest("hex");
      const index = managedImageExportIndex(exportRoot);
      if (payload?.incremental === true) {
        const existing = [...index.entries].reverse().find((item) => item.fingerprint === fingerprint);
        const existingName = path.basename(String(existing?.fileName || ""));
        if (existingName) {
          const existingPath = validatedProjectExportFile(path.join(exportRoot, existingName), exportRoot);
          const existingStats = existsSync(existingPath) ? lstatSync(existingPath) : null;
          if (existingStats?.isFile() && !existingStats.isSymbolicLink() && existingStats.size > 0 && existing.outputSha256 && await managedImageSourceHash(existingPath) === existing.outputSha256) {
            return {
              ok: true,
              skipped: true,
              skippedReason: "unchanged",
              path: existingPath,
              relativePath: externalRoot ? undefined : managedImageExportRelativePath(exportRoot, existingPath),
              format,
              bytes: existingStats.size,
              fingerprint
            };
          }
        }
      }
      let destinationPath = requestedPath;
      const requestedExists = existsSync(destinationPath);
      if (requestedExists && conflictPolicy === "skip") {
        const stats = lstatSync(destinationPath);
        return {
          ok: true,
          skipped: true,
          skippedReason: "conflict",
          path: destinationPath,
          relativePath: externalRoot ? undefined : managedImageExportRelativePath(exportRoot, destinationPath),
          format,
          bytes: stats.isFile() ? stats.size : 0,
          fingerprint
        };
      }
      if (requestedExists && conflictPolicy === "keep-both") destinationPath = uniqueExportPath(exportRoot, path.basename(requestedPath));
      return await withExportTargetLock(destinationPath, async () => {
        const existsAtCommit = existsSync(destinationPath);
        if (existsAtCommit && conflictPolicy === "skip") {
          const stats = lstatSync(destinationPath);
          return {
            ok: true,
            skipped: true,
            skippedReason: "conflict",
            path: destinationPath,
            relativePath: externalRoot ? undefined : managedImageExportRelativePath(exportRoot, destinationPath),
            format,
            bytes: stats.isFile() ? stats.size : 0,
            fingerprint
          };
        }
        if (existsAtCommit && conflictPolicy === "keep-both") {
          exportFailure("NAIMAGE_EXPORT_TARGET_EXISTS", "导出目标刚刚被其他任务占用，请重试。");
        }
        const exported = await convertImageForExportImpl(source.path, destinationPath, format, { overwrite: existsAtCommit, expectedSourceHash: payload.expectedSourceHash, signal: payload.signal });
        const relativePath = externalRoot ? undefined : managedImageExportRelativePath(exportRoot, exported.path);
        const entry = {
          fingerprint,
          assetId: String(source.asset?.assetId || "").slice(0, 160) || undefined,
          sourceSha256,
          format,
          fileName: path.basename(exported.path),
          relativePath,
          bytes: exported.bytes,
          outputSha256: await managedImageSourceHash(exported.path),
          exportedAt: new Date().toISOString()
        };
        let indexWarning = "";
        if (typeof writeJson === "function") {
          try {
            const entries = [...index.entries.filter((item) => item.fingerprint !== fingerprint || item.fileName !== entry.fileName), entry].slice(-500);
            writeJson(path.join(exportRoot, ".sparkai-export-index.json"), { ...index, updatedAt: entry.exportedAt, entries });
          } catch (error) {
            indexWarning = error instanceof Error ? error.message : String(error);
            log(`asset managed export index warning ${indexWarning}`);
          }
        }
        log(`asset managed export project=${context.project.id} format=${format} policy=${conflictPolicy} bytes=${exported.bytes}`);
        return {
          ok: true,
          path: exported.path,
          relativePath,
          format: exported.format,
          mimeType: exported.mimeType,
          width: exported.width,
          height: exported.height,
          bytes: exported.bytes,
          converted: exported.converted,
          fingerprint,
          ...(indexWarning ? { indexWarning } : {}),
          ...(exported.cleanupWarning ? { cleanupWarning: exported.cleanupWarning } : {})
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset managed export failed ${publicExportMessage(message)}`);
      return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_FAILED", error: publicExportMessage(message) };
    } finally {
      releaseExportSourcesSafely(transientSources, context);
    }
  }

  const checkExportCancelled = signal => { if (signal?.aborted) exportFailure("EXPORT_CANCELLED", "导出已取消。"); };
  const exportRelative = (context, file) => {
    const value = path.relative(context.project.path, file).replace(/\\/g, "/");
    return value && !value.startsWith("../") && !path.isAbsolute(value) ? value : undefined;
  };
  function queuedTargetRoot(snapshot, context) {
    return snapshot.target.authorizationId ? authorizedExportRoot(snapshot.target.authorizationId, context.project.id)
      : projectExportDirectory(context, snapshot.params.container === "zip" ? "archives" : snapshot.params.target === "psd" ? "psd" : "images");
  }
  async function queueTargetPath(snapshot, context, name, execute) {
    const root = queuedTargetRoot(snapshot, context), requested = validatedProjectExportFile(path.join(root, name), root);
    const policy = snapshot.params.conflictPolicy || "keep-both";
    return withExportTargetLock(requested, async () => {
      checkExportCancelled(snapshot.signal);
      if (existsSync(requested) && policy === "skip") return { ok: true, skipped: true, skippedCount: snapshot.params.container === "zip" ? snapshot.params.itemCount : 1, skippedReason: "conflict", relativePath: exportRelative(context, requested) };
      const destination = existsSync(requested) && policy === "keep-both" ? uniqueExportPath(root, name) : requested;
      const result = await execute(destination, existsSync(destination) && policy === "overwrite", root);
      return { ok: true, ...result, relativePath: exportRelative(context, destination) };
    });
  }
  async function freezePsdSource(item, context, transientSources) {
    const session = projectSessionFromDisk(context.project), node = (session.nodes || []).find(candidate => candidate.id === item.nodeId);
    if (!node) exportFailure("PSD_EXPORT_NODE_MISSING", "选择的 PSD 来源节点不在当前项目。");
    let layers, width, height;
    if (item.kind === "layer-group") {
      if (node.layerGroup) {
        const group = node.layerGroup;
        const members = session.nodes.filter(candidate => candidate.layerGroup?.id === group.id).sort((left, right) => Number(left.layerGroup.order) - Number(right.layerGroup.order));
        if (members.length !== Number(group.total) || members.some((member, index) => Number(member.layerGroup.order) !== index + 1)) exportFailure("PSD_EXPORT_LAYER_GROUP_INVALID", "图层组层序不完整，无法导出 PSD。");
        layers = members.map(member => ({ asset: member.assets?.[0], title: member.layerGroup.layerTitle || member.title,
          order: member.layerGroup.order, opacity: member.layerGroup.opacity ?? 1, visible: member.layerGroup.visible !== false, blendMode: member.layerGroup.blendMode || "normal" })).reverse();
        width = group.compositionWidth; height = group.compositionHeight;
      } else if (node.layerComposition) {
        layers = (node.layerComposition.layers || []).map(layer => ({ ...layer, title: layer.title || "图层" })).sort((left, right) => Number(right.order) - Number(left.order));
        width = node.layerComposition.width; height = node.layerComposition.height;
      } else exportFailure("PSD_EXPORT_LAYER_GROUP_INVALID", "选择的图层组不存在。");
    } else {
      const index = Math.max(0, Math.floor(Number(item.assetIndex || 0))), asset = node.assets?.[index];
      if (!asset) exportFailure("PSD_EXPORT_ASSET_MISSING", "选择的 PSD 图片已经移除。");
      if (item.asset?.assetId && item.asset.assetId !== asset.assetId || item.asset?.occurrenceId && item.asset.occurrenceId !== asset.occurrenceId || item.asset?.contentHash && item.asset.contentHash !== asset.contentHash) exportFailure("IMAGE_EXPORT_SOURCE_CHANGED", "选择的 PSD 图片身份已经变化。");
      layers = [{ asset, title: `${node.title || "图片成果"}｜图片 ${index + 1}`, visible: true, opacity: 1 }]; width = asset.width; height = asset.height;
    }
    if (!layers.length || layers.length > 64) exportFailure("PSD_EXPORT_LAYER_GROUP_INVALID", "PSD 需要 1–64 个完整图层。");
    const frozenLayers = [];
    for (const layer of layers) {
      if (layer.blendMode && !["normal", "source-over"].includes(layer.blendMode)) exportFailure("PSD_EXPORT_BLEND_UNSUPPORTED", "PSD 包含不支持的混合模式，无法导出。");
      const source = await materializeManagedImageAsset(layer.asset, context); transientSources.push(source);
      if (item.kind === "layer-group" && source.extension !== ".png") exportFailure("PSD_EXPORT_SOURCE_NOT_PNG", "分层 PSD 只接受真实 PNG 图层。");
      const hash = await managedImageSourceHash(source.path);
      if (layer.asset.contentHash && hash !== layer.asset.contentHash) exportFailure("IMAGE_EXPORT_SOURCE_CHANGED", "PSD 来源字节已经改变。");
      frozenLayers.push({ source, contentHash: hash, name: String(layer.title || "图层").slice(0, 255), visible: layer.visible !== false, opacity: Number(layer.opacity ?? 1) });
    }
    return { layers: frozenLayers, width, height, nodeId: node.id, title: node.title || "图片成果" };
  }
  async function exportQueuedPsd(snapshot, context, payload, signal) {
    const prepared = [], transient = [];
    try {
      for (const layer of payload.psd.layers) {
        checkExportCancelled(signal);
        if (await managedImageSourceHash(layer.source.path) !== layer.contentHash) exportFailure("IMAGE_EXPORT_SOURCE_CHANGED", "PSD 来源字节已经改变，冻结任务不会使用新来源。");
        let source = layer.source;
        if (source.extension !== ".png") {
          source = { ...source, ...await preparePsdRasterSource({ sourcePath: source.path, cacheDir: secureExportSourceCacheDir(context), ownerPid: process.pid, signal }), transient: true };
          retainTransientExportSource(source.path); transient.push(source);
        }
        prepared.push({ name: layer.name, path: source.path, opacity: layer.opacity, visible: layer.visible });
      }
      const name = `${safeExportStem(path.parse(payload.suggestedName || payload.psd.title).name, "图片成果")}.psd`;
      return await queueTargetPath({ ...snapshot, signal }, context, name, async (outputPath, overwrite) => {
        checkExportCancelled(signal);
        const result = await exportLayeredPsd({ outputPath, width: Number(payload.psd.width) || undefined, height: Number(payload.psd.height) || undefined, overwrite, layers: prepared, signal });
        return { path: outputPath, count: 1, bytes: result.bytes || lstatSync(outputPath).size, format: "psd", width: result.width, height: result.height };
      });
    } finally { releaseExportSourcesSafely(transient, context); }
  }
  async function zipDirectoryEntries(root, prefix = "") {
    const result = [];
    for (const item of await fsAsync.readdir(root, { withFileTypes: true })) {
      if (item.isSymbolicLink()) exportFailure("EXPORT_ZIP_UNSAFE_SOURCE", "ZIP 暂存目录含链接。");
      const name = prefix ? `${prefix}/${item.name}` : item.name, file = path.join(root, item.name);
      if (item.isDirectory()) result.push(...await zipDirectoryEntries(file, name));
      else if (item.isFile()) result.push({ name, filePath: file });
    }
    return result;
  }
  async function exportQueuedArchive(snapshot, context, payload, signal) {
    const root = queuedTargetRoot(snapshot, context), staging = await fsAsync.mkdtemp(path.join(root, ".naimage-export-zip-"));
    try {
      if (payload.operation === "collection") {
        const frozen = { ...context.collectionPrepared, destinationRoot: staging, exportRoot: staging,
          plans: context.collectionPrepared.plans.map(plan => ({ ...plan, action: "export", skippedReason: undefined, existingEntry: undefined })) };
        await imageCollectionExportService.executeFrozen(frozen, { signal });
      } else {
        const manifest = [];
        for (const item of payload.images) {
          checkExportCancelled(signal);
          const source = item.frozenSource, requested = item.format === "original" ? strictImageExportFormat(source.extension) : strictImageExportFormat(item.format || "original");
          const extension = IMAGE_EXPORT_FORMATS[requested]?.extension;
          if (!extension) exportFailure("IMAGE_EXPORT_FORMAT_INVALID", "ZIP 图片格式无效。");
          const target = uniqueExportPath(staging, `${safeExportStem(item.suggestedName, "图片")}${extension}`);
          const exported = await convertImageForExportImpl(source.path, target, requested, { expectedSourceHash: item.expectedSourceHash, signal, overwrite: false });
          manifest.push({ assetId: item.asset.assetId, occurrenceId: item.asset.occurrenceId, sourceSha256: item.expectedSourceHash, fileName: path.basename(target), format: exported.format });
        }
        writeJson(path.join(staging, "images.json"), { format: "sparkai-image-export", version: 1, images: manifest });
      }
      const entries = await zipDirectoryEntries(staging), name = `${safeExportStem(payload.suggestedName || "图片交付", "图片交付")}.zip`;
      return await queueTargetPath({ ...snapshot, signal }, context, name, async (outputPath, overwrite) => ({
        ...await writeStreamingZip(outputPath, entries, { signal, overwrite }), count: snapshot.params.itemCount,
        exportedCount: snapshot.params.itemCount
      }));
    } finally { await fsAsync.rm(staging, { recursive: true, force: true }); }
  }

  const queueContexts = new Map();
  const managedExportQueue = createExportQueueService({
    persist: async (job) => {
      const context = queueContexts.get(job.snapshot?.params?.contextId);
      if (!context || typeof writeJson !== "function") return;
      const root = realpathSync(context.project.path);
      const meta = path.join(root, ".naimage");
      mkdirSync(meta, { recursive: true });
      if (lstatSync(meta).isSymbolicLink() || !isPathInside(realpathSync(meta), root)) exportFailure("IMAGE_EXPORT_PATH_INVALID", "导出队列目录包含越界链接。");
      const file = path.join(meta, "export-jobs.json");
      if (existsSync(file) && lstatSync(file).isSymbolicLink()) exportFailure("IMAGE_EXPORT_PATH_INVALID", "导出队列记录不是普通文件。");
      const previous = typeof readJson === "function" ? readJson(file, { jobs: [] }) : { jobs: [] };
      const receipt = { ...job, snapshot: { ...job.snapshot, target: { ...job.snapshot.target, authorizationId: undefined }, params: { ...job.snapshot.params, contextId: undefined, projectRoot: undefined } }, results: job.results.map(publicQueueResult) };
      writeJson(file, { format: "sparkai-export-jobs", version: 1, jobs: [...(Array.isArray(previous?.jobs) ? previous.jobs : []).filter((item) => item.id !== job.id), receipt].slice(-100) });
      if (["succeeded", "failed", "cancelled"].includes(job.status) && exportCenterStateService) {
        const results = job.results;
        await exportCenterStateService.recordHistory({ expectedProjectId: context.project.id, entry: {
          id: job.id, jobId: job.id, target: job.snapshot.params.target || "image", format: job.snapshot.params.target === "psd" ? "psd" : job.snapshot.params.format || "original",
          label: `${{ image: "图片", collection: "图片组", psd: "PSD" }[job.snapshot.params.target || "image"]}导出 · ${job.snapshot.params.itemCount || job.snapshot.items.length} 项`, status: job.status === "cancelled" ? "skipped" : job.status,
          itemCount: job.snapshot.params.itemCount || job.snapshot.items.length, exportedCount: results.reduce((sum, item) => sum + (item?.ok && !item.skipped ? Number(item.exportedCount ?? 1) : 0), 0),
          skippedCount: results.reduce((sum, item) => sum + Number(item?.skippedCount ?? (item?.skipped ? 1 : 0)), 0),
          totalBytes: results.reduce((sum, item) => sum + Number(item?.bytes || 0), 0),
          relativePaths: results.flatMap((item) => item?.relativePaths || (item?.relativePath ? [item.relativePath] : [])),
          errorCode: results.find((item) => item?.ok === false)?.errorCode,
          error: job.status === "cancelled" ? "用户取消；已完成文件保留。" : results.find((item) => item?.ok === false)?.error ? publicExportMessage(results.find((item) => item?.ok === false).error) : undefined,
          startedAt: job.startedAt, finishedAt: job.finishedAt
        } }, { allowInactive: true });
      }
      if (["succeeded", "cancelled"].includes(job.status) && !context.sourcesReleased) {
        releaseExportSourcesSafely(context.frozenSources || [], context);
        context.sourcesReleased = true;
      }
    },
    execute: async (snapshot, { signal, item }) => {
      if (signal.aborted) throw Object.assign(new Error("导出已取消。"), { code: "EXPORT_CANCELLED" });
      const context = queueContexts.get(snapshot.params.contextId);
      if (!context || comparablePathImpl(realpathSync(context.project.path)) !== snapshot.params.projectRoot) exportFailure("PROJECT_CHANGED", "冻结项目目录已经改变。");
      let result;
      if (item.payload?.operation === "psd") result = await exportQueuedPsd(snapshot, context, item.payload, signal);
      else if (snapshot.params.container === "zip") result = await exportQueuedArchive(snapshot, context, item.payload, signal);
      else if (item.payload?.operation === "collection") {
        if (snapshot.target.authorizationId) authorizedExportRoot(snapshot.target.authorizationId, context.project.id);
        const exported = await imageCollectionExportService.executeFrozen(context.collectionPrepared, { signal });
        result = { ok: true, bytes: exported.totalBytes, exportedCount: exported.exported.filter(group => !group.skipped).length,
          skippedCount: exported.skippedCount, relativePaths: snapshot.target.authorizationId ? [] : exported.exported.map(group => group.relativePath) };
      } else result = await exportManagedAssetOperation({ ...(item.payload || {}), projectId: snapshot.projectId, authorizationId: snapshot.target.authorizationId, expectedSourceHash: item.contentHash, signal }, context);
      if (!result?.ok) throw Object.assign(new Error(result?.error || "图片导出失败。"), { code: result?.errorCode || "IMAGE_EXPORT_FAILED" });
      return result;
    }
  });
  const queueSnapshot = (job) => ({
    queueId: job?.id,
    projectId: job?.snapshot?.projectId,
    status: job?.status,
    total: job?.snapshot?.params?.itemCount || job?.snapshot?.items?.length || 0,
    completed: job?.completed === job?.snapshot?.items?.length ? (job?.snapshot?.params?.itemCount || job?.completed || 0) : job?.completed || 0,
    canceled: job?.status === "cancelled",
    results: Array.isArray(job?.results) ? job.results.map(publicQueueResult) : [],
    createdAt: job?.snapshot?.createdAt,
    startedAt: job?.startedAt,
    finishedAt: job?.finishedAt,
    snapshotHash: job?.snapshot?.snapshotHash,
    config: { target: job?.snapshot?.params?.target || "image", container: job?.snapshot?.params?.container || "folder", format: job?.snapshot?.params?.format, conflictPolicy: job?.snapshot?.params?.conflictPolicy },
    items: (job?.snapshot?.items || []).map(({ assetId, occurrenceId, contentHash, name }) => ({ assetId, occurrenceId, contentHash, name }))
  });
  function exportQueueProjectId(payload) {
    const projectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
    if (!projectId) exportFailure("PROJECT_REQUIRED", "导出队列操作必须指定项目。");
    return projectId;
  }
  function exportQueueJobForProject(payload, projectId) {
    const queueId = String(payload?.queueId || "").trim(), job = managedExportQueue.get(queueId);
    if (!job) exportFailure("IMAGE_EXPORT_QUEUE_NOT_FOUND", "导出队列不存在。");
    if (job.snapshot.projectId !== projectId) exportFailure("PROJECT_CHANGED", "导出队列不属于指定项目。");
    return job;
  }

  ipcMain.handle("naimage:asset:export-managed", (_event, payload = {}) => exportManagedAssetOperation(payload));
  ipcMain.handle("naimage:asset:export-managed-queue:start", async (_event, payload = {}) => {
    let queueContext = null, contextId = "", accepted = false;
    const frozenSources = [];
    try {
      const projectId = String(payload.projectId || "").trim(), target = payload.target || "image", container = payload.container || "folder";
      if (!projectId) exportFailure("PROJECT_REQUIRED", "当前项目不能为空。");
      if (!["image", "collection", "psd"].includes(target) || !["folder", "zip"].includes(container) || target === "psd" && container === "zip") exportFailure("EXPORT_QUEUE_TARGET_INVALID", "导出类型或容器无效。");
      if (["path", "targetPath", "destinationPath", "outputPath", "absolutePath", "directory"].some(key => payload[key] !== undefined)) exportFailure("EXPORT_TARGET_INVALID", "导出任务只接受 Main 授权引用，不能指定写入路径。");
      queueContext = createAssetExportContext(projectId);
      const destinationRoot = payload.authorizationId ? authorizedExportRoot(payload.authorizationId, projectId) : "";
      const conflictPolicy = payload.conflictPolicy || payload.items?.[0]?.conflictPolicy || "keep-both";
      if (!["keep-both", "overwrite", "skip"].includes(conflictPolicy)) exportFailure("IMAGE_EXPORT_CONFLICT_POLICY_INVALID", "重名处理方式无效。");
      const items = []; let itemCount = 0;
      if (target === "collection") {
        if (!imageCollectionExportService?.freezeExport) exportFailure("IMAGE_COLLECTION_EXPORT_UNAVAILABLE", "图片组导出服务不可用。");
        const request = { expectedProjectId: projectId, collectionIds: payload.collectionIds, format: payload.format || "original",
          filenameTemplate: payload.filenameTemplate, conflictPolicy, incremental: payload.incremental === true, previewToken: payload.previewToken };
        const prepared = destinationRoot ? await imageCollectionExportService.freezeExportToDirectory(request, destinationRoot) : await imageCollectionExportService.freezeExport(request);
        queueContext.collectionPrepared = prepared; itemCount = prepared.collectionIds.length;
        const contentHash = createHash("sha256").update(JSON.stringify(prepared.preview)).digest("hex");
        items.push({ assetId: `collection-batch-${contentHash.slice(0, 24)}`, occurrenceId: "collection-transaction", contentHash, name: "图片组整批事务",
          payload: { operation: "collection", suggestedName: payload.suggestedName || "图片组交付" } });
      } else {
        const rawItems = Array.isArray(payload.items) ? payload.items : [];
        if (!rawItems.length || rawItems.length > 500) exportFailure("IMAGE_EXPORT_QUEUE_INVALID", "导出队列必须包含 1–500 个项目。");
        itemCount = rawItems.length;
        for (const [index, item] of rawItems.entries()) {
          if (["path", "targetPath", "destinationPath", "outputPath", "absolutePath", "directory"].some(key => item[key] !== undefined)) exportFailure("EXPORT_TARGET_INVALID", "导出项不能指定写入路径。");
          if (target === "psd") {
            const psd = await freezePsdSource(item, queueContext, frozenSources), contentHash = createHash("sha256").update(JSON.stringify(psd.layers.map(layer => ({ hash: layer.contentHash, name: layer.name, opacity: layer.opacity, visible: layer.visible })))).digest("hex");
            items.push({ assetId: `psd-${psd.nodeId}`, occurrenceId: `psd-${psd.nodeId}-${item.assetIndex || 0}`, contentHash, name: String(item.suggestedName || psd.title), payload: { operation: "psd", psd, suggestedName: item.suggestedName } });
          } else {
            const asset = item.asset || {}, frozenSource = await materializeManagedImageAsset(asset, queueContext); frozenSources.push(frozenSource);
            const contentHash = await managedImageSourceHash(frozenSource.path);
            if (asset.contentHash && String(asset.contentHash).toLowerCase() !== contentHash) exportFailure("IMAGE_EXPORT_SOURCE_CHANGED", "选择的图片已经改变，请重新选择来源。");
            items.push({ assetId: String(asset.assetId || `asset-${index + 1}`), occurrenceId: String(asset.occurrenceId || asset.assetId || `occurrence-${index + 1}`), contentHash,
              name: String(item.suggestedName || asset.name || "图片"), payload: { asset, frozenSource, expectedSourceHash: contentHash, suggestedName: String(item.suggestedName || "图片"), format: item.format || payload.format || "original", conflictPolicy,
                incremental: item.incremental === true || payload.incremental === true } });
          }
        }
        if (container === "zip") {
          const images = items.map(item => item.payload), contentHash = createHash("sha256").update(items.map(item => item.contentHash).join("|")).digest("hex");
          items.splice(0, items.length, { assetId: `zip-${contentHash.slice(0, 24)}`, occurrenceId: "image-zip-transaction", contentHash, name: "图片 ZIP 事务", payload: { operation: "image-zip", images, suggestedName: payload.suggestedName || "图片交付" } });
        }
      }
      contextId = randomUUID(); queueContext.frozenSources = frozenSources; queueContexts.set(contextId, queueContext);
      const job = await managedExportQueue.enqueue({ projectId, selectionRevision: Number(payload.selectionRevision || 0),
        target: payload.authorizationId ? { kind: "authorized-directory", authorizationId: payload.authorizationId } : { kind: "project", projectId, relativePath: target === "collection" && container !== "zip" ? "image-groups" : `exports/${container === "zip" ? "archives" : target === "psd" ? "psd" : "images"}` },
        params: { contextId, projectRoot: comparablePathImpl(realpathSync(queueContext.project.path)), target, container, itemCount, format: target === "psd" ? "psd" : payload.format || payload.items?.[0]?.format || "original", conflictPolicy }, items });
      accepted = true; return { ok: true, ...queueSnapshot(job) };
    } catch (error) { return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_QUEUE_FAILED", error: publicExportMessage(error) }; }
    finally { if (!accepted) { if (contextId) queueContexts.delete(contextId); releaseExportSourcesSafely(frozenSources, queueContext); } }
  });
  ipcMain.handle("naimage:asset:export-managed-queue:status", async (_event, payload = {}) => {
    try {
      const projectId = exportQueueProjectId(payload);
      if (!payload.queueId) {
        const context = createAssetExportContext(projectId);
        const file = path.join(context.project.path, ".naimage", "export-jobs.json");
        const stored = typeof readJson === "function" ? readJson(file, { jobs: [] }) : { jobs: [] };
        const live = managedExportQueue.list().filter((job) => job.snapshot.projectId === projectId);
        return { ok: true, jobs: live.map(queueSnapshot), history: (Array.isArray(stored?.jobs) ? stored.jobs : []).filter((job) => job?.snapshot?.projectId === projectId && !live.some((item) => item.id === job.id)).map((job) => ({ ...queueSnapshot(job), status: ["queued", "running"].includes(job.status) ? "interrupted" : job.status })) };
      }
      return { ok: true, ...queueSnapshot(exportQueueJobForProject(payload, projectId)) };
    } catch (error) { return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_QUEUE_FAILED", error: publicExportMessage(error) }; }
  });
  ipcMain.handle("naimage:asset:export-managed-queue:cancel", async (_event, payload = {}) => {
    try {
      const projectId = exportQueueProjectId(payload), job = exportQueueJobForProject(payload, projectId);
      const result = await managedExportQueue.cancel(job.id);
      if (!result.ok) exportFailure("IMAGE_EXPORT_QUEUE_NOT_FOUND", "导出队列不存在。");
      return { ok: true, ...queueSnapshot(result) };
    } catch (error) { return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_QUEUE_FAILED", error: publicExportMessage(error) }; }
  });
  ipcMain.handle("naimage:asset:export-managed-queue:retry-failed", async (_event, payload = {}) => {
    try {
      const projectId = exportQueueProjectId(payload), job = exportQueueJobForProject(payload, projectId);
      const retried = await managedExportQueue.retryFailed(job.id);
      if (!retried.length) exportFailure("IMAGE_EXPORT_QUEUE_NOT_RETRYABLE", "没有可重试的失败导出项。");
      return { ok: true, ...queueSnapshot(retried[0]) };
    } catch (error) { return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_QUEUE_FAILED", error: publicExportMessage(error) }; }
  });

  ipcMain.handle("naimage:asset:export-folder", async (event, payload = {}) => {
    let stagingPath = "";
    let selectedParent = "";
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const projectLayerExportRoot = aidebugMode && payload?.aidebugName
        ? ""
        : projectExportDirectory(context, "layers");
      const rawItems = Array.isArray(payload?.assets) ? payload.assets : [];
      if (rawItems.length <= 0) return { ok: false, error: "没有可导出的图片或图层。" };
      if (rawItems.length > maxFolderExportAssets) return { ok: false, error: `单次最多导出 ${maxFolderExportAssets} 张图片。` };
      const items = rawItems
        .map(normalizedExportItem)
        .filter(Boolean)
        .sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex);
      if (items.length <= 0) return { ok: false, error: "没有可导出的有效图片或图层。" };

      const group = exportGroupMetadata(payload?.group);
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (aidebugMode && payload?.aidebugName) {
        selectedParent = aidebugAssetExportRoot();
      } else {
        const options = {
          title: "选择图层文件夹的保存位置",
          defaultPath: projectLayerExportRoot,
          buttonLabel: "导出到此处",
          properties: ["openDirectory", "createDirectory"]
        };
        const selected = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
        if (selected.canceled || !selected.filePaths[0]) return { ok: true, canceled: true };
        selectedParent = validatedProjectExportDirectory(selected.filePaths[0], projectLayerExportRoot);
      }

      const materializedItems = [];
      for (const item of items) {
        const source = await materializeManagedImageAsset(item.asset, context);
        transientSources.push(source);
        materializedItems.push({ ...item, source });
      }
      const previewSource = payload?.previewAsset
        ? await materializeManagedImageAsset(payload.previewAsset, context)
        : null;
      if (previewSource) transientSources.push(previewSource);
      const mergedSource = payload?.mergedAsset
        ? await materializeManagedImageAsset(payload.mergedAsset, context)
        : null;
      if (mergedSource) transientSources.push(mergedSource);

      const defaultFolderName = group.title ? `${group.title}-图层` : "naimage-分层图片";
      const folderName = safeExportStem(payload?.aidebugName || payload?.folderName || defaultFolderName, "naimage-分层图片");
      const targetPath = uniqueExportPath(selectedParent, folderName);
      stagingPath = path.join(selectedParent, `.naimage-export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
      if (!isPathInside(stagingPath, selectedParent)) throw new Error("导出暂存目录无效。");
      mkdirSync(stagingPath, { recursive: false });

      const relativeFiles = [];
      let previewFileName = "";
      let mergedFileName = "";
      if (previewSource) {
        previewFileName = `00-合成预览${previewSource.extension}`;
        copyFileSync(previewSource.path, path.join(stagingPath, previewFileName));
        relativeFiles.push(previewFileName);
      }

      const orderWidth = Math.max(2, String(Math.max(...materializedItems.map((item) => item.order))).length);
      const manifestLayers = [];
      for (const item of materializedItems) {
        const orderLabel = String(item.order).padStart(orderWidth, "0");
        const desiredName = `${orderLabel}-${safeExportStem(item.title, `图层-${orderLabel}`)}${item.source.extension}`;
        const targetFile = uniqueExportPath(stagingPath, desiredName);
        copyFileSync(item.source.path, targetFile);
        const fileName = path.basename(targetFile);
        relativeFiles.push(fileName);
        manifestLayers.push({
          order: item.order,
          title: item.title,
          role: item.role,
          fileName,
          visible: item.visible,
          opacity: item.opacity,
          blendMode: item.blendMode,
          width: Number(item.asset.width) || group.width,
          height: Number(item.asset.height) || group.height
        });
      }

      if (mergedSource) {
        mergedFileName = `99-合成${mergedSource.extension}`;
        const mergedTarget = uniqueExportPath(stagingPath, mergedFileName);
        copyFileSync(mergedSource.path, mergedTarget);
        mergedFileName = path.basename(mergedTarget);
        relativeFiles.push(mergedFileName);
      }

      const manifest = {
        format: "naimage-layer-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        group,
        composite: {
          previewFileName: previewFileName || undefined,
          mergedFileName: mergedFileName || undefined
        },
        layers: manifestLayers
      };
      writeJson(path.join(stagingPath, "layers.json"), manifest);
      relativeFiles.push("layers.json");
      renameSync(stagingPath, targetPath);
      stagingPath = "";
      const files = relativeFiles.map((fileName) => path.join(targetPath, fileName));
      log(`asset export folder project=${context.project.id} layers=${manifestLayers.length} preview=${Boolean(previewSource)} merged=${Boolean(mergedSource)}`);
      return { ok: true, path: targetPath, files, count: manifestLayers.length };
    } catch (error) {
      if (stagingPath && selectedParent) removeExportStagingFolder(stagingPath, selectedParent);
      const message = error instanceof Error ? error.message : String(error);
      log(`asset export folder failed ${message}`);
      return { ok: false, error: message };
    } finally {
      releaseExportSourcesSafely(transientSources, context);
    }
  });

  ipcMain.handle("naimage:asset:export-psd", async (event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const asset = normalizedExportAsset(payload?.asset);
      if (!asset) return { ok: false, error: "没有可导出的图片。" };
      const assetIndex = Math.max(0, Math.floor(Number(payload?.assetIndex ?? 0) || 0));
      const nodeTitle = safeExportStem(payload?.nodeTitle || asset.title || "图片成果", "图片成果");
      const layerName = `${nodeTitle}｜图片 ${assetIndex + 1}`.slice(0, 255);
      const defaultStem = safeExportStem(payload?.suggestedName || `${nodeTitle}-图片-${assetIndex + 1}`, "naimage-图片成果");
      const owner = BrowserWindow.fromWebContents(event.sender);
      let selectedPath = "";
      let projectPsdExportRoot = "";
      if (aidebugMode && payload?.aidebugCancelBeforeMaterialize) return { ok: true, canceled: true };
      if (aidebugMode && payload?.aidebugName) {
        selectedPath = aidebugExportFilePath(payload.aidebugName, ".psd", "aidebug-image-psd");
      } else {
        projectPsdExportRoot = projectExportDirectory(context, "psd");
        const options = {
          title: "导出 Photoshop PSD",
          defaultPath: path.join(projectPsdExportRoot, `${defaultStem}.psd`),
          buttonLabel: "导出 PSD",
          filters: [{ name: "Adobe Photoshop 文档", extensions: ["psd"] }]
        };
        const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (selected.canceled || !selected.filePath) return { ok: true, canceled: true };
        selectedPath = validatedProjectExportFile(selected.filePath, projectPsdExportRoot);
      }

      const matchedOutputPath = path.extname(selectedPath).toLowerCase() === ".psd" ? selectedPath : `${selectedPath}.psd`;
      const outputPath = projectPsdExportRoot
        ? validatedProjectExportFile(matchedOutputPath, projectPsdExportRoot)
        : matchedOutputPath;
      const source = await materializeManagedImageAsset(asset, context);
      transientSources.push(source);
      let psdSource = source;
      if (source.extension !== ".png") {
        const prepared = await preparePsdRasterSource({
          sourcePath: source.path,
          cacheDir: secureExportSourceCacheDir(context),
          ownerPid: process.pid
        });
        psdSource = { ...source, ...prepared, extension: ".png", mimeType: "image/png", transient: true };
        retainTransientExportSource(psdSource.path);
        transientSources.push(psdSource);
      }
      return await withExportTargetLock(outputPath, async () => {
        const existsAtCommit = existsSync(outputPath);
        if (existsAtCommit && aidebugMode && payload?.aidebugName) {
          const conflict = new Error("AIDebug PSD export target already exists; choose a fresh evidence name.");
          conflict.code = "PSD_EXPORT_OUTPUT_EXISTS";
          throw conflict;
        }
        if (existsAtCommit && !await confirmExportOverwrite(owner, outputPath, " PSD")) {
          return { ok: true, canceled: true };
        }
        const exportResult = await exportLayeredPsd({
          outputPath,
          width: Number(asset.width) || Number(psdSource.width) || undefined,
          height: Number(asset.height) || Number(psdSource.height) || undefined,
          overwrite: existsAtCommit,
          layers: [{ name: layerName, path: psdSource.path }],
          onProgress: (progress) => {
            if (progress?.stage === "complete" || progress?.stage === "verify") {
              log(`asset single psd export ${progress.stage} ${progress.completed || 0}/${progress.total || 1}`);
            }
          }
        });
        log(`asset single psd export project=${context.project.id} assetIndex=${assetIndex} source=${source.extension} bytes=${exportResult.bytes || 0}`);
        return {
          ok: true,
          path: outputPath,
          files: [outputPath],
          count: 1,
          width: exportResult.width,
          height: exportResult.height,
          layerNames: exportResult.layerNames
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset single psd export failed ${message}`);
      return { ok: false, error: message };
    } finally {
      releaseExportSourcesSafely(transientSources, context);
    }
  });

  ipcMain.handle("naimage:asset:export-layer-psd", async (event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const rawItems = Array.isArray(payload?.assets) ? payload.assets : [];
      if (rawItems.length <= 0) return { ok: false, error: "没有可导出的 PNG 图层。" };
      if (rawItems.length > 64) return { ok: false, error: "单个 PSD 最多导出 64 个图层。请拆分图层组后重试。" };
      const items = rawItems
        .map(normalizedExportItem)
        .filter(Boolean)
        .sort((left, right) => right.order - left.order || right.sourceIndex - left.sourceIndex);
      if (items.length <= 0) return { ok: false, error: "没有可导出的有效 PNG 图层。" };
      const unsupportedBlend = items.find((item) => item.blendMode !== "normal" && item.blendMode !== "source-over");
      if (unsupportedBlend) {
        return {
          ok: false,
          error: `图层“${unsupportedBlend.title}”使用了 ${unsupportedBlend.blendMode} 混合模式。当前 PSD 导出不会静默改成普通模式，请先改为“正常”后再导出。`
        };
      }

      const group = exportGroupMetadata(payload?.group);
      const defaultStem = safeExportStem(
        payload?.suggestedName || (group.title ? `${group.title}-${String(group.groupNumber || 1).padStart(3, "0")}` : "naimage-分层作品"),
        "naimage-分层作品"
      );
      const owner = BrowserWindow.fromWebContents(event.sender);
      let selectedPath = "";
      let projectPsdExportRoot = "";
      if (aidebugMode && payload?.aidebugName) {
        selectedPath = aidebugExportFilePath(payload.aidebugName, ".psd", "aidebug-layers");
      } else {
        projectPsdExportRoot = projectExportDirectory(context, "psd");
        const options = {
          title: "导出 Photoshop PSD",
          defaultPath: path.join(projectPsdExportRoot, `${defaultStem}.psd`),
          buttonLabel: "导出 PSD",
          filters: [{ name: "Adobe Photoshop 文档", extensions: ["psd"] }]
        };
        const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (selected.canceled || !selected.filePath) return { ok: true, canceled: true };
        selectedPath = validatedProjectExportFile(selected.filePath, projectPsdExportRoot);
      }
      const matchedOutputPath = path.extname(selectedPath).toLowerCase() === ".psd" ? selectedPath : `${selectedPath}.psd`;
      const outputPath = projectPsdExportRoot
        ? validatedProjectExportFile(matchedOutputPath, projectPsdExportRoot)
        : matchedOutputPath;

      const materializedItems = [];
      for (const item of items) {
        const source = await materializeManagedImageAsset(item.asset, context);
        transientSources.push(source);
        if (source.extension !== ".png") {
          throw new Error(`图层“${item.title}”不是 PNG。分层 PSD 只接受保留透明通道的 PNG 图层。`);
        }
        materializedItems.push({ ...item, source });
      }

      return await withExportTargetLock(outputPath, async () => {
        const existsAtCommit = existsSync(outputPath);
        if (existsAtCommit && aidebugMode && payload?.aidebugName) {
          const conflict = new Error("AIDebug PSD export target already exists; choose a fresh evidence name.");
          conflict.code = "PSD_EXPORT_OUTPUT_EXISTS";
          throw conflict;
        }
        if (existsAtCommit && !await confirmExportOverwrite(owner, outputPath, " PSD")) {
          return { ok: true, canceled: true };
        }
        const exportResult = await exportLayeredPsd({
          outputPath,
          width: group.width,
          height: group.height,
          overwrite: existsAtCommit,
          layers: materializedItems.map((item) => ({
            name: item.title,
            path: item.source.path,
            visible: item.visible,
            opacity: item.opacity
          })),
          onProgress: (progress) => {
            if (progress?.stage === "complete" || progress?.stage === "verify") {
              log(`asset psd export ${progress.stage} ${progress.completed || 0}/${progress.total || materializedItems.length}`);
            }
          }
        });
        log(`asset psd export project=${context.project.id} layers=${materializedItems.length} bytes=${exportResult.bytes || 0}`);
        return { ok: true, path: outputPath, files: [outputPath], count: materializedItems.length };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset psd export failed ${message}`);
      return { ok: false, error: message };
    } finally {
      releaseExportSourcesSafely(transientSources, context);
    }
  });
}

module.exports = { registerAssetIpc };
