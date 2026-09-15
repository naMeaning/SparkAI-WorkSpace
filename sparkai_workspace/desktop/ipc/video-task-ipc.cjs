"use strict";

function errorResult(error) {
  return {
    ok: false,
    errorCode: String(error?.code || "VIDEO_TASK_FAILED"),
    error: error instanceof Error ? error.message : String(error || "视频任务失败。"),
    details: error?.details && typeof error.details === "object" ? error.details : undefined
  };
}

function registerVideoTaskIpc({ ipcMain, videoTaskService } = {}) {
  if (!ipcMain || !videoTaskService) return;

  ipcMain.handle("naimage:video-task:create", async (_event, payload = {}) => {
    try {
      return await videoTaskService.createTask(payload);
    } catch (error) {
      return errorResult(error);
    }
  });

  ipcMain.handle("naimage:video-task:list", async (_event, payload = {}) => {
    try {
      const tasks = await videoTaskService.listTasks(payload.expectedProjectId ?? payload.projectId);
      return { ok: true, tasks };
    } catch (error) {
      return { ...errorResult(error), tasks: [] };
    }
  });

  ipcMain.handle("naimage:video-task:get", async (_event, payload = {}) => {
    try {
      const task = await videoTaskService.getTask(payload.expectedProjectId ?? payload.projectId, payload.taskId);
      return task ? { ok: true, task } : { ok: false, errorCode: "VIDEO_TASK_NOT_FOUND", error: "视频任务不存在。" };
    } catch (error) {
      return errorResult(error);
    }
  });

  ipcMain.handle("naimage:video-task:poll", async (_event, payload = {}) => {
    try {
      const projectId = payload.expectedProjectId ?? payload.projectId;
      await videoTaskService.pollTask(projectId, payload.taskId);
      const task = await videoTaskService.getTask(projectId, payload.taskId);
      return task ? { ok: true, task } : { ok: false, errorCode: "VIDEO_TASK_NOT_FOUND", error: "视频任务不存在。" };
    } catch (error) {
      return errorResult(error);
    }
  });

  ipcMain.handle("naimage:video-task:retry-download", async (_event, payload = {}) => {
    try {
      const task = await videoTaskService.retryDownload(payload.expectedProjectId ?? payload.projectId, payload.taskId);
      return { ok: true, task };
    } catch (error) {
      return errorResult(error);
    }
  });
}

module.exports = { registerVideoTaskIpc };
