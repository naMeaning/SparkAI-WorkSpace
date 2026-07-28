"use strict";

function registerAutomationIpc({ ipcMain, automationService, agentIntegrationService }) {
  ipcMain.handle("naimage:automation:renderer-ready", (event) => automationService.rendererReady(event.sender));
  ipcMain.on("naimage:automation:response", (event, payload) => {
    automationService.resolveRendererResponse(event.sender, payload);
  });

  ipcMain.handle("naimage:integration:detect", () => agentIntegrationService.detect());
  ipcMain.handle("naimage:integration:install", (_event, payload = {}) => agentIntegrationService.install(payload.targets));
  ipcMain.handle("naimage:integration:remove", (_event, payload = {}) => agentIntegrationService.remove(payload.targets));
}

module.exports = { registerAutomationIpc };
