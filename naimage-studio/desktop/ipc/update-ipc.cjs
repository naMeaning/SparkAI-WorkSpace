"use strict";

function registerUpdateIpc({ ipcMain, desktopUpdater, log = () => {} }) {
  function operationFailure(operation, error, publishProgress = false) {
    const message = error instanceof Error ? error.message : String(error);
    log(`desktop ${operation} failed ${message}`);
    if (publishProgress) desktopUpdater.publishDesktopUpdateProgress({ stage: "error", message });
    return desktopUpdater.desktopUpdaterFailure(error);
  }

  ipcMain.handle("naimage:update:status", () => desktopUpdater.desktopUpdaterStatus());

  ipcMain.handle("naimage:update:renderer-ready", () => ({
    ok: true,
    acknowledged: desktopUpdater.markRestartUpdateHealthy()
  }));

  ipcMain.handle("naimage:update:check", async () => {
    try {
      return await desktopUpdater.checkDesktopUpdate();
    } catch (error) {
      return operationFailure("update check", error, true);
    }
  });

  ipcMain.handle("naimage:update:installer-captcha", async () => {
    try {
      return await desktopUpdater.createDesktopInstallerCaptcha();
    } catch (error) {
      return operationFailure("update captcha", error);
    }
  });

  ipcMain.handle("naimage:update:download-restart", async () => {
    try {
      return await desktopUpdater.downloadDesktopRestartUpdate();
    } catch (error) {
      return operationFailure("restart update download", error, true);
    }
  });

  ipcMain.handle("naimage:update:download-installer", async (_event, payload) => {
    try {
      return await desktopUpdater.downloadDesktopInstallerUpdate(payload);
    } catch (error) {
      return operationFailure("installer update download", error, true);
    }
  });

  ipcMain.handle("naimage:update:apply-restart", async () => {
    try {
      return await desktopUpdater.applyDesktopRestartUpdate();
    } catch (error) {
      return operationFailure("restart update apply", error, true);
    }
  });

  ipcMain.handle("naimage:update:launch-installer", async () => {
    try {
      return await desktopUpdater.launchDesktopInstallerUpdate();
    } catch (error) {
      return operationFailure("installer launch", error, true);
    }
  });
}

module.exports = { registerUpdateIpc };
