"use strict";

function errorResult(error) {
  return {
    ok: false,
    errorCode: typeof error?.code === "string" ? error.code : "EXPORT_CENTER_OPERATION_FAILED",
    error: error instanceof Error ? error.message : String(error || "导出中心操作失败。"),
    ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
  };
}

function registerExportCenterIpc({ ipcMain, exportCenterStateService, log = () => {} } = {}) {
  if (!ipcMain) return;
  const invoke = async (label, operation) => {
    if (!exportCenterStateService) return { ok: false, errorCode: "EXPORT_CENTER_UNAVAILABLE", error: "导出中心当前不可用。" };
    try {
      const result = await operation();
      log(`export center ${label} project=${result.projectId || ""}`);
      return result;
    } catch (error) {
      return errorResult(error);
    }
  };

  ipcMain.handle("naimage:export-center:state", (_event, payload = {}) => invoke("state", () => exportCenterStateService.load({
    expectedProjectId: payload.expectedProjectId
  })));
  ipcMain.handle("naimage:export-center:save-preset", (_event, payload = {}) => invoke("save-preset", () => exportCenterStateService.savePreset({
    expectedProjectId: payload.expectedProjectId,
    preset: payload.preset
  })));
  ipcMain.handle("naimage:export-center:delete-preset", (_event, payload = {}) => invoke("delete-preset", () => exportCenterStateService.deletePreset({
    expectedProjectId: payload.expectedProjectId,
    presetId: payload.presetId
  })));
  ipcMain.handle("naimage:export-center:record-history", (_event, payload = {}) => invoke("record-history", () => exportCenterStateService.recordHistory({
    expectedProjectId: payload.expectedProjectId,
    entry: payload.entry
  })));
  ipcMain.handle("naimage:export-center:clear-history", (_event, payload = {}) => invoke("clear-history", () => exportCenterStateService.clearHistory({
    expectedProjectId: payload.expectedProjectId
  })));
}

module.exports = { errorResult, registerExportCenterIpc };
