"use strict";

const { createHash } = require("node:crypto");
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
    readJson
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

  function exportFailure(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
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
    const formats = Object.keys(IMAGE_EXPORT_FORMATS);
    const options = {
      type: "question",
      title: "选择图片导出格式",
      message: "请先选择格式，再选择项目内的文件名。",
      detail: "JPEG 会使用白色背景展平透明像素；其他格式保留透明通道。",
      buttons: [...formats.map((format) => IMAGE_EXPORT_FORMATS[format].label.replace(/\s*图片$/, "")), "取消"],
      defaultId: 0,
      cancelId: formats.length,
      noLink: true
    };
    const selected = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    return selected.response >= 0 && selected.response < formats.length ? formats[selected.response] : "";
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
    const index = readJson(path.join(exportRoot, ".sparkai-export-index.json"), {});
    return {
      format: "sparkai-managed-image-export-index",
      version: 1,
      entries: Array.isArray(index?.entries) ? index.entries.filter((item) => item && typeof item === "object").slice(-500) : []
    };
  }

  function managedImageSourceHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
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

  ipcMain.handle("naimage:asset:save-as", async (event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const owner = BrowserWindow.fromWebContents(event.sender);
      const requestedFormat = await chooseImageExportFormat(owner, payload);
      if (!requestedFormat) return { ok: true, canceled: true };
      const requestedDefinition = IMAGE_EXPORT_FORMATS[requestedFormat];
      const source = await materializeManagedImageAsset(payload?.asset, context);
      transientSources.push(source);
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

  ipcMain.handle("naimage:asset:export-managed", async (_event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const format = strictImageExportFormat(payload?.format);
      if (!format) exportFailure("IMAGE_EXPORT_FORMAT_INVALID", "请选择有效的图片导出格式。");
      const conflictPolicy = new Set(["overwrite", "keep-both", "skip"]).has(payload?.conflictPolicy)
        ? payload.conflictPolicy
        : "overwrite";
      const source = await materializeManagedImageAsset(payload?.asset, context);
      transientSources.push(source);
      const exportRoot = projectExportDirectory(context, "images");
      const definition = IMAGE_EXPORT_FORMATS[format];
      const requestedStem = safeExportStem(path.parse(String(payload?.suggestedName || source.asset?.title || "图片")).name, "图片");
      const requestedPath = validatedProjectExportFile(path.join(exportRoot, `${requestedStem}${definition.extension}`), exportRoot);
      const sourceSha256 = await managedImageSourceHash(source.path);
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
          if (existingStats?.isFile() && !existingStats.isSymbolicLink() && existingStats.size > 0) {
            return {
              ok: true,
              skipped: true,
              skippedReason: "unchanged",
              path: existingPath,
              relativePath: managedImageExportRelativePath(exportRoot, existingPath),
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
          relativePath: managedImageExportRelativePath(exportRoot, destinationPath),
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
            relativePath: managedImageExportRelativePath(exportRoot, destinationPath),
            format,
            bytes: stats.isFile() ? stats.size : 0,
            fingerprint
          };
        }
        if (existsAtCommit && conflictPolicy === "keep-both") {
          exportFailure("NAIMAGE_EXPORT_TARGET_EXISTS", "导出目标刚刚被其他任务占用，请重试。");
        }
        const exported = await convertImageForExportImpl(source.path, destinationPath, format, { overwrite: existsAtCommit });
        const relativePath = managedImageExportRelativePath(exportRoot, exported.path);
        const entry = {
          fingerprint,
          assetId: String(source.asset?.assetId || "").slice(0, 160) || undefined,
          sourceSha256,
          format,
          fileName: path.basename(exported.path),
          relativePath,
          bytes: exported.bytes,
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
      log(`asset managed export failed ${message}`);
      return { ok: false, errorCode: error?.code || "IMAGE_EXPORT_FAILED", error: message };
    } finally {
      releaseExportSourcesSafely(transientSources, context);
    }
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
