"use strict";

function registerCommerceTemplateIpc({ ipcMain, commerceTemplateLibraryService, BrowserWindow }) {
  const invoke = async (operation) => {
    if (!commerceTemplateLibraryService) {
      return { ok: false, errorCode: "COMMERCE_TEMPLATE_UNAVAILABLE", error: "当前桌面运行时未提供套图模板市场。" };
    }
    try {
      return await operation();
    } catch (error) {
      return {
        ok: false,
        errorCode: typeof error?.code === "string" ? error.code : "COMMERCE_TEMPLATE_FAILED",
        error: error instanceof Error ? error.message : String(error),
        ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
      };
    }
  };
  const ownerFor = (event) => BrowserWindow?.fromWebContents?.(event.sender) || null;
  const broadcast = (result) => {
    if (!result?.ok || !result.changed) return result;
    for (const window of BrowserWindow?.getAllWindows?.() || []) {
      if (!window.isDestroyed?.()) window.webContents?.send?.("naimage:commerce-template:changed", {
        libraryRevision: result.libraryRevision,
        id: result.entry?.id || result.id || ""
      });
    }
    return result;
  };

  ipcMain.handle("naimage:commerce-template:list", () => invoke(() => commerceTemplateLibraryService.list()));
  ipcMain.handle("naimage:commerce-template:get", (_event, payload = {}) => invoke(() => commerceTemplateLibraryService.get(payload)));
  ipcMain.handle("naimage:commerce-template:save", (_event, payload = {}) => invoke(() => commerceTemplateLibraryService.save(payload)).then(broadcast));
  ipcMain.handle("naimage:commerce-template:delete", (_event, payload = {}) => invoke(() => commerceTemplateLibraryService.remove(payload)).then(broadcast));
  ipcMain.handle("naimage:commerce-template:import", (event) => invoke(() => commerceTemplateLibraryService.importTemplate(ownerFor(event))).then(broadcast));
  ipcMain.handle("naimage:commerce-template:export", (event, payload = {}) => invoke(() => commerceTemplateLibraryService.exportTemplate(payload, ownerFor(event))));
}

module.exports = { registerCommerceTemplateIpc };
