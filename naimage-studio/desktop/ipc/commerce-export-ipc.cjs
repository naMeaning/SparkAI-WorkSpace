"use strict";

function errorResult(error, fallbackCode = "COMMERCE_EXPORT_FAILED") {
  return {
    ok: false,
    errorCode: typeof error?.code === "string" ? error.code : fallbackCode,
    error: error instanceof Error ? error.message : String(error),
    ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
  };
}

function registerCommerceExportIpc({ ipcMain, dialog, commerceExportService } = {}) {
  const invoke = async (operation) => {
    if (!commerceExportService) return { ok: false, errorCode: "COMMERCE_EXPORT_UNAVAILABLE", error: "平台导出中心当前不可用。" };
    try {
      return await operation();
    } catch (error) {
      return errorResult(error);
    }
  };

  ipcMain.handle("naimage:commerce-export:preview", (_event, payload = {}) => invoke(() => commerceExportService.preview(payload)));
  ipcMain.handle("naimage:commerce-export:package", async (_event, payload = {}) => invoke(async () => {
    if (payload?.confirmed !== true) return commerceExportService.exportPackage(payload);
    if (!dialog?.showOpenDialog) return { ok: false, errorCode: "COMMERCE_EXPORT_DIALOG_UNAVAILABLE", error: "无法打开导出目录选择器。" };
    const selected = await dialog.showOpenDialog({
      title: "选择平台导出目录",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "选择导出位置"
    });
    if (selected?.canceled || !selected?.filePaths?.[0]) return { ok: true, canceled: true };
    return commerceExportService.exportPackage({
      ...payload,
      destinationParent: selected.filePaths[0]
    });
  }));
}

module.exports = { registerCommerceExportIpc };
