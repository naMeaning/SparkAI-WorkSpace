"use strict";
function registerProjectContextIpc({ ipcMain, projectContextCommandService }) {
  ipcMain.handle("naimage:project-context:command", (_event, payload = {}) => projectContextCommandService.invoke(payload.command, payload.args || {}));
  ipcMain.handle("naimage:project-context:prepare", async (_event, payload = {}) => {
    try { return await projectContextCommandService.prepare(payload); }
    catch (error) { return projectContextCommandService.failure(error); }
  });
}
module.exports = { registerProjectContextIpc };
