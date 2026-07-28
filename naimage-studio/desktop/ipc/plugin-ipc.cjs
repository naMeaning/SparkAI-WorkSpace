"use strict";

function registerPluginIpc({ ipcMain, composePluginTask }) {
  ipcMain.handle("naimage:plugin:compose-task", (_event, payload) => {
    try {
      return { ok: true, task: composePluginTask(payload) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { registerPluginIpc };
