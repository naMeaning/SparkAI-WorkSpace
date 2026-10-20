"use strict";

function registerCreationIpc({ ipcMain, creationService, creationCommandService, creationMaskService }) {
  ipcMain.handle("naimage:creation:command", (_event, payload = {}) => creationCommandService.invoke(payload.command, payload.args || {}));
  ipcMain.handle("naimage:creation:mask-save", async (_event, payload = {}) => {
    try { return { ok: true, ...await creationMaskService.save(payload) }; }
    catch (error) { return { ok: false, errorCode: error?.code || "CREATION_MASK_FAILED", error: "蒙版保存或目标校验失败，尚未派发修改。" }; }
  });
  ipcMain.handle("naimage:creation:prepare", (_event, payload = {}) => {
    try {
      const requirementRef = creationService.requirementRefForTask({ ...payload, projectId: payload.expectedProjectId || payload.projectId });
      return { ok: true, requirementRef };
    } catch (error) {
      return { ok: false, errorCode: error?.code || "CREATION_PREPARE_FAILED", error: "创作要求无法冻结；原任务未派发。" };
    }
  });
}

module.exports = { registerCreationIpc };
