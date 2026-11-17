"use strict";

function publicFailure(error) {
  const errorCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.code || ""))
    ? error.code
    : "RECIPE_REQUEST_FAILED";
  return {
    ok: false,
    errorCode,
    error: typeof error?.message === "string" && error.message.trim()
      ? error.message.trim().slice(0, 500)
      : "Recipe 请求失败；未自动重试。",
  };
}

function handle(operation) {
  try {
    return Promise.resolve(operation()).then((result) => ({ ok: true, ...result })).catch(publicFailure);
  } catch (error) {
    return Promise.resolve(publicFailure(error));
  }
}

function registerRecipeIpc({ ipcMain, recipeStore, recipeRunService } = {}) {
  if (!ipcMain?.handle) throw new Error("Recipe IPC requires ipcMain.handle.");
  if (!recipeStore?.list || !recipeStore?.get) throw new Error("Recipe IPC requires the Recipe store.");
  if (!recipeRunService?.prepare || !recipeRunService?.start || !recipeRunService?.get || !recipeRunService?.cancel) {
    throw new Error("Recipe IPC requires the Recipe Run service.");
  }

  ipcMain.handle("naimage:recipe:list", (_event, payload = {}) => handle(() => {
    const projectId = String(payload?.projectId || "").trim();
    if (!projectId) throw Object.assign(new Error("请先打开项目。"), { code: "PROJECT_REQUIRED" });
    return recipeStore.list(projectId);
  }));

  ipcMain.handle("naimage:recipe:prepare", (_event, payload = {}) => handle(() => (
    recipeRunService.prepare(payload)
  )));

  ipcMain.handle("naimage:recipe:start", (_event, payload = {}) => handle(() => {
    if (payload?.confirmed !== true) {
      throw Object.assign(new Error("运行前必须明确确认图片请求和可能产生的费用。"), {
        code: "RECIPE_CONFIRMATION_REQUIRED",
      });
    }
    return recipeRunService.start(payload);
  }));

  ipcMain.handle("naimage:recipe:get", (_event, payload = {}) => handle(() => (
    recipeRunService.get(payload)
  )));

  ipcMain.handle("naimage:recipe:list-runs", (_event, payload = {}) => handle(() => {
    if (typeof recipeRunService.listRuns !== "function") return { runs: [] };
    return recipeRunService.listRuns(payload);
  }));

  ipcMain.handle("naimage:recipe:cancel", (_event, payload = {}) => handle(() => (
    recipeRunService.cancel(payload)
  )));

  ipcMain.handle("naimage:recipe:resume", (_event, payload = {}) => handle(() => {
    if (typeof recipeRunService.resume !== "function") {
      throw Object.assign(new Error("当前没有可恢复的 Recipe Run。"), { code: "RECIPE_RESUME_UNAVAILABLE" });
    }
    return recipeRunService.resume(payload);
  }));
}

module.exports = { registerRecipeIpc };
