"use strict";

function registerCommerceCatalogIpc({ ipcMain, BrowserWindow, commerceCatalogService }) {
  const invoke = (operation) => {
    if (!commerceCatalogService) {
      return { ok: false, errorCode: "COMMERCE_CATALOG_UNAVAILABLE", error: "SKU 商品素材库当前不可用。" };
    }
    try {
      const result = operation();
      if (result?.ok && result.changed) {
        for (const window of BrowserWindow?.getAllWindows?.() || []) {
          if (!window.isDestroyed?.()) {
            window.webContents?.send?.("naimage:commerce-catalog:changed", {
              projectId: result.projectId,
              catalogRevision: result.catalogRevision
            });
          }
        }
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        errorCode: typeof error?.code === "string" ? error.code : "COMMERCE_CATALOG_FAILED",
        error: error instanceof Error ? error.message : String(error),
        ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
      };
    }
  };

  ipcMain.handle("naimage:commerce-catalog:list", (_event, payload = {}) => invoke(() => commerceCatalogService.list(payload)));
  ipcMain.handle("naimage:commerce-catalog:save-product", (_event, payload = {}) => invoke(() => commerceCatalogService.saveProduct(payload)));
  ipcMain.handle("naimage:commerce-catalog:archive-product", (_event, payload = {}) => invoke(() => commerceCatalogService.archiveProduct(payload)));
  ipcMain.handle("naimage:commerce-catalog:assign-assets", (_event, payload = {}) => invoke(() => commerceCatalogService.assignAssets(payload)));
  ipcMain.handle("naimage:commerce-catalog:remove-asset", (_event, payload = {}) => invoke(() => commerceCatalogService.removeAsset(payload)));
  ipcMain.handle("naimage:commerce-catalog:update-result-state", (_event, payload = {}) => invoke(() => commerceCatalogService.updateResultState(payload)));
  ipcMain.handle("naimage:commerce-catalog:list-comparisons", (_event, payload = {}) => invoke(() => commerceCatalogService.listComparisons(payload)));
  ipcMain.handle("naimage:commerce-catalog:select-comparison", (_event, payload = {}) => invoke(() => commerceCatalogService.selectComparisonWinner(payload)));
  ipcMain.handle("naimage:commerce-catalog:reconcile-goal-results", (_event, payload = {}) => invoke(() => commerceCatalogService.reconcileGoalResults(payload)));
}

module.exports = { registerCommerceCatalogIpc };
