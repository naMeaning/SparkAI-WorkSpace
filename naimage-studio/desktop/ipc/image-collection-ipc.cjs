"use strict";

function errorResult(error, fallback = "图片组操作失败。") {
  return {
    ok: false,
    errorCode: typeof error?.code === "string" ? error.code : "IMAGE_COLLECTION_OPERATION_FAILED",
    error: error instanceof Error ? error.message : String(error || fallback),
    ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
  };
}

function registerImageCollectionIpc({ ipcMain, imageCollectionExportService, shell, log = () => {} } = {}) {
  if (!ipcMain) return;
  const invoke = async (operation) => {
    if (!imageCollectionExportService) {
      return { ok: false, errorCode: "IMAGE_COLLECTION_EXPORT_UNAVAILABLE", error: "图片组导出当前不可用。" };
    }
    try {
      return await operation();
    } catch (error) {
      return errorResult(error);
    }
  };

  ipcMain.handle("naimage:image-collection:export-preview", (_event, payload = {}) => invoke(async () => {
    const result = await imageCollectionExportService.previewCollections({
      expectedProjectId: payload.expectedProjectId,
      collectionIds: payload.collectionIds,
      format: payload.format,
      ...(payload.filenameTemplate !== undefined ? { filenameTemplate: payload.filenameTemplate } : {}),
      ...(payload.conflictPolicy !== undefined ? { conflictPolicy: payload.conflictPolicy } : {}),
      ...(payload.incremental !== undefined ? { incremental: payload.incremental === true } : {})
    });
    log(`image collection export preview project=${result.projectId} collections=${result.collectionCount || 0} images=${result.imageCount || 0}`);
    return result;
  }));

  ipcMain.handle("naimage:image-collection:export", (_event, payload = {}) => invoke(async () => {
    const result = await imageCollectionExportService.exportCollections({
      expectedProjectId: payload.expectedProjectId,
      collectionIds: payload.collectionIds,
      format: payload.format,
      ...(payload.filenameTemplate !== undefined ? { filenameTemplate: payload.filenameTemplate } : {}),
      ...(payload.conflictPolicy !== undefined ? { conflictPolicy: payload.conflictPolicy } : {}),
      ...(payload.incremental !== undefined ? { incremental: payload.incremental === true } : {}),
      previewToken: payload.previewToken,
      confirmed: payload.confirmed === true
    });
    log(`image collection export project=${result.projectId} collections=${result.exported?.length || 0}`);
    return result;
  }));

  ipcMain.handle("naimage:image-collection:open-folder", (_event, payload = {}) => invoke(async () => {
    if (!shell?.openPath) {
      return { ok: false, errorCode: "IMAGE_COLLECTION_SHELL_UNAVAILABLE", error: "系统文件管理器当前不可用。" };
    }
    const resolved = await imageCollectionExportService.resolveExportedCollectionFolder({
      expectedProjectId: payload.expectedProjectId,
      collectionId: payload.collectionId
    });
    const shellError = await shell.openPath(resolved.folderPath);
    if (shellError) {
      return { ok: false, errorCode: "IMAGE_COLLECTION_FOLDER_OPEN_FAILED", error: shellError };
    }
    log(`image collection folder open project=${resolved.projectId} collection=${resolved.collectionId}`);
    return {
      ok: true,
      projectId: resolved.projectId,
      collectionId: resolved.collectionId,
      directoryName: resolved.directoryName
    };
  }));
}

module.exports = { errorResult, registerImageCollectionIpc };
