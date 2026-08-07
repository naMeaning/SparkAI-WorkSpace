"use strict";

function errorResult(error, fallback = "科研绘图操作失败。") {
  return {
    ok: false,
    errorCode: typeof error?.code === "string" ? error.code : "SCIENTIFIC_OPERATION_FAILED",
    error: error instanceof Error ? error.message : String(error || fallback),
    ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
  };
}

function registerScientificIpc({ ipcMain, dialog, scientificRunnerService } = {}) {
  if (!ipcMain) return;
  const invoke = async (operation) => {
    if (!scientificRunnerService) return { ok: false, errorCode: "SCIENTIFIC_RUNNER_UNAVAILABLE", error: "科研绘图执行服务当前不可用。" };
    try {
      return await operation();
    } catch (error) {
      return errorResult(error);
    }
  };

  ipcMain.handle("naimage:scientific:import-data", (_event, payload = {}) => invoke(async () => {
    if (!dialog?.showOpenDialog) return { ok: false, errorCode: "SCIENTIFIC_DIALOG_UNAVAILABLE", error: "无法打开科研数据选择器。" };
    const selected = await dialog.showOpenDialog({
      title: "导入科研数据",
      properties: ["openFile"],
      buttonLabel: "导入数据",
      filters: [
        { name: "科研数据", extensions: ["csv", "tsv", "txt"] },
        { name: "所有文件", extensions: ["*"] }
      ]
    });
    if (selected?.canceled || !selected?.filePaths?.[0]) return { ok: true, canceled: true };
    return scientificRunnerService.importData({
      expectedProjectId: payload.expectedProjectId ?? payload.projectId,
      sourcePath: selected.filePaths[0]
    });
  }));

  ipcMain.handle("naimage:scientific:list-data", (_event, payload = {}) => invoke(async () => ({
    ok: true,
    dataSources: await scientificRunnerService.listData(payload.expectedProjectId ?? payload.projectId)
  })));

  ipcMain.handle("naimage:scientific:render", (_event, payload = {}) => invoke(async () => ({
    ok: true,
    task: await scientificRunnerService.renderTask(payload)
  })));

  ipcMain.handle("naimage:scientific:list", (_event, payload = {}) => invoke(async () => ({
    ok: true,
    tasks: await scientificRunnerService.listTasks(payload.expectedProjectId ?? payload.projectId)
  })));

  ipcMain.handle("naimage:scientific:get", (_event, payload = {}) => invoke(async () => {
    const task = await scientificRunnerService.getTask(payload.expectedProjectId ?? payload.projectId, payload.taskId);
    return task ? { ok: true, task } : { ok: false, errorCode: "SCIENTIFIC_TASK_NOT_FOUND", error: "科研绘图任务不存在。" };
  }));

  ipcMain.handle("naimage:scientific:cancel", (_event, payload = {}) => invoke(async () => ({
    ok: true,
    task: await scientificRunnerService.cancelTask(payload.expectedProjectId ?? payload.projectId, payload.taskId)
  })));

  ipcMain.handle("naimage:scientific:export", (_event, payload = {}) => invoke(async () => {
    if (payload.confirmed !== true) return { ok: false, errorCode: "SCIENTIFIC_EXPORT_CONFIRMATION_REQUIRED", error: "导出论文图需要明确确认。" };
    if (!dialog?.showOpenDialog) return { ok: false, errorCode: "SCIENTIFIC_DIALOG_UNAVAILABLE", error: "无法打开科研图导出目录选择器。" };
    const selected = await dialog.showOpenDialog({
      title: "选择论文图导出目录",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "导出论文图"
    });
    if (selected?.canceled || !selected?.filePaths?.[0]) return { ok: true, canceled: true };
    return scientificRunnerService.exportTask({
      expectedProjectId: payload.expectedProjectId ?? payload.projectId,
      taskId: payload.taskId,
      destinationParent: selected.filePaths[0]
    });
  }));
}

module.exports = { registerScientificIpc };
