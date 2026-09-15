"use strict";

function errorResult(error) {
  return {
    ok: false,
    errorCode: typeof error?.code === "string" ? error.code : "SOCIAL_EXPORT_FAILED",
    error: error instanceof Error ? error.message : String(error || "社媒发布包导出失败。"),
    ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
  };
}

function registerSocialExportIpc({ ipcMain, dialog, socialExportService } = {}) {
  if (!ipcMain) return;
  const invoke = async (operation) => {
    if (!socialExportService) return { ok: false, errorCode: "SOCIAL_EXPORT_UNAVAILABLE", error: "社媒发布包导出当前不可用。" };
    try {
      return await operation();
    } catch (error) {
      return errorResult(error);
    }
  };

  ipcMain.handle("naimage:social-export:preview", (_event, payload = {}) => invoke(() => socialExportService.preview(payload)));
  ipcMain.handle("naimage:social-export:package", async (_event, payload = {}) => invoke(async () => {
    if (payload?.confirmed !== true) return socialExportService.exportPackage(payload);
    if (!dialog?.showOpenDialog) return { ok: false, errorCode: "SOCIAL_EXPORT_DIALOG_UNAVAILABLE", error: "无法打开发布包目录选择器。" };
    const selected = await dialog.showOpenDialog({
      title: "选择社媒发布包导出目录",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "导出发布包"
    });
    if (selected?.canceled || !selected?.filePaths?.[0]) return { ok: true, canceled: true };
    return socialExportService.exportPackage({
      expectedProjectId: payload.expectedProjectId,
      requirementNodeId: payload.requirementNodeId,
      expectedRequirementRevision: payload.expectedRequirementRevision,
      workflowId: payload.workflowId,
      confirmed: true,
      destinationParent: selected.filePaths[0]
    });
  }));
}

module.exports = { registerSocialExportIpc };
